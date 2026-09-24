// MÓDULO DE AUDITORÍA Y MONITOREO DE SUMINISTROS (CSV FLEET) & STOCK EN SITIO
// Este archivo contiene la lógica completa del motor de diagnóstico y gestión de snapshots.

let monitoringData = {}; // { 'WALMART': [ snapshot1, snapshot2 ], 'BAC': [ ... ] }
let activeMonitoringClient = 'ALL';
let activeMonitoringSnapshot = 'LATEST';
let monitoringSearchQuery = '';
let monitoringFilterStatus = 'ALL';
let monitoringFilterSupply = 'ALL';
let monitoringCurrentPage = 1;
let monitoringPageSize = 50;
let monitoringProcessedList = [];
let monitoringFilteredList = [];

// Formateador seguro de fecha corta
function formatDateShort(val) {
  if (!val) return 'N/D';
  if (val instanceof Date) return val.toLocaleDateString();
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toLocaleDateString();
  return String(val);
}

// Formateador con día de la semana en español (ej: "Mié 23/09/2026 11:27")
function formatDateTimeWithDay(isoStr) {
  if (!isoStr) return 'N/D';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const dayName = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dayName} ${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

// Formateador corto con día de la semana (ej: "Lun 21/09")
function formatDateShortWithDay(isoStr) {
  if (!isoStr) return 'N/D';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const dayName = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dayName} ${dd}/${mm}`;
}

// Extractor ultra-flexible de fecha y hora desde el nombre de archivo
function extractDateFromFileName(fileName) {
  if (!fileName) return new Date().toISOString();

  // 1. Estándar Lexmark Fleet Manager: YYYYMMDD-HHMMSS (ej: 20260923-112740-248)
  let m = fileName.match(/(20\d{2})(\d{2})(\d{2})[-_](\d{2})(\d{2})(\d{2})?/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // 2. YYYYMMDD directo (ej: 20260921)
  m = fileName.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // 3. YYYY-MM-DD o YYYY_MM_DD (ej: 2026-09-21)
  m = fileName.match(/(20\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])/);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // 4. DD-MM-YYYY o DD_MM_YYYY (ej: 21-09-2026)
  m = fileName.match(/(0[1-9]|[12]\d|3[01])[-_](0[1-9]|1[0-2])[-_](20\d{2})/);
  if (m) {
    const d = new Date(`${m[3]}-${m[2]}-${m[1]}T12:00:00`);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  return new Date().toISOString();
}


// Parseo robusto de CSV Fleet Manager
function parseLexmarkFleetCsv(csvText, fileName) {
  if (!csvText || typeof csvText !== 'string') return [];
  const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  // Parsear línea respetando comillas
  function parseCsvLine(line) {
    const res = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        res.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    res.push(cur.trim());
    return res;
  }

  const rawHeaders = parseCsvLine(lines[0]).map(h => h.replace(/^\uFEFF/, '').trim());
  
  // Normalizar encabezados
  const normHeaders = rawHeaders.map(h => {
    return h.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  });

  function findColIdx(keywords) {
    return normHeaders.findIndex(h => keywords.some(k => h.includes(k)));
  }

  const ipIdx = findColIdx(['ip', 'direccion ip']);
  const kwIdx = findColIdx(['palabra clave', 'ubicacion', 'tienda']);
  const modIdx = findColIdx(['modelo', 'model']);
  const serIdx = findColIdx(['numero de serie', 'serie', 'serial']);
  const tnrNivelIdx = findColIdx(['nivel de cartucho negro', 'cartucho negro', 'toner negro', 'toner']);
  const tnrSerieIdx = findColIdx(['numero de serie de cartucho negro', 'serie de cartucho negro', 'serie toner']);
  const pagCarroIdx = findColIdx(['paginas en carrito', 'paginas carro']);
  const capTnrIdx = findColIdx(['capacidad de cartucho negro']);
  const fecInstIdx = findColIdx(['fecha de instalacion']);
  const udiNivelIdx = findColIdx(['nivel de unidad de imagenes', 'unidad de imagenes', 'udi']);
  const udiSerieIdx = findColIdx(['numero de serie de la unidad de imagen', 'serie de la unidad de imagen', 'serie udi']);
  const kmtNivelIdx = findColIdx(['nivel de kit de mantenimiento', 'kit de mantenimiento', 'kmt']);
  const estadoIdx = findColIdx(['estado de suministro', 'estado suministro', 'estado']);

  function parseNivel(val) {
    if (!val) return null;
    const str = val.toString().trim();
    if (str === '--' || str === '' || str.toLowerCase().includes('desconoc')) return null;
    if (str.toLowerCase().includes('bajo')) return 5;
    const match = str.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (!cols || cols.length < 3) continue;

    const serie = (serIdx >= 0 && cols[serIdx] ? cols[serIdx] : '').trim().toUpperCase();
    if (!serie) continue;

    rows.push({
      ip: ipIdx >= 0 ? cols[ipIdx] : '',
      ubicacion: kwIdx >= 0 ? cols[kwIdx] : '',
      modelo: modIdx >= 0 ? cols[modIdx] : '',
      serie: serie,
      tnrNivel: tnrNivelIdx >= 0 ? parseNivel(cols[tnrNivelIdx]) : null,
      tnrSerie: (tnrSerieIdx >= 0 && cols[tnrSerieIdx] ? cols[tnrSerieIdx] : '').trim().toUpperCase(),
      paginasCarro: pagCarroIdx >= 0 ? cols[pagCarroIdx] : '',
      capacidadTnr: capTnrIdx >= 0 ? cols[capTnrIdx] : '',
      fechaInstalacionTnr: fecInstIdx >= 0 ? cols[fecInstIdx] : '',
      udiNivel: udiNivelIdx >= 0 ? parseNivel(cols[udiNivelIdx]) : null,
      udiSerie: (udiSerieIdx >= 0 && cols[udiSerieIdx] ? cols[udiSerieIdx] : '').trim().toUpperCase(),
      kmtNivel: kmtNivelIdx >= 0 ? parseNivel(cols[kmtNivelIdx]) : null,
      estadoSuministro: estadoIdx >= 0 ? cols[estadoIdx] : 'Aceptar'
    });
  }

  return rows;
}

// Detección automática del cliente según el nombre del archivo o series de RDI
function detectClientFromCsvRows(rows, fileName) {
  const fUpper = (fileName || '').toUpperCase();
  if (fUpper.includes('WALMART')) return 'WALMART';
  if (fUpper.includes('BAC') || fUpper.includes('BANCO')) return 'BAC';
  if (fUpper.includes('AUSOLES')) return 'AUSOLES';
  if (fUpper.includes('FUSALMO') || fUpper.includes('FOMENTO')) return 'FUSALMO';

  // Buscar coincidencia en RDI si existe
  if (typeof rdiMapBySerie !== 'undefined' && rdiMapBySerie.size > 0 && rows.length > 0) {
    const clientCounts = {};
    const sample = rows.slice(0, 20);
    sample.forEach(r => {
      const match = rdiMapBySerie.get(r.serie);
      if (match && match.CLIENTE) {
        const c = match.CLIENTE.trim().toUpperCase();
        clientCounts[c] = (clientCounts[c] || 0) + 1;
      }
    });

    let bestClient = null;
    let maxCount = 0;
    Object.keys(clientCounts).forEach(c => {
      if (clientCounts[c] > maxCount) {
        maxCount = clientCounts[c];
        bestClient = c;
      }
    });

    if (bestClient && maxCount >= 2) {
      if (bestClient.includes('WALMART')) return 'WALMART';
      if (bestClient.includes('BAC') || bestClient.includes('BANCO')) return 'BAC';
      return bestClient;
    }
  }

  // Nombre derivado del archivo
  const cleanName = (fileName || 'CLIENTE_DESCONOCIDO')
    .replace(/\.csv$/i, '')
    .replace(/[_\-\.]+/g, ' ')
    .trim()
    .toUpperCase();
  return cleanName || 'CLIENTE_NUEVO';
}

// Agregar snapshot de monitoreo con histórico semanal
function addMonitoringSnapshot(clientName, fileName, rows) {
  if (!rows || rows.length === 0) return;
  const cleanClient = (clientName || 'CLIENTE').toUpperCase();
  
  if (!monitoringData[cleanClient]) {
    monitoringData[cleanClient] = [];
  }

  // Extraer timestamp de fecha del nombre de archivo de forma inteligente
  const uploadDate = extractDateFromFileName(fileName);
  const snapshotId = 'snap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

  const newSnapshot = {
    snapshotId,
    clientName: cleanClient,
    fileName,
    uploadDate,
    rows
  };

  // Reemplazar si ya existe un snapshot con el mismo nombre de archivo en este cliente
  const existingIdx = monitoringData[cleanClient].findIndex(s => s.fileName === fileName);
  if (existingIdx >= 0) {
    newSnapshot.snapshotId = monitoringData[cleanClient][existingIdx].snapshotId; // Mantener id
    monitoringData[cleanClient][existingIdx] = newSnapshot;
  } else {
    monitoringData[cleanClient].unshift(newSnapshot);
  }

  // Ordenar cronológicamente: de más reciente a más antiguo
  monitoringData[cleanClient].sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

  saveMonitoringToIndexedDB();
  refreshMonitoringAnalysis();
  if (typeof showToast === 'function') {
    showToast(`✅ ${rows.length} equipos cargados para ${cleanClient} (${fileName})`);
  }
}

// Eliminar un cliente de monitoreo
function deleteMonitoringClient(clientName) {
  if (!confirm(`¿Estás seguro de eliminar todo el monitoreo e historial de ${clientName}?`)) return;
  delete monitoringData[clientName];
  if (activeMonitoringClient === clientName) {
    activeMonitoringClient = 'ALL';
  }
  saveMonitoringToIndexedDB();
  refreshMonitoringAnalysis();
  if (typeof showToast === 'function') {
    showToast(`Cliente ${clientName} removido del monitoreo.`);
  }
}

// Restaurar datos predeterminados
function resetMonitoringToDefault() {
  if (!confirm("¿Deseas recargar los datos predeterminados de monitoreo (Walmart y BAC)?")) return;
  if (typeof window !== 'undefined' && window.DEFAULT_MONITORING_DATA) {
    monitoringData = JSON.parse(JSON.stringify(window.DEFAULT_MONITORING_DATA));
    saveMonitoringToIndexedDB();
    refreshMonitoringAnalysis();
    if (typeof showToast === 'function') {
      showToast("Datos de monitoreo restaurados a predeterminados.");
    }
  }
}

// Persistencia en IndexedDB (Unificada con IEXCA_SUITE_DATABASE)
async function saveMonitoringToIndexedDB() {
  if (typeof window === 'undefined') return;
  try {
    const db = typeof openIexcaDB === 'function' ? await openIexcaDB() : null;
    if (db && db.objectStoreNames.contains('workbook_data')) {
      const tx = db.transaction('workbook_data', 'readwrite');
      tx.objectStore('workbook_data').put({ id: 'iexca_monitoring_data', data: monitoringData });
    } else {
      localStorage.setItem('IEXCA_MONITORING_DATA', JSON.stringify(monitoringData));
    }
  } catch (err) {
    console.warn("Error guardando monitoreo en IndexedDB:", err);
    try {
      localStorage.setItem('IEXCA_MONITORING_DATA', JSON.stringify(monitoringData));
    } catch (e) {}
  }
}

async function loadMonitoringFromIndexedDB(callback) {
  if (typeof window === 'undefined') {
    if (callback) callback(false);
    return;
  }
  try {
    const db = typeof openIexcaDB === 'function' ? await openIexcaDB() : null;
    if (db && db.objectStoreNames.contains('workbook_data')) {
      const tx = db.transaction('workbook_data', 'readonly');
      const req = tx.objectStore('workbook_data').get('iexca_monitoring_data');
      req.onsuccess = () => {
        if (req.result && req.result.data && Object.keys(req.result.data).length > 0) {
          monitoringData = req.result.data;
          if (callback) callback(true);
        } else {
          // Intentar localStorage como fallback
          tryLoadFromLocalStorage(callback);
        }
      };
      req.onerror = () => tryLoadFromLocalStorage(callback);
    } else {
      tryLoadFromLocalStorage(callback);
    }
  } catch (err) {
    tryLoadFromLocalStorage(callback);
  }
}

function tryLoadFromLocalStorage(callback) {
  try {
    const raw = localStorage.getItem('IEXCA_MONITORING_DATA');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Object.keys(parsed).length > 0) {
        monitoringData = parsed;
        if (callback) callback(true);
        return;
      }
    }
  } catch (e) {}
  if (callback) callback(false);
}

// Inicialización del módulo
function initMonitoringModule() {
  loadMonitoringFromIndexedDB((loaded) => {
    if (!loaded) {
      if (typeof window !== 'undefined' && window.DEFAULT_MONITORING_DATA) {
        monitoringData = JSON.parse(JSON.stringify(window.DEFAULT_MONITORING_DATA));
      }
    } else {
      // Si ya existían datos en IndexedDB, integrar cualquier snapshot nuevo de DEFAULT_MONITORING_DATA sin duplicar
      if (typeof window !== 'undefined' && window.DEFAULT_MONITORING_DATA) {
        const def = window.DEFAULT_MONITORING_DATA;
        let hasNew = false;
        Object.keys(def).forEach(clientKey => {
          if (!monitoringData[clientKey] || monitoringData[clientKey].length === 0) {
            monitoringData[clientKey] = JSON.parse(JSON.stringify(def[clientKey]));
            hasNew = true;
          } else {
            const currentSnaps = monitoringData[clientKey];
            const defSnaps = def[clientKey] || [];
            defSnaps.forEach(ds => {
              const exists = currentSnaps.some(s => s.fileName === ds.fileName);
              if (!exists) {
                currentSnaps.push(JSON.parse(JSON.stringify(ds)));
                hasNew = true;
              }
            });
            currentSnaps.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
          }
        });
        if (hasNew) {
          saveMonitoringToIndexedDB();
        }
      }
    }
    refreshMonitoringAnalysis();
  });
}

// MOTOR DE DIAGNÓSTICO INTELIGENTE & CRUCE CON FOLIOS Y RDI
function refreshMonitoringAnalysis() {
  // 1. Indexar Folios por Serie de Equipo
  const foliosBySerie = new Map();
  const allFolios = (typeof sheetStore !== 'undefined' && sheetStore['FOLIOS']) ? sheetStore['FOLIOS'] : [];
  allFolios.forEach(f => {
    const ser = (f['SERIE'] || '').toString().trim().toUpperCase();
    if (ser) {
      if (!foliosBySerie.has(ser)) foliosBySerie.set(ser, []);
      foliosBySerie.get(ser).push(f);
    }
  });

  // 2. Determinar Clientes a Evaluar
  const clientNames = Object.keys(monitoringData);
  const targetClients = activeMonitoringClient === 'ALL' 
    ? clientNames 
    : clientNames.filter(c => c === activeMonitoringClient);

  monitoringProcessedList = [];

  let countTotalEquipos = 0;
  let countDespachoRequerido = 0;
  let countStockConsumido = 0;
  let countStockEnSitio = 0;
  let countOptimos = 0;

  targetClients.forEach(clientName => {
    const snapshots = monitoringData[clientName] || [];
    if (snapshots.length === 0) return;

    let targetSnap = null;
    let prevSnap = null;

    if (activeMonitoringSnapshot === 'LATEST' || activeMonitoringClient === 'ALL') {
      targetSnap = snapshots[0];
      prevSnap = snapshots.length > 1 ? snapshots[1] : null;
    } else {
      const idx = snapshots.findIndex(s => s.snapshotId === activeMonitoringSnapshot);
      if (idx >= 0) {
        targetSnap = snapshots[idx];
        prevSnap = idx + 1 < snapshots.length ? snapshots[idx + 1] : null;
      } else {
        targetSnap = snapshots[0];
        prevSnap = snapshots.length > 1 ? snapshots[1] : null;
      }
    }

    if (!targetSnap || !targetSnap.rows) return;

    // Mapa del snapshot previo para cálculo de deltas
    const prevMapBySerie = new Map();
    if (prevSnap && prevSnap.rows) {
      prevSnap.rows.forEach(r => {
        prevMapBySerie.set(r.serie.toUpperCase(), r);
      });
    }

    targetSnap.rows.forEach(row => {
      countTotalEquipos++;
      const serieUpper = row.serie.toUpperCase();
      const prevRow = prevMapBySerie.get(serieUpper);

      // Datos RDI
      const rdiInfo = (typeof rdiMapBySerie !== 'undefined') ? rdiMapBySerie.get(serieUpper) : null;
      const displayModelo = row.modelo || (rdiInfo ? rdiInfo.MOD : '') || 'N/D';
      const displayUbicacion = row.ubicacion || (rdiInfo ? `${rdiInfo.TIENDA} - ${rdiInfo.DET}` : '') || 'N/D';
      const displayCliente = clientName || (rdiInfo ? rdiInfo.CLIENTE : '') || 'N/D';
      const displayDet = (rdiInfo && rdiInfo.DET) ? rdiInfo.DET : '';

      // Cálculo de Deltas y Detección de Reemplazo
      let deltaTnr = null;
      let tnrReplaced = false;
      if (prevRow) {
        if (prevRow.tnrNivel !== null && row.tnrNivel !== null) {
          deltaTnr = prevRow.tnrNivel - row.tnrNivel;
        }
        if ((prevRow.tnrSerie && row.tnrSerie && prevRow.tnrSerie !== row.tnrSerie) ||
            (prevRow.tnrNivel !== null && prevRow.tnrNivel <= 20 && row.tnrNivel !== null && row.tnrNivel >= 80)) {
          tnrReplaced = true;
        }
      }

      let deltaUdi = null;
      let udiReplaced = false;
      if (prevRow) {
        if (prevRow.udiNivel !== null && row.udiNivel !== null) {
          deltaUdi = prevRow.udiNivel - row.udiNivel;
        }
        if ((prevRow.udiSerie && row.udiSerie && prevRow.udiSerie !== row.udiSerie) ||
            (prevRow.udiNivel !== null && prevRow.udiNivel <= 20 && row.udiNivel !== null && row.udiNivel >= 80)) {
          udiReplaced = true;
        }
      }

      let deltaKmt = null;
      if (prevRow && prevRow.kmtNivel !== null && row.kmtNivel !== null) {
        deltaKmt = prevRow.kmtNivel - row.kmtNivel;
      }

      // Alertas de Nivel Bajo
      const isTnrLow = (row.tnrNivel !== null && row.tnrNivel <= 20) || 
                       (row.estadoSuministro === 'Advertencia' && (row.tnrNivel === null || row.tnrNivel <= 25));
      const isUdiLow = (row.udiNivel !== null && row.udiNivel <= 20) || 
                       (row.estadoSuministro === 'Advertencia' && row.udiNivel <= 25);
      const isKmtLow = (row.kmtNivel !== null && row.kmtNivel <= 20);

      // Salidas registradas en FOLIOS para este equipo
      const equipFolios = foliosBySerie.get(serieUpper) || [];
      // Ordenar por fecha o folio descendente
      const sortedFolios = [...equipFolios].reverse();

      // Último despacho de TNR, UDI, KMT
      const lastTnrFolio = sortedFolios.find(f => {
        const t = (f['TIPO SUM'] || '').toUpperCase();
        const d = (f['DESCRIPCION'] || '').toUpperCase();
        return t.includes('TNR') || d.includes('TONER') || d.includes('TNR');
      });

      const lastUdiFolio = sortedFolios.find(f => {
        const t = (f['TIPO SUM'] || '').toUpperCase();
        const d = (f['DESCRIPCION'] || '').toUpperCase();
        return t.includes('UDI') || d.includes('IMAGEN') || d.includes('DRUM') || d.includes('UDI');
      });

      const lastKmtFolio = sortedFolios.find(f => {
        const t = (f['TIPO SUM'] || '').toUpperCase();
        const d = (f['DESCRIPCION'] || '').toUpperCase();
        return t.includes('KMT') || t.includes('REP') || d.includes('MANTENIMIENTO') || d.includes('FUSOR') || d.includes('KMT');
      });

      // DIAGNÓSTICO TNR
      let diagTnr = 'OPTIMO';
      let reasonTnr = '';
      if (tnrReplaced) {
        diagTnr = 'REPOSICION_STOCK';
        reasonTnr = '🔄 Tóner cambiado en sitio. Reserva consumida, stock en tienda quedó en 0.';
      } else if (isTnrLow) {
        if (!lastTnrFolio) {
          diagTnr = 'DESPACHO_REQUERIDO';
          reasonTnr = `🚨 Tóner en ${row.tnrNivel !== null ? row.tnrNivel + '%' : 'bajo'}. Sin registro de salida en FOLIOS.`;
        } else {
          const est = (lastTnrFolio['ESTADO SUM'] || 'ENTREGADO').toString().toUpperCase();
          const folSerie = (lastTnrFolio['SERIE SUM'] || '').toString().trim().toUpperCase();
          const folNum = lastTnrFolio['FOLIO'] || lastTnrFolio['FOLIO '] || 'S/N';
          if (est === 'PENDIENTE' || est === 'EN RUTA' || est === 'ENVIADO') {
            diagTnr = 'EN_TRANSITO';
            reasonTnr = `🚚 Despacho en camino (Folio #${folNum})`;
          } else {
            // Entregado en sitio
            if (folSerie && row.tnrSerie && folSerie === row.tnrSerie) {
              diagTnr = 'DESPACHO_REQUERIDO';
              reasonTnr = `🚨 Tóner de Folio #${folNum} ya está puesto en el equipo. Sin repuesto adicional en sitio.`;
            } else {
              diagTnr = 'STOCK_EN_SITIO';
              reasonTnr = `🛡️ Tienda tiene tóner en sitio (Folio #${folNum}${folSerie ? ' - Serie: ' + folSerie : ''})`;
            }
          }
        }
      }

      // DIAGNÓSTICO UDI
      let diagUdi = 'OPTIMO';
      let reasonUdi = '';
      if (udiReplaced) {
        diagUdi = 'REPOSICION_STOCK';
        reasonUdi = '🔄 Unidad de imagen cambiada en sitio. Reserva consumida, stock en 0.';
      } else if (isUdiLow) {
        if (!lastUdiFolio) {
          diagUdi = 'DESPACHO_REQUERIDO';
          reasonUdi = `🚨 UDI en ${row.udiNivel !== null ? row.udiNivel + '%' : 'baja'}. Sin registro de salida en FOLIOS.`;
        } else {
          const est = (lastUdiFolio['ESTADO SUM'] || 'ENTREGADO').toString().toUpperCase();
          const folSerie = (lastUdiFolio['SERIE SUM'] || '').toString().trim().toUpperCase();
          const folNum = lastUdiFolio['FOLIO'] || lastUdiFolio['FOLIO '] || 'S/N';
          if (est === 'PENDIENTE' || est === 'EN RUTA' || est === 'ENVIADO') {
            diagUdi = 'EN_TRANSITO';
            reasonUdi = `🚚 Despacho UDI en camino (Folio #${folNum})`;
          } else {
            if (folSerie && row.udiSerie && folSerie === row.udiSerie) {
              diagUdi = 'DESPACHO_REQUERIDO';
              reasonUdi = `🚨 UDI de Folio #${folNum} ya está colocada. Sin repuesto adicional en sitio.`;
            } else {
              diagUdi = 'STOCK_EN_SITIO';
              reasonUdi = `🛡️ Tienda tiene UDI en sitio (Folio #${folNum}${folSerie ? ' - Serie: ' + folSerie : ''})`;
            }
          }
        }
      }

      // DIAGNÓSTICO KMT
      let diagKmt = 'OPTIMO';
      let reasonKmt = '';
      if (isKmtLow) {
        if (!lastKmtFolio) {
          diagKmt = 'DESPACHO_REQUERIDO';
          reasonKmt = `🚨 Kit de Mantenimiento en ${row.kmtNivel}%. Sin salidas registradas.`;
        } else {
          const folNum = lastKmtFolio['FOLIO'] || lastKmtFolio['FOLIO '] || 'S/N';
          diagKmt = 'STOCK_EN_SITIO';
          reasonKmt = `🛡️ Kit despachado en Folio #${folNum}`;
        }
      }

      // DIAGNÓSTICO GENERAL DEL EQUIPO (Por prioridad de criticidad)
      let overallDiag = 'OPTIMO';
      let primaryReason = 'Niveles de suministros en rango seguro (> 20%).';
      let alertSupplyType = null;
      let alertLevel = null;

      if (diagTnr === 'DESPACHO_REQUERIDO') {
        overallDiag = 'DESPACHO_REQUERIDO';
        primaryReason = reasonTnr;
        alertSupplyType = 'TNR';
        alertLevel = row.tnrNivel;
      } else if (diagUdi === 'DESPACHO_REQUERIDO') {
        overallDiag = 'DESPACHO_REQUERIDO';
        primaryReason = reasonUdi;
        alertSupplyType = 'UDI';
        alertLevel = row.udiNivel;
      } else if (diagKmt === 'DESPACHO_REQUERIDO') {
        overallDiag = 'DESPACHO_REQUERIDO';
        primaryReason = reasonKmt;
        alertSupplyType = 'KMT';
        alertLevel = row.kmtNivel;
      } else if (diagTnr === 'REPOSICION_STOCK') {
        overallDiag = 'REPOSICION_STOCK';
        primaryReason = reasonTnr;
        alertSupplyType = 'TNR';
        alertLevel = row.tnrNivel;
      } else if (diagUdi === 'REPOSICION_STOCK') {
        overallDiag = 'REPOSICION_STOCK';
        primaryReason = reasonUdi;
        alertSupplyType = 'UDI';
        alertLevel = row.udiNivel;
      } else if (diagTnr === 'EN_TRANSITO' || diagUdi === 'EN_TRANSITO') {
        overallDiag = 'EN_TRANSITO';
        primaryReason = (diagTnr === 'EN_TRANSITO' ? reasonTnr : reasonUdi);
        alertSupplyType = (diagTnr === 'EN_TRANSITO' ? 'TNR' : 'UDI');
        alertLevel = (diagTnr === 'EN_TRANSITO' ? row.tnrNivel : row.udiNivel);
      } else if (diagTnr === 'STOCK_EN_SITIO' || diagUdi === 'STOCK_EN_SITIO' || diagKmt === 'STOCK_EN_SITIO') {
        overallDiag = 'STOCK_EN_SITIO';
        primaryReason = (diagTnr === 'STOCK_EN_SITIO' ? reasonTnr : (diagUdi === 'STOCK_EN_SITIO' ? reasonUdi : reasonKmt));
        alertSupplyType = (diagTnr === 'STOCK_EN_SITIO' ? 'TNR' : (diagUdi === 'STOCK_EN_SITIO' ? 'UDI' : 'KMT'));
        alertLevel = (diagTnr === 'STOCK_EN_SITIO' ? row.tnrNivel : (diagUdi === 'STOCK_EN_SITIO' ? row.udiNivel : row.kmtNivel));
      }

      // Contadores
      if (overallDiag === 'DESPACHO_REQUERIDO') countDespachoRequerido++;
      else if (overallDiag === 'REPOSICION_STOCK') countStockConsumido++;
      else if (overallDiag === 'STOCK_EN_SITIO') countStockEnSitio++;
      else countOptimos++;

      // Registrar objeto procesado
      monitoringProcessedList.push({
        raw: row,
        serie: serieUpper,
        modelo: displayModelo,
        cliente: displayCliente,
        ubicacion: displayUbicacion,
        det: displayDet,
        ip: row.ip,
        tnrNivel: row.tnrNivel,
        tnrSerie: row.tnrSerie,
        paginasCarro: row.paginasCarro,
        deltaTnr,
        tnrReplaced,
        diagTnr,
        reasonTnr,
        udiNivel: row.udiNivel,
        udiSerie: row.udiSerie,
        deltaUdi,
        udiReplaced,
        diagUdi,
        reasonUdi,
        kmtNivel: row.kmtNivel,
        deltaKmt,
        diagKmt,
        reasonKmt,
        overallDiag,
        primaryReason,
        alertSupplyType,
        alertLevel,
        lastFolio: lastTnrFolio || lastUdiFolio || lastKmtFolio || null,
        prevSnapDate: prevSnap ? prevSnap.uploadDate : null,
        targetSnapDate: targetSnap ? targetSnap.uploadDate : null,
        prevRowTnr: (prevRow && prevRow.tnrNivel !== null) ? prevRow.tnrNivel : null,
        prevRowUdi: (prevRow && prevRow.udiNivel !== null) ? prevRow.udiNivel : null,
        prevRowKmt: (prevRow && prevRow.kmtNivel !== null) ? prevRow.kmtNivel : null
      });
    });
  });

  // 3. Renderizar KPIs
  renderMonitoringKPIs({
    total: countTotalEquipos,
    despachoRequerido: countDespachoRequerido,
    stockConsumido: countStockConsumido,
    stockEnSitio: countStockEnSitio,
    optimos: countOptimos
  });

  // 4. Actualizar Badge en Menú
  const totalAlertas = countDespachoRequerido + countStockConsumido;
  const badgeAlerts = document.getElementById('badgeMonitoreoAlertsCount');
  if (badgeAlerts) {
    badgeAlerts.textContent = `${totalAlertas} alertas`;
    if (totalAlertas > 0) {
      badgeAlerts.className = 'text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 animate-pulse';
    } else {
      badgeAlerts.className = 'text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
    }
  }

  // 5. Renderizar Pills de Clientes
  renderMonitoringClientPills();

  // 6. Filtrar y Renderizar Tabla
  filterMonitoringTable();
}

function renderMonitoringKPIs(kpis) {
  const elTot = document.getElementById('kpiMonTotalEquipos');
  if (elTot) elTot.textContent = kpis.total.toLocaleString();
  const elDesp = document.getElementById('kpiMonDespachoRequerido');
  if (elDesp) elDesp.textContent = kpis.despachoRequerido.toLocaleString();
  const elRep = document.getElementById('kpiMonStockConsumido');
  if (elRep) elRep.textContent = kpis.stockConsumido.toLocaleString();
  const elSit = document.getElementById('kpiMonStockEnSitio');
  if (elSit) elSit.textContent = kpis.stockEnSitio.toLocaleString();
  const elOpt = document.getElementById('kpiMonOptimos');
  if (elOpt) elOpt.textContent = kpis.optimos.toLocaleString();

  const elLbl = document.getElementById('kpiMonClienteLabel');
  if (elLbl) {
    elLbl.textContent = activeMonitoringClient === 'ALL' 
      ? 'Todos los clientes (Consolidado)' 
      : `Cliente: ${activeMonitoringClient}`;
  }
}

function renderMonitoringClientPills() {
  const container = document.getElementById('monitoringClientsPills');
  if (!container) return;
  container.innerHTML = '';

  const clients = Object.keys(monitoringData);

  // Botón "Todos"
  const btnAll = document.createElement('button');
  btnAll.type = 'button';
  btnAll.className = `px-3 py-1 rounded-xl text-xs font-semibold transition ${
    activeMonitoringClient === 'ALL'
      ? 'bg-rose-600 text-white shadow-xs'
      : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
  }`;
  btnAll.textContent = `🌐 Todos (${clients.length})`;
  btnAll.onclick = () => {
    activeMonitoringClient = 'ALL';
    activeMonitoringSnapshot = 'LATEST';
    refreshMonitoringAnalysis();
  };
  container.appendChild(btnAll);

  // Botones por cliente
  clients.forEach(c => {
    const snapshots = monitoringData[c] || [];
    const equipCount = snapshots.length > 0 && snapshots[0].rows ? snapshots[0].rows.length : 0;
    
    const wrapper = document.createElement('div');
    wrapper.className = 'inline-flex items-center rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `px-2.5 py-1 text-xs font-semibold transition ${
      activeMonitoringClient === c
        ? 'bg-rose-600 text-white'
        : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
    }`;
    btn.textContent = `${c} (${equipCount})`;
    btn.onclick = () => {
      activeMonitoringClient = c;
      activeMonitoringSnapshot = 'LATEST';
      refreshMonitoringAnalysis();
    };
    wrapper.appendChild(btn);

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.title = `Eliminar monitoreo de ${c}`;
    btnDel.className = 'px-1.5 py-1 text-[11px] bg-slate-200 hover:bg-rose-500 hover:text-white dark:bg-slate-600 dark:hover:bg-rose-600 text-slate-500 dark:text-slate-300 transition';
    btnDel.innerHTML = '&times;';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      deleteMonitoringClient(c);
    };
    wrapper.appendChild(btnDel);

    container.appendChild(wrapper);
  });

  // Actualizar Selector de Snapshot
  updateMonitoringSnapshotSelect();
}

function updateMonitoringSnapshotSelect() {
  const select = document.getElementById('monitoringSnapshotSelect');
  if (!select) return;
  select.innerHTML = '';

  const optLatest = document.createElement('option');
  optLatest.value = 'LATEST';
  optLatest.textContent = '⭐ Última Lectura Vigente (vs. Anterior)';
  select.appendChild(optLatest);

  if (activeMonitoringClient !== 'ALL' && monitoringData[activeMonitoringClient]) {
    const snaps = monitoringData[activeMonitoringClient];
    snaps.forEach((s, idx) => {
      const opt = document.createElement('option');
      opt.value = s.snapshotId;
      const dStr = s.uploadDate ? formatDateTimeWithDay(s.uploadDate) : `Captura #${idx + 1}`;
      opt.textContent = `${idx === 0 ? '⭐ (Reciente) ' : ''}${dStr} [${s.rows.length} eq.]`;
      select.appendChild(opt);
    });
    select.value = activeMonitoringSnapshot;
  }
}

function onMonitoringSnapshotChange() {
  const select = document.getElementById('monitoringSnapshotSelect');
  if (select) {
    activeMonitoringSnapshot = select.value;
    refreshMonitoringAnalysis();
  }
}

// Filtros y Tabla
function filterMonitoringTable() {
  const searchInput = document.getElementById('searchMonitoringInput');
  const statusSelect = document.getElementById('filterMonitoringStatusSelect');
  const supplySelect = document.getElementById('filterMonitoringSupplySelect');

  monitoringSearchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  monitoringFilterStatus = statusSelect ? statusSelect.value : 'ALL';
  monitoringFilterSupply = supplySelect ? supplySelect.value : 'ALL';

  monitoringFilteredList = monitoringProcessedList.filter(row => {
    // 1. Filtro Diagnóstico
    if (monitoringFilterStatus !== 'ALL') {
      if (row.overallDiag !== monitoringFilterStatus) return false;
    }

    // 2. Filtro Suministro
    if (monitoringFilterSupply !== 'ALL') {
      if (monitoringFilterSupply === 'TNR') {
        if (!row.isTnrLow && row.diagTnr === 'OPTIMO') return false;
      } else if (monitoringFilterSupply === 'UDI') {
        if (!row.isUdiLow && row.diagUdi === 'OPTIMO') return false;
      } else if (monitoringFilterSupply === 'KMT') {
        if (!row.isKmtLow && row.diagKmt === 'OPTIMO') return false;
      }
    }

    // 3. Búsqueda de Texto
    if (monitoringSearchQuery) {
      const text = `${row.serie} ${row.cliente} ${row.ubicacion} ${row.det} ${row.modelo} ${row.ip} ${row.tnrSerie} ${row.udiSerie}`.toLowerCase();
      if (!text.includes(monitoringSearchQuery)) return false;
    }

    return true;
  });

  monitoringCurrentPage = 1;
  renderMonitoringTable();
}

function changeMonitoringPageSize(newSize) {
  monitoringPageSize = newSize;
  monitoringCurrentPage = 1;
  const selectTop = document.getElementById('monitoringPageSizeSelectTop');
  if (selectTop) selectTop.value = newSize;
  renderMonitoringTable();
}

function monitoringFirstPage() {
  if (monitoringCurrentPage > 1) {
    monitoringCurrentPage = 1;
    renderMonitoringTable();
  }
}

function monitoringPrevPage() {
  if (monitoringCurrentPage > 1) {
    monitoringCurrentPage--;
    renderMonitoringTable();
  }
}

function monitoringNextPage() {
  const totalPages = Math.max(1, Math.ceil(monitoringFilteredList.length / monitoringPageSize));
  if (monitoringCurrentPage < totalPages) {
    monitoringCurrentPage++;
    renderMonitoringTable();
  }
}

function monitoringLastPage() {
  const totalPages = Math.max(1, Math.ceil(monitoringFilteredList.length / monitoringPageSize));
  if (monitoringCurrentPage < totalPages) {
    monitoringCurrentPage = totalPages;
    renderMonitoringTable();
  }
}

// Renderizado de Filas de la Tabla
function renderMonitoringTable() {
  const tbody = document.getElementById('monitoringTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const totalRecords = monitoringFilteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / monitoringPageSize));
  if (monitoringCurrentPage > totalPages) monitoringCurrentPage = totalPages;

  const startIdx = (monitoringCurrentPage - 1) * monitoringPageSize;
  const endIdx = Math.min(startIdx + monitoringPageSize, totalRecords);
  const pageRows = monitoringFilteredList.slice(startIdx, endIdx);

  // Actualizar indicadores de paginación
  const summaryTop = document.getElementById('monitoringPaginationSummaryTop');
  const summaryBottom = document.getElementById('monitoringPaginationSummary');
  const textSummary = totalRecords > 0 
    ? `Mostrando registros <span class="font-bold text-slate-800 dark:text-slate-100">${startIdx + 1}</span> a <span class="font-bold text-slate-800 dark:text-slate-100">${endIdx}</span> de <span class="font-bold text-slate-800 dark:text-slate-100">${totalRecords.toLocaleString()}</span> equipos filtrados`
    : 'No se encontraron equipos coincidentes';

  if (summaryTop) summaryTop.innerHTML = textSummary;
  if (summaryBottom) summaryBottom.innerHTML = textSummary;

  const indTop = document.getElementById('monitoringPageIndicatorTop');
  const indBottom = document.getElementById('monitoringPageIndicator');
  const textInd = `${monitoringCurrentPage} / ${totalPages}`;
  if (indTop) indTop.textContent = textInd;
  if (indBottom) indBottom.textContent = textInd;

  if (pageRows.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="11" class="py-8 text-center text-slate-400">No hay registros que coincidan con los filtros aplicados.</td>`;
    tbody.appendChild(tr);
    return;
  }

  const fragment = document.createDocumentFragment();

  pageRows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-50 dark:hover:bg-slate-700/40 transition border-b border-slate-100 dark:border-slate-800 cursor-pointer';
    tr.onclick = (e) => {
      // Evitar abrir modal si el usuario dio clic en un botón interno
      if (e.target.closest('button')) return;
      openEquipmentHistoryModal(r.serie);
    };

    // Barra de Tóner
    let tnrBarColor = 'bg-emerald-500';
    if (r.tnrNivel === null) tnrBarColor = 'bg-slate-300 dark:bg-slate-600';
    else if (r.tnrNivel <= 10) tnrBarColor = 'bg-rose-500';
    else if (r.tnrNivel <= 20) tnrBarColor = 'bg-amber-500';

    let deltaTnrBadge = '';
    const prevDateLabel = r.prevSnapDate ? formatDateShortWithDay(r.prevSnapDate) : 'anterior';
    if (r.tnrReplaced) {
      deltaTnrBadge = `<span title="Cartucho reemplazado en sitio (antes en ${r.prevRowTnr}% el ${prevDateLabel})" class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">🔄 Nuevo</span>`;
    } else if (r.deltaTnr !== null && r.deltaTnr > 0) {
      deltaTnrBadge = `<span title="Lectura ${prevDateLabel}: ${r.prevRowTnr}% → Actual: ${r.tnrNivel}% (Consumo: -${r.deltaTnr}%)" class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">📉 -${r.deltaTnr}% <span class="text-[8px] font-normal opacity-75">vs ${prevDateLabel}</span></span>`;
    } else if (r.deltaTnr !== null && r.deltaTnr === 0 && r.prevSnapDate) {
      deltaTnrBadge = `<span title="Sin cambios respecto a ${prevDateLabel}" class="text-[9px] font-medium px-1 py-0.2 rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">➡️ 0%</span>`;
    }

    // Barra de UDI
    let udiBarColor = 'bg-emerald-500';
    if (r.udiNivel === null) udiBarColor = 'bg-slate-300 dark:bg-slate-600';
    else if (r.udiNivel <= 10) udiBarColor = 'bg-rose-500';
    else if (r.udiNivel <= 20) udiBarColor = 'bg-amber-500';

    let deltaUdiBadge = '';
    if (r.udiReplaced) {
      deltaUdiBadge = `<span title="Unidad de imagen reemplazada en sitio (antes en ${r.prevRowUdi}% el ${prevDateLabel})" class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">🔄 Nueva</span>`;
    } else if (r.deltaUdi !== null && r.deltaUdi > 0) {
      deltaUdiBadge = `<span title="Lectura ${prevDateLabel}: ${r.prevRowUdi}% → Actual: ${r.udiNivel}% (Consumo: -${r.deltaUdi}%)" class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">📉 -${r.deltaUdi}% <span class="text-[8px] font-normal opacity-75">vs ${prevDateLabel}</span></span>`;
    } else if (r.deltaUdi !== null && r.deltaUdi === 0 && r.prevSnapDate) {
      deltaUdiBadge = `<span title="Sin cambios respecto a ${prevDateLabel}" class="text-[9px] font-medium px-1 py-0.2 rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">➡️ 0%</span>`;
    }

    // Barra de KMT
    let kmtBarColor = 'bg-emerald-500';
    if (r.kmtNivel === null) kmtBarColor = 'bg-slate-300 dark:bg-slate-600';
    else if (r.kmtNivel <= 20) kmtBarColor = 'bg-amber-500';

    // Badge Diagnóstico
    let diagBadge = '';
    if (r.overallDiag === 'DESPACHO_REQUERIDO') {
      diagBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800 animate-pulse">
          <span>🚨 DESPACHO REQUERIDO</span>
        </span>
        <p class="text-[10px] text-rose-600 dark:text-rose-400 mt-0.5 font-medium leading-tight">${r.primaryReason}</p>
      `;
    } else if (r.overallDiag === 'REPOSICION_STOCK') {
      diagBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
          <span>🔄 REPONER STOCK SITIO</span>
        </span>
        <p class="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 font-medium leading-tight">${r.primaryReason}</p>
      `;
    } else if (r.overallDiag === 'STOCK_EN_SITIO') {
      diagBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
          <span>🛡️ EN STOCK EN SITIO</span>
        </span>
        <p class="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5 font-medium leading-tight">${r.primaryReason}</p>
      `;
    } else if (r.overallDiag === 'EN_TRANSITO') {
      diagBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800">
          <span>🚚 EN TRÁNSITO</span>
        </span>
        <p class="text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5 font-medium leading-tight">${r.primaryReason}</p>
      `;
    } else {
      diagBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <span>🟢 ÓPTIMO (&gt; 20%)</span>
        </span>
      `;
    }

    // Última Salida Folios
    let lastFolioHtml = '<span class="text-slate-400 italic">Sin salidas</span>';
    if (r.lastFolio) {
      const fNum = r.lastFolio['FOLIO'] || r.lastFolio['FOLIO '] || 'S/N';
      const fFecha = r.lastFolio['FECHA'] ? formatDateShort(r.lastFolio['FECHA']) : '';
      const fTipo = r.lastFolio['TIPO SUM'] || 'SUM';
      const fEst = r.lastFolio['ESTADO SUM'] || 'ENTREGADO';
      const fSerieSum = r.lastFolio['SERIE SUM'] || '';
      lastFolioHtml = `
        <div class="leading-tight">
          <span class="font-bold text-slate-800 dark:text-slate-100">Folio #${fNum}</span>
          <span class="text-[10px] text-slate-500">(${fFecha})</span>
          <p class="text-[10px] text-slate-600 dark:text-slate-300">${fTipo}: ${fSerieSum || 'Sin serie'}</p>
          <span class="text-[9px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold">${fEst}</span>
        </div>
      `;
    }

    tr.innerHTML = `
      <td class="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">${startIdx + idx + 1}</td>
      <td class="py-2.5 px-3">
        <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${
          r.cliente.includes('WALMART')
            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
            : (r.cliente.includes('BAC') ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300')
        }">${r.cliente}</span>
      </td>
      <td class="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-white">
        <div class="flex items-center gap-1">
          <span>${r.serie}</span>
          <button type="button" onclick="navigator.clipboard.writeText('${r.serie}'); showToast('Serie copiada: ${r.serie}');" title="Copiar Serie" class="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
          </button>
        </div>
      </td>
      <td class="py-2.5 px-3">
        <p class="font-medium text-slate-800 dark:text-slate-200">${r.modelo}</p>
        <span class="text-[10px] font-mono text-slate-400">${r.ip || 'Sin IP'}</span>
      </td>
      <td class="py-2.5 px-3">
        <p class="font-medium text-slate-700 dark:text-slate-300">${r.ubicacion}</p>
        ${r.det ? `<span class="text-[10px] text-slate-400 font-mono">DET: ${r.det}</span>` : ''}
      </td>
      <td class="py-2.5 px-3">
        <div class="flex items-center justify-between gap-1 mb-1">
          <span class="font-bold text-slate-800 dark:text-slate-200">${r.tnrNivel !== null ? r.tnrNivel + '%' : 'N/D'}</span>
          ${deltaTnrBadge}
        </div>
        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
          <div class="${tnrBarColor} h-1.5 rounded-full" style="width: ${r.tnrNivel !== null ? Math.max(3, Math.min(100, r.tnrNivel)) : 0}%"></div>
        </div>
        <p class="text-[10px] font-mono text-slate-400 mt-1 truncate" title="Serie TNR instalada: ${r.tnrSerie}">S: ${r.tnrSerie || 'N/D'}</p>
      </td>
      <td class="py-2.5 px-3">
        <div class="flex items-center justify-between gap-1 mb-1">
          <span class="font-bold text-slate-800 dark:text-slate-200">${r.udiNivel !== null ? r.udiNivel + '%' : 'N/D'}</span>
          ${deltaUdiBadge}
        </div>
        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
          <div class="${udiBarColor} h-1.5 rounded-full" style="width: ${r.udiNivel !== null ? Math.max(3, Math.min(100, r.udiNivel)) : 0}%"></div>
        </div>
        <p class="text-[10px] font-mono text-slate-400 mt-1 truncate" title="Serie UDI instalada: ${r.udiSerie}">S: ${r.udiSerie || 'N/D'}</p>
      </td>
      <td class="py-2.5 px-3">
        <span class="font-bold text-slate-800 dark:text-slate-200 mb-1 block">${r.kmtNivel !== null ? r.kmtNivel + '%' : 'N/D'}</span>
        <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
          <div class="${kmtBarColor} h-1.5 rounded-full" style="width: ${r.kmtNivel !== null ? Math.max(3, Math.min(100, r.kmtNivel)) : 0}%"></div>
        </div>
      </td>
      <td class="py-2.5 px-3">
        ${diagBadge}
      </td>
      <td class="py-2.5 px-3">
        ${lastFolioHtml}
      </td>
      <td class="py-2.5 px-3 text-center">
        <div class="flex items-center justify-center gap-1.5 flex-wrap">
          <button type="button" onclick="dispatchSalidaFromAlert('${r.serie}', '${r.alertSupplyType || 'TNR'}', ${r.alertLevel !== null ? r.alertLevel : 10})" title="Generar Salida en FOLIOS precargando datos" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white dark:bg-rose-950/60 dark:text-rose-300 dark:hover:bg-rose-600 dark:hover:text-white border border-rose-200 dark:border-rose-900/50 transition">
            <span>📦 Despachar</span>
          </button>
          <button type="button" onclick="dispatchTicketFromAlert('${r.serie}', '${r.modelo}', '${r.cliente}', '${r.ubicacion}')" title="Crear Ticket ODS" class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition">
            <span>🎫 Ticket</span>
          </button>
          <button type="button" onclick="openEquipmentHistoryModal('${r.serie}')" title="Ver Historial Completo del Equipo" class="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 transition">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
          </button>
        </div>
      </td>
    `;
    fragment.appendChild(tr);
  });

  tbody.appendChild(fragment);
}

// Acción Rápida: Despachar Salida Precargada en FOLIOS
function dispatchSalidaFromAlert(serie, tipoSum, nivel) {
  const match = monitoringProcessedList.find(r => r.serie === serie);
  const modelo = match ? match.modelo : '';
  const cliente = match ? match.cliente : '';
  const destino = match ? match.ubicacion : '';
  const det = match ? match.det : '';

  openNewSalidaModal({
    serie,
    tipoSum: tipoSum || 'TNR',
    modelo,
    cliente,
    destino,
    det,
    descripcion: `Despacho preventivo de ${tipoSum || 'TNR'} por alerta de monitoreo (Nivel actual: ${nivel !== null ? nivel + '%' : 'Bajo'})`
  });
}

// Acción Rápida: Crear Ticket Precargado en ODS
function dispatchTicketFromAlert(serie, modelo, cliente, ubicacion) {
  openNewTicketModal({
    serie,
    modelo,
    cliente,
    tienda: ubicacion,
    falla: 'Alerta de monitoreo de suministros / Desgaste crítico'
  });
}

// MODAL DE HISTORIAL DEL EQUIPO
function openEquipmentHistoryModal(serie) {
  const modal = document.getElementById('modalEquipmentHistory');
  if (!modal) return;

  const serieUpper = serie.toUpperCase();
  const rdiInfo = (typeof rdiMapBySerie !== 'undefined') ? rdiMapBySerie.get(serieUpper) : null;
  const matchProcessed = monitoringProcessedList.find(r => r.serie === serieUpper);

  // 1. Títulos
  document.getElementById('modalEquipHistoryTitle').textContent = `Ficha Técnica: ${serieUpper}`;
  document.getElementById('modalEquipHistorySubtitle').textContent = `${matchProcessed ? matchProcessed.cliente : (rdiInfo ? rdiInfo.CLIENTE : 'Cliente')} • ${matchProcessed ? matchProcessed.modelo : (rdiInfo ? rdiInfo.MOD : 'Modelo')} • ${matchProcessed ? matchProcessed.ubicacion : (rdiInfo ? rdiInfo.TIENDA : 'Ubicación')}`;

  // 2. Ficha Resumen RDI
  const summaryContainer = document.getElementById('modalEquipSummaryCard');
  if (summaryContainer) {
    summaryContainer.innerHTML = `
      <div>
        <p class="text-slate-400 text-[10px] uppercase font-semibold">Serie Impresor</p>
        <p class="font-mono font-bold text-slate-800 dark:text-white mt-0.5">${serieUpper}</p>
      </div>
      <div>
        <p class="text-slate-400 text-[10px] uppercase font-semibold">Modelo</p>
        <p class="font-bold text-slate-800 dark:text-white mt-0.5">${rdiInfo ? rdiInfo.MOD : (matchProcessed ? matchProcessed.modelo : 'N/D')}</p>
      </div>
      <div>
        <p class="text-slate-400 text-[10px] uppercase font-semibold">Cliente</p>
        <p class="font-bold text-slate-800 dark:text-white mt-0.5">${rdiInfo ? rdiInfo.CLIENTE : (matchProcessed ? matchProcessed.cliente : 'N/D')}</p>
      </div>
      <div>
        <p class="text-slate-400 text-[10px] uppercase font-semibold">Tienda / Ubicación</p>
        <p class="font-bold text-slate-800 dark:text-white mt-0.5">${rdiInfo ? rdiInfo.TIENDA : (matchProcessed ? matchProcessed.ubicacion : 'N/D')}</p>
      </div>
      <div>
        <p class="text-slate-400 text-[10px] uppercase font-semibold">DET / Código</p>
        <p class="font-mono font-bold text-slate-800 dark:text-white mt-0.5">${rdiInfo ? rdiInfo.DET : (matchProcessed ? matchProcessed.det : 'N/D')}</p>
      </div>
      <div>
        <p class="text-slate-400 text-[10px] uppercase font-semibold">Dirección IP</p>
        <p class="font-mono text-slate-700 dark:text-slate-300 mt-0.5">${matchProcessed ? matchProcessed.ip : 'N/D'}</p>
      </div>
      <div>
        <p class="text-slate-400 text-[10px] uppercase font-semibold">Diagnóstico Actual</p>
        <p class="font-bold text-rose-600 dark:text-rose-400 mt-0.5">${matchProcessed ? matchProcessed.overallDiag : 'OPTIMO'}</p>
      </div>
      <div>
        <p class="text-slate-400 text-[10px] uppercase font-semibold">Propiedad</p>
        <p class="font-bold text-slate-700 dark:text-slate-300 mt-0.5">${rdiInfo ? rdiInfo.PROPIEDAD : 'IEXCA'}</p>
      </div>
    `;
  }

  // 3. Histórico de Capturas Semanales de Monitoreo
  const snapshotsBody = document.getElementById('modalEquipSnapshotsBody');
  if (snapshotsBody) {
    snapshotsBody.innerHTML = '';
    const historyRows = [];

    Object.keys(monitoringData).forEach(cName => {
      const snaps = monitoringData[cName] || [];
      snaps.forEach(snap => {
        const found = snap.rows.find(r => r.serie.toUpperCase() === serieUpper);
        if (found) {
          historyRows.push({
            uploadDate: snap.uploadDate,
            fileName: snap.fileName,
            ...found
          });
        }
      });
    });

    // Ordenar de más reciente a más antiguo
    historyRows.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

    if (historyRows.length === 0) {
      snapshotsBody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-slate-400">Sin lecturas registradas para esta serie.</td></tr>`;
    } else {
      historyRows.forEach((h, idx) => {
        const nextOlder = idx + 1 < historyRows.length ? historyRows[idx + 1] : null;
        let deltaTnrText = '';
        if (nextOlder && nextOlder.tnrNivel !== null && h.tnrNivel !== null) {
          const diff = nextOlder.tnrNivel - h.tnrNivel;
          if (diff > 0) {
            deltaTnrText = ` <span class="text-rose-600 font-bold text-[10px]">(-${diff}%)</span>`;
          } else if (nextOlder.tnrNivel <= 20 && h.tnrNivel >= 80) {
            deltaTnrText = ` <span class="text-amber-600 font-bold text-[10px]">🔄 Reemplazado</span>`;
          } else if (diff === 0) {
            deltaTnrText = ` <span class="text-slate-400 font-normal text-[10px]">(0%)</span>`;
          }
        }

        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 dark:border-slate-800 text-xs';
        tr.innerHTML = `
          <td class="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">${formatDateTimeWithDay(h.uploadDate)}</td>
          <td class="py-2 px-3 font-bold text-slate-900 dark:text-white">${h.tnrNivel !== null ? h.tnrNivel + '%' : 'N/D'}${deltaTnrText}</td>
          <td class="py-2 px-3 font-mono text-slate-600 dark:text-slate-300 text-[11px]">${h.tnrSerie || 'N/D'}</td>
          <td class="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">${h.udiNivel !== null ? h.udiNivel + '%' : 'N/D'}</td>
          <td class="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">${h.kmtNivel !== null ? h.kmtNivel + '%' : 'N/D'}</td>
          <td class="py-2 px-3 font-mono text-slate-500">${h.paginasCarro || 'N/D'}</td>
          <td class="py-2 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${
              h.estadoSuministro === 'Advertencia'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
            }">${h.estadoSuministro}</span>
          </td>
        `;
        snapshotsBody.appendChild(tr);
      });
    }
  }

  // 4. Salidas Registradas en FOLIOS para este equipo
  const foliosBody = document.getElementById('modalEquipFoliosBody');
  if (foliosBody) {
    foliosBody.innerHTML = '';
    const allFolios = (typeof sheetStore !== 'undefined' && sheetStore['FOLIOS']) ? sheetStore['FOLIOS'] : [];
    const equipFolios = allFolios.filter(f => (f['SERIE'] || '').toString().trim().toUpperCase() === serieUpper).reverse();

    if (equipFolios.length === 0) {
      foliosBody.innerHTML = `<tr><td colspan="7" class="py-4 text-center text-slate-400">Sin salidas registradas en la hoja FOLIOS para esta serie.</td></tr>`;
    } else {
      equipFolios.forEach(f => {
        const folNum = f['FOLIO'] || f['FOLIO '] || 'S/N';
        const fFecha = f['FECHA'] ? formatDateShort(f['FECHA']) : 'N/D';
        const fTipo = f['TIPO SUM'] || 'SUM';
        const fDesc = f['DESCRIPCION'] || f['DESCRIPCIÓN'] || '';
        const fSerie = f['SERIE SUM'] || 'Sin serie';
        const fCant = f['CANT'] || 1;
        const fEst = f['ESTADO SUM'] || 'ENTREGADO';

        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 dark:border-slate-800 text-xs';
        tr.innerHTML = `
          <td class="py-2 px-3 font-bold font-mono text-slate-900 dark:text-white">Folio #${folNum}</td>
          <td class="py-2 px-3 text-slate-600 dark:text-slate-300">${fFecha}</td>
          <td class="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">${fTipo}</td>
          <td class="py-2 px-3 text-slate-700 dark:text-slate-300">${fDesc}</td>
          <td class="py-2 px-3 font-mono text-slate-800 dark:text-slate-100">${fSerie}</td>
          <td class="py-2 px-3 text-center font-bold text-slate-800 dark:text-slate-200">${fCant}</td>
          <td class="py-2 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${
              fEst === 'ENTREGADO' 
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
            }">${fEst}</span>
          </td>
        `;
        foliosBody.appendChild(tr);
      });
    }
  }

  modal.classList.remove('hidden');
}

function closeEquipmentHistoryModal() {
  const modal = document.getElementById('modalEquipmentHistory');
  if (modal) modal.classList.add('hidden');
}

// Manejadores de Drag & Drop y Selección de Archivos CSV
function handleMonitoringFileInput(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  processMonitoringFiles(Array.from(files));
  e.target.value = '';
}

function handleMonitoringDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  const zone = document.getElementById('monitoringDropZone');
  if (zone) zone.classList.add('border-rose-500', 'bg-rose-50/20');
}

function handleMonitoringDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  const zone = document.getElementById('monitoringDropZone');
  if (zone) zone.classList.remove('border-rose-500', 'bg-rose-50/20');
}

function handleMonitoringDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const zone = document.getElementById('monitoringDropZone');
  if (zone) zone.classList.remove('border-rose-500', 'bg-rose-50/20');

  const dt = e.dataTransfer;
  if (dt && dt.files && dt.files.length > 0) {
    processMonitoringFiles(Array.from(dt.files));
  }
}

function processMonitoringFiles(files) {
  const csvFiles = files.filter(f => f.name.toLowerCase().endsWith('.csv'));
  if (csvFiles.length === 0) {
    alert("Por favor selecciona archivos con formato .CSV de monitoreo.");
    return;
  }

  let processedCount = 0;
  csvFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result;
      const rows = parseLexmarkFleetCsv(text, file.name);
      if (rows && rows.length > 0) {
        const clientName = detectClientFromCsvRows(rows, file.name);
        addMonitoringSnapshot(clientName, file.name, rows);
      } else {
        console.warn(`El archivo ${file.name} no contiene filas válidas de impresores.`);
      }
      processedCount++;
    };
    reader.readAsText(file, 'UTF-8');
  });
}

// Exportación de Auditoría a Excel (.xlsx)
function exportMonitoringAuditToExcel() {
  if (typeof XLSX === 'undefined') {
    alert("Librería SheetJS no encontrada.");
    return;
  }

  if (monitoringProcessedList.length === 0) {
    alert("No hay datos de monitoreo para exportar.");
    return;
  }

  const exportData = monitoringProcessedList.map((r, i) => {
    const lastF = r.lastFolio;
    const fNum = lastF ? (lastF['FOLIO'] || lastF['FOLIO '] || '') : '';
    const fFecha = lastF && lastF['FECHA'] ? formatDateShort(lastF['FECHA']) : '';
    const fSerieSum = lastF ? (lastF['SERIE SUM'] || '') : '';
    const fEstado = lastF ? (lastF['ESTADO SUM'] || '') : '';

    let accion = 'Nivel Óptimo';
    if (r.overallDiag === 'DESPACHO_REQUERIDO') accion = 'DESPACHAR SALIDA URGENTE';
    else if (r.overallDiag === 'REPOSICION_STOCK') accion = 'DESPACHAR REPOSICIÓN DE STOCK EN SITIO';
    else if (r.overallDiag === 'EN_TRANSITO') accion = 'VALIDAR ENTREGA EN CAMINO';
    else if (r.overallDiag === 'STOCK_EN_SITIO') accion = 'CLIENTE PROTEGIDO (YA TIENE REPUESTO EN SITIO)';

    return {
      '#': i + 1,
      'CLIENTE': r.cliente,
      'SERIE IMPRESOR': r.serie,
      'MODELO': r.modelo,
      'DIRECCIÓN IP': r.ip,
      'TIENDA / UBICACIÓN': r.ubicacion,
      'DET': r.det,
      'TNR (%)': r.tnrNivel !== null ? r.tnrNivel : '',
      'CAÍDA TNR (Δ %)': r.deltaTnr !== null ? r.deltaTnr : '',
      'SERIE TNR INSTALADA': r.tnrSerie,
      'TÓNER REEMPLAZADO': r.tnrReplaced ? 'SÍ' : 'NO',
      'PÁGINAS CARRO': r.paginasCarro,
      'UDI (%)': r.udiNivel !== null ? r.udiNivel : '',
      'CAÍDA UDI (Δ %)': r.deltaUdi !== null ? r.deltaUdi : '',
      'SERIE UDI INSTALADA': r.udiSerie,
      'UDI REEMPLAZADA': r.udiReplaced ? 'SÍ' : 'NO',
      'KMT (%)': r.kmtNivel !== null ? r.kmtNivel : '',
      'DIAGNÓSTICO STOCK EN SITIO': r.overallDiag,
      'DETALLE DE DIAGNÓSTICO': r.primaryReason,
      'ÚLTIMO FOLIO DESPACHADO': fNum,
      'FECHA ÚLTIMA SALIDA': fFecha,
      'SERIE SUM DESPACHADA': fSerieSum,
      'ESTADO SALIDA': fEstado,
      'ACCIÓN RECOMENDADA': accion
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(exportData);

  // Anchos de columna automáticos
  const colWidths = [
    { wch: 5 }, { wch: 15 }, { wch: 18 }, { wch: 22 }, { wch: 15 },
    { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 20 },
    { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 20 },
    { wch: 16 }, { wch: 10 }, { wch: 24 }, { wch: 45 }, { wch: 18 },
    { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 30 }
  ];
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, "Auditoria_Monitoreo");
  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Auditoria_Suministros_Stock_En_Sitio_${dateStr}.xlsx`);

  if (typeof showToast === 'function') {
    showToast("📊 Auditoría de Monitoreo exportada exitosamente a Excel.");
  }
}

// Compatibilidad dual Browser Window y Node.js
if (typeof window !== 'undefined') {
  window.monitoringData = monitoringData;
  window.initMonitoringModule = initMonitoringModule;
  window.refreshMonitoringAnalysis = refreshMonitoringAnalysis;
  window.filterMonitoringTable = filterMonitoringTable;
  window.renderMonitoringTable = renderMonitoringTable;
  window.changeMonitoringPageSize = changeMonitoringPageSize;
  window.monitoringFirstPage = monitoringFirstPage;
  window.monitoringPrevPage = monitoringPrevPage;
  window.monitoringNextPage = monitoringNextPage;
  window.monitoringLastPage = monitoringLastPage;
  window.onMonitoringSnapshotChange = onMonitoringSnapshotChange;
  window.dispatchSalidaFromAlert = dispatchSalidaFromAlert;
  window.dispatchTicketFromAlert = dispatchTicketFromAlert;
  window.openEquipmentHistoryModal = openEquipmentHistoryModal;
  window.closeEquipmentHistoryModal = closeEquipmentHistoryModal;
  window.handleMonitoringFileInput = handleMonitoringFileInput;
  window.handleMonitoringDragOver = handleMonitoringDragOver;
  window.handleMonitoringDragLeave = handleMonitoringDragLeave;
  window.handleMonitoringDrop = handleMonitoringDrop;
  window.deleteMonitoringClient = deleteMonitoringClient;
  window.resetMonitoringToDefault = resetMonitoringToDefault;
  window.exportMonitoringAuditToExcel = exportMonitoringAuditToExcel;
  window.parseLexmarkFleetCsv = parseLexmarkFleetCsv;
  window.detectClientFromCsvRows = detectClientFromCsvRows;
  window.addMonitoringSnapshot = addMonitoringSnapshot;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseLexmarkFleetCsv,
    detectClientFromCsvRows,
    addMonitoringSnapshot,
    refreshMonitoringAnalysis,
    filterMonitoringTable,
    renderMonitoringTable,
    initMonitoringModule,
    exportMonitoringAuditToExcel,
    getMonitoringData: () => monitoringData,
    setMonitoringData: (d) => { monitoringData = d; },
    getMonitoringProcessedList: () => monitoringProcessedList
  };
}
