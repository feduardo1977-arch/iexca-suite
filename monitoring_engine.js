// MÓDULO DE AUDITORÍA Y MONITOREO DE SUMINISTROS (CSV FLEET) & STOCK EN SITIO
// Este archivo contiene la lógica completa del motor de diagnóstico y gestión de snapshots.

let monitoringData = {}; // { 'WALMART': [ snapshot1, snapshot2 ], 'BAC': [ ... ] }
// Precargar datos síncronamente si DEFAULT_MONITORING_DATA ya está definido en el navegador
if (typeof window !== 'undefined' && window.DEFAULT_MONITORING_DATA) {
  try {
    monitoringData = JSON.parse(JSON.stringify(window.DEFAULT_MONITORING_DATA));
  } catch (e) {}
}

let activeMonitoringClient = 'ALL';
let activeMonitoringSnapshot = 'LATEST';
let monitoringSearchQuery = '';
let monitoringFilterStatus = 'ALL';
let monitoringFilterSupply = 'ALL';
let monitoringFilterPercent = 'ALL';
let monitoringCurrentPage = 1;
let monitoringPageSize = (typeof window !== 'undefined' && window.innerWidth < 768) ? 25 : 50;
let monitoringProcessedList = [];
let monitoringFilteredList = [];
let monitoringSelectedTnrLevels = new Set();
let monitoringSelectedUdiLevels = new Set();
let monitoringSelectedKmtLevels = new Set();
let activeSupplyPopoverType = null; // 'TNR' | 'UDI' | 'KMT'
let popoverSearchQuery = '';
let monitoringViewMode = 'auto'; // 'auto' (cards en móvil <768px, tabla en desktop), 'cards', 'table'
let isMonitoringInitialized = false;
let isMonitoringLoadingDB = false;

function setMonitoringViewMode(mode) {
  monitoringViewMode = mode;
  const btnCards = document.getElementById('btnMonitoringViewCards');
  const btnTable = document.getElementById('btnMonitoringViewTable');
  const cardsCont = document.getElementById('monitoringMobileCardsContainer');
  const tableCont = document.getElementById('monitoringTableContainer');
  const swipeBanner = document.getElementById('monitoringMobileSwipeBanner');

  if (mode === 'cards') {
    if (btnCards) {
      btnCards.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-2xs transition';
    }
    if (btnTable) {
      btnTable.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition';
    }
    if (cardsCont) cardsCont.classList.remove('hidden');
    if (tableCont) tableCont.classList.add('hidden');
    if (swipeBanner) swipeBanner.classList.add('hidden');
  } else {
    // mode === 'table'
    if (btnCards) {
      btnCards.className = 'px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition';
    }
    if (btnTable) {
      btnTable.className = 'px-2.5 py-1 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 shadow-2xs transition';
    }
    if (cardsCont) cardsCont.classList.add('hidden');
    if (tableCont) tableCont.classList.remove('hidden');
    if (swipeBanner) swipeBanner.classList.remove('hidden');
  }

  // Renderizar la vista seleccionada si hay datos listos
  if (monitoringFilteredList && monitoringFilteredList.length > 0) {
    renderMonitoringTable();
  }
}

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
function initMonitoringModule(force = false) {
  if (isMonitoringInitialized && !force) {
    return;
  }
  isMonitoringInitialized = true;

  // Inicialización síncrona inmediata si aún no hay datos en memoria
  if ((!monitoringData || Object.keys(monitoringData).length === 0) && typeof window !== 'undefined' && window.DEFAULT_MONITORING_DATA) {
    monitoringData = JSON.parse(JSON.stringify(window.DEFAULT_MONITORING_DATA));
  }

  // Detectar automáticamente modo de vista si está en 'auto'
  if (typeof window !== 'undefined' && monitoringViewMode === 'auto') {
    const isMobile = window.innerWidth < 768;
    setMonitoringViewMode(isMobile ? 'cards' : 'table');
  }

  refreshMonitoringAnalysis();

  // Carga asíncrona desde IndexedDB una sola vez
  if (!isMonitoringLoadingDB) {
    isMonitoringLoadingDB = true;
    loadMonitoringFromIndexedDB((loaded) => {
      if (!loaded) {
        if ((!monitoringData || Object.keys(monitoringData).length === 0) && typeof window !== 'undefined' && window.DEFAULT_MONITORING_DATA) {
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
}

// EVALUACIÓN DE STOCK EN SITIO POR FOLIO Y SERIE DE SUMINISTRO
function evaluateFolioStockStatus(folio, currentInstalledSerie) {
  if (!folio) return { inStock: false, inTransit: false, consumed: false, status: 'NONE' };

  const est = (folio['ESTADO SUM'] || folio['ESTADO'] || 'ENTREGADO').toString().trim().toUpperCase();
  const folSerie = (folio['SERIE SUM'] || folio['SERIE'] || '').toString().trim().toUpperCase();
  const folNum = folio['FOLIO'] || folio['FOLIO '] || 'S/N';

  // 1. Estados explícitos de STOCK disponible en sitio (Reserva no consumida en tienda)
  if (est === 'EN STOCK' || est === 'STOCK' || est === 'EN SITIO' || est === 'EN_STOCK' || 
      est === 'STOCK EN SITIO' || est === 'DISPONIBLE' || est === 'RESERVA' || est === 'NUEVO') {
    return { inStock: true, inTransit: false, consumed: false, status: 'STOCK', folio, folNum, folSerie, est };
  }

  // 2. Estados en tránsito / camino
  if (est === 'EN TRANSITO' || est === 'EN TRÁNSITO' || est === 'ENVIADO' || est === 'EN RUTA' || 
      est === 'PENDIENTE' || est === 'POR ENTREGAR' || est === 'DESPACHADO') {
    return { inStock: false, inTransit: true, consumed: false, status: 'TRANSIT', folio, folNum, folSerie, est };
  }

  // 3. Estados consumidos o ya instalados en el equipo (reserva agotada)
  if (est === 'INSTALADO' || est === 'CONSUMIDO' || est === 'COLOCADO' || est === 'AGOTADO' || 
      est === 'USADO' || est === 'PUESTO' || est === 'AGOTADA') {
    return { inStock: false, inTransit: false, consumed: true, status: 'CONSUMED', folio, folNum, folSerie, est };
  }

  // 4. ENTREGADO / RECIBIDO:
  // Si la serie del cartucho despachado coincide con la serie del cartucho actualmente instalado en el impresor,
  // significa que ya fue colocado y se encuentra en uso (y si el nivel está bajo <= 15%, está agotándose).
  if (folSerie && currentInstalledSerie && folSerie === currentInstalledSerie) {
    return { inStock: false, inTransit: false, consumed: true, status: 'INSTALLED_MATCH', folio, folNum, folSerie, est };
  }

  // Si no coincide con la serie instalada o no tiene serie, se asume que está entregado en sitio como reserva disponible.
  return { inStock: true, inTransit: false, consumed: false, status: 'DELIVERED_SPARE', folio, folNum, folSerie, est };
}

// MOTOR DE DIAGNÓSTICO INTELIGENTE & CRUCE CON FOLIOS Y RDI
function refreshMonitoringAnalysis() {
  // 1. Indexar y clasificar Folios por Serie de Equipo O(N) una sola vez
  const foliosBySerie = new Map();
  const allFolios = (typeof sheetStore !== 'undefined' && sheetStore['FOLIOS']) ? sheetStore['FOLIOS'] : [];

  // Asegurar indexación de metadatos numéricos _ts y _folioNum para comparación rápida
  if (typeof indexFoliosMetadata === 'function') {
    indexFoliosMetadata(allFolios);
  }

  allFolios.forEach(f => {
    const ser = (f['SERIE'] || '').toString().trim().toUpperCase();
    if (!ser) return;
    let entry = foliosBySerie.get(ser);
    if (!entry) {
      entry = { all: [], tnr: [], udi: [], kmt: [] };
      foliosBySerie.set(ser, entry);
    }
    entry.all.push(f);

    const t = (f['TIPO SUM'] || f['TIPO'] || '').toString().trim().toUpperCase();
    const d = (f['DESCRIPCION'] || f['DESCRIPCIÓN'] || '').toString().trim().toUpperCase();

    if (t === 'TNR' || t.includes('TONER') || t.includes('TNR') || d.includes('TONER') || d.includes('TNR')) {
      entry.tnr.push(f);
    }
    if (t === 'UDI' || t.includes('IMAGEN') || t.includes('DRUM') || t.includes('UDI') || d.includes('IMAGEN') || d.includes('DRUM') || d.includes('UDI')) {
      entry.udi.push(f);
    }
    if (t === 'KMT' || t.includes('MANT') || t.includes('FUSOR') || t.includes('KMT') || d.includes('MANTENIMIENTO') || d.includes('FUSOR') || d.includes('KMT')) {
      entry.kmt.push(f);
    }
  });

  // Ordenar cada lista de cada serie una sola vez usando comparación numérica directa
  const sortFoliosFn = (a, b) => {
    const tsA = a._ts !== undefined ? a._ts : (typeof getRowDateTimestamp === 'function' ? getRowDateTimestamp(a) : 0);
    const tsB = b._ts !== undefined ? b._ts : (typeof getRowDateTimestamp === 'function' ? getRowDateTimestamp(b) : 0);
    if (tsB !== tsA) return tsB - tsA;
    const numA = a._folioNum !== undefined ? a._folioNum : (parseInt(String(a['FOLIO'] || a['FOLIO '] || '').replace(/\D/g, ''), 10) || 0);
    const numB = b._folioNum !== undefined ? b._folioNum : (parseInt(String(b['FOLIO'] || b['FOLIO '] || '').replace(/\D/g, ''), 10) || 0);
    return numB - numA;
  };

  foliosBySerie.forEach(entry => {
    entry.all.sort(sortFoliosFn);
    entry.tnr.sort(sortFoliosFn);
    entry.udi.sort(sortFoliosFn);
    entry.kmt.sort(sortFoliosFn);
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
            (prevRow.tnrNivel !== null && prevRow.tnrNivel <= 15 && row.tnrNivel !== null && row.tnrNivel >= 80)) {
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
            (prevRow.udiNivel !== null && prevRow.udiNivel <= 5 && row.udiNivel !== null && row.udiNivel >= 80)) {
          udiReplaced = true;
        }
      }

      let deltaKmt = null;
      if (prevRow && prevRow.kmtNivel !== null && row.kmtNivel !== null) {
        deltaKmt = prevRow.kmtNivel - row.kmtNivel;
      }

      // Alertas de Nivel Bajo (Reglas operativas actualizadas: TNR <= 15%, UDI <= 5%, KMT <= 3%)
      const isTnrLow = (row.tnrNivel !== null && row.tnrNivel <= 15) || 
                       (row.estadoSuministro === 'Advertencia' && (row.tnrNivel === null || row.tnrNivel <= 15));
      const isUdiLow = (row.udiNivel !== null && row.udiNivel <= 5) || 
                       (row.estadoSuministro === 'Advertencia' && row.udiNivel <= 5);
      const isKmtLow = (row.kmtNivel !== null && row.kmtNivel <= 3);

      // Salidas registradas en FOLIOS pre-clasificadas y pre-ordenadas cronológicamente O(1)
      const equipEntry = foliosBySerie.get(serieUpper) || { all: [], tnr: [], udi: [], kmt: [] };
      const sortedFolios = equipEntry.all;
      const tnrFolios = equipEntry.tnr;
      const udiFolios = equipEntry.udi;
      const kmtFolios = equipEntry.kmt;

      const lastTnrFolio = tnrFolios[0] || null;
      const lastUdiFolio = udiFolios[0] || null;
      const lastKmtFolio = kmtFolios[0] || null;

      // Evaluar stock disponible por tipo
      // 1. TNR: Buscar si tiene algún folio con stock disponible para TNR
      let stockTnrEvaluation = null;
      for (const f of tnrFolios) {
        const ev = evaluateFolioStockStatus(f, row.tnrSerie);
        if (ev.inStock || ev.inTransit) {
          stockTnrEvaluation = ev;
          break;
        }
      }
      if (!stockTnrEvaluation && lastTnrFolio) {
        stockTnrEvaluation = evaluateFolioStockStatus(lastTnrFolio, row.tnrSerie);
      }

      // 2. UDI: Buscar si tiene algún folio con stock disponible para UDI
      let stockUdiEvaluation = null;
      for (const f of udiFolios) {
        const ev = evaluateFolioStockStatus(f, row.udiSerie);
        if (ev.inStock || ev.inTransit) {
          stockUdiEvaluation = ev;
          break;
        }
      }
      if (!stockUdiEvaluation && lastUdiFolio) {
        stockUdiEvaluation = evaluateFolioStockStatus(lastUdiFolio, row.udiSerie);
      }

      // 3. KMT: Buscar si tiene algún folio con stock disponible para KMT
      let stockKmtEvaluation = null;
      for (const f of kmtFolios) {
        const ev = evaluateFolioStockStatus(f, null);
        if (ev.inStock || ev.inTransit) {
          stockKmtEvaluation = ev;
          break;
        }
      }
      if (!stockKmtEvaluation && lastKmtFolio) {
        stockKmtEvaluation = evaluateFolioStockStatus(lastKmtFolio, null);
      }

      // DIAGNÓSTICO TNR
      let diagTnr = 'OPTIMO';
      let reasonTnr = '';
      if (tnrReplaced) {
        diagTnr = 'REPOSICION_STOCK';
        reasonTnr = '🔄 Tóner cambiado en sitio. Reserva consumida, stock en tienda quedó en 0.';
      } else if (isTnrLow) {
        if (!stockTnrEvaluation || (!stockTnrEvaluation.inStock && !stockTnrEvaluation.inTransit)) {
          diagTnr = 'DESPACHO_REQUERIDO';
          if (stockTnrEvaluation && stockTnrEvaluation.consumed) {
            reasonTnr = `🚨 Tóner en ${row.tnrNivel !== null ? row.tnrNivel + '%' : 'bajo'}. Tóner de Folio #${stockTnrEvaluation.folNum} ya fue instalado/agotado. Requiere nuevo despacho.`;
          } else {
            reasonTnr = `🚨 Tóner en ${row.tnrNivel !== null ? row.tnrNivel + '%' : 'bajo'}. Sin registro de tóner en stock en FOLIOS.`;
          }
        } else if (stockTnrEvaluation.inTransit) {
          diagTnr = 'EN_TRANSITO';
          reasonTnr = `🚚 Despacho de tóner en camino (Folio #${stockTnrEvaluation.folNum} - ${stockTnrEvaluation.est})`;
        } else if (stockTnrEvaluation.inStock) {
          diagTnr = 'STOCK_EN_SITIO';
          reasonTnr = `🛡️ Tienda tiene tóner (TNR) en STOCK en sitio (Folio #${stockTnrEvaluation.folNum}${stockTnrEvaluation.folSerie ? ' - Serie: ' + stockTnrEvaluation.folSerie : ''}). Envío descartado.`;
        }
      }

      // DIAGNÓSTICO UDI
      let diagUdi = 'OPTIMO';
      let reasonUdi = '';
      if (udiReplaced) {
        diagUdi = 'REPOSICION_STOCK';
        reasonUdi = '🔄 Unidad de imagen cambiada en sitio. Reserva consumida, stock en 0.';
      } else if (isUdiLow) {
        if (!stockUdiEvaluation || (!stockUdiEvaluation.inStock && !stockUdiEvaluation.inTransit)) {
          diagUdi = 'DESPACHO_REQUERIDO';
          if (stockUdiEvaluation && stockUdiEvaluation.consumed) {
            reasonUdi = `🚨 UDI en ${row.udiNivel !== null ? row.udiNivel + '%' : 'baja'}. UDI de Folio #${stockUdiEvaluation.folNum} ya fue instalada/agotada. Requiere nuevo despacho.`;
          } else {
            reasonUdi = `🚨 UDI en ${row.udiNivel !== null ? row.udiNivel + '%' : 'baja'}. Sin registro de UDI en stock en FOLIOS.`;
          }
        } else if (stockUdiEvaluation.inTransit) {
          diagUdi = 'EN_TRANSITO';
          reasonUdi = `🚚 Despacho de UDI en camino (Folio #${stockUdiEvaluation.folNum} - ${stockUdiEvaluation.est})`;
        } else if (stockUdiEvaluation.inStock) {
          diagUdi = 'STOCK_EN_SITIO';
          reasonUdi = `🛡️ Tienda tiene Unidad de Imagen (UDI) en STOCK en sitio (Folio #${stockUdiEvaluation.folNum}${stockUdiEvaluation.folSerie ? ' - Serie: ' + stockUdiEvaluation.folSerie : ''}). Envío descartado.`;
        }
      }

      // DIAGNÓSTICO KMT
      let diagKmt = 'OPTIMO';
      let reasonKmt = '';
      if (isKmtLow) {
        if (!stockKmtEvaluation || (!stockKmtEvaluation.inStock && !stockKmtEvaluation.inTransit)) {
          diagKmt = 'DESPACHO_REQUERIDO';
          reasonKmt = `🚨 Kit de Mantenimiento en ${row.kmtNivel}%. Sin salidas registradas en FOLIOS.`;
        } else if (stockKmtEvaluation.inTransit) {
          diagKmt = 'EN_TRANSITO';
          reasonKmt = `🚚 Kit de Mantenimiento en camino (Folio #${stockKmtEvaluation.folNum})`;
        } else {
          diagKmt = 'STOCK_EN_SITIO';
          reasonKmt = `🛡️ Kit de Mantenimiento en STOCK en sitio (Folio #${stockKmtEvaluation.folNum}). Envío descartado.`;
        }
      }

      // DIAGNÓSTICO GENERAL DEL EQUIPO (Por prioridad de criticidad)
      let overallDiag = 'OPTIMO';
      let primaryReason = 'Niveles de suministros en rango seguro (TNR > 15%, UDI > 5%, KMT > 3%).';
      let alertSupplyType = null;
      let alertLevel = null;
      let relevantFolio = sortedFolios[0] || null;

      // 1. DESPACHO REQUERIDO (Alerta Urgente)
      if (diagTnr === 'DESPACHO_REQUERIDO' && diagUdi === 'DESPACHO_REQUERIDO') {
        overallDiag = 'DESPACHO_REQUERIDO';
        primaryReason = `🚨 Despacho requerido: Tóner (${row.tnrNivel}%) y UDI (${row.udiNivel}%) críticos sin stock en sitio.`;
        alertSupplyType = ((row.tnrNivel !== null ? row.tnrNivel : 15) <= (row.udiNivel !== null ? row.udiNivel : 5) ? 'TNR' : 'UDI');
        alertLevel = Math.min(row.tnrNivel !== null ? row.tnrNivel : 15, row.udiNivel !== null ? row.udiNivel : 5);
        relevantFolio = (alertSupplyType === 'TNR' ? lastTnrFolio : lastUdiFolio) || sortedFolios[0];
      } else if (diagTnr === 'DESPACHO_REQUERIDO') {
        overallDiag = 'DESPACHO_REQUERIDO';
        primaryReason = reasonTnr + (diagUdi === 'STOCK_EN_SITIO' ? ` (UDI cuenta con stock en tienda: Folio #${stockUdiEvaluation.folNum})` : '');
        alertSupplyType = 'TNR';
        alertLevel = row.tnrNivel;
        relevantFolio = lastTnrFolio || sortedFolios[0];
      } else if (diagUdi === 'DESPACHO_REQUERIDO') {
        overallDiag = 'DESPACHO_REQUERIDO';
        primaryReason = reasonUdi + (diagTnr === 'STOCK_EN_SITIO' ? ` (Tóner cuenta con stock en tienda: Folio #${stockTnrEvaluation.folNum})` : '');
        alertSupplyType = 'UDI';
        alertLevel = row.udiNivel;
        relevantFolio = lastUdiFolio || sortedFolios[0];
      } else if (diagKmt === 'DESPACHO_REQUERIDO') {
        overallDiag = 'DESPACHO_REQUERIDO';
        primaryReason = reasonKmt;
        alertSupplyType = 'KMT';
        alertLevel = row.kmtNivel;
        relevantFolio = lastKmtFolio || sortedFolios[0];
      } 
      // 2. REPOSICIÓN DE STOCK (Consumido recientemente en sitio)
      else if (diagTnr === 'REPOSICION_STOCK') {
        overallDiag = 'REPOSICION_STOCK';
        primaryReason = reasonTnr;
        alertSupplyType = 'TNR';
        alertLevel = row.tnrNivel;
        relevantFolio = lastTnrFolio || sortedFolios[0];
      } else if (diagUdi === 'REPOSICION_STOCK') {
        overallDiag = 'REPOSICION_STOCK';
        primaryReason = reasonUdi;
        alertSupplyType = 'UDI';
        alertLevel = row.udiNivel;
        relevantFolio = lastUdiFolio || sortedFolios[0];
      } 
      // 3. EN TRÁNSITO
      else if (diagTnr === 'EN_TRANSITO' || diagUdi === 'EN_TRANSITO' || diagKmt === 'EN_TRANSITO') {
        overallDiag = 'EN_TRANSITO';
        if (diagTnr === 'EN_TRANSITO') {
          primaryReason = reasonTnr;
          alertSupplyType = 'TNR';
          alertLevel = row.tnrNivel;
          relevantFolio = lastTnrFolio;
        } else if (diagUdi === 'EN_TRANSITO') {
          primaryReason = reasonUdi;
          alertSupplyType = 'UDI';
          alertLevel = row.udiNivel;
          relevantFolio = lastUdiFolio;
        } else {
          primaryReason = reasonKmt;
          alertSupplyType = 'KMT';
          alertLevel = row.kmtNivel;
          relevantFolio = lastKmtFolio;
        }
      } 
      // 4. STOCK EN SITIO (Envío descartado porque la tienda posee el suministro)
      else if (diagTnr === 'STOCK_EN_SITIO' || diagUdi === 'STOCK_EN_SITIO' || diagKmt === 'STOCK_EN_SITIO') {
        overallDiag = 'STOCK_EN_SITIO';
        const parts = [];
        if (diagTnr === 'STOCK_EN_SITIO' && stockTnrEvaluation) parts.push(`Tóner: Folio #${stockTnrEvaluation.folNum}`);
        if (diagUdi === 'STOCK_EN_SITIO' && stockUdiEvaluation) parts.push(`UDI: Folio #${stockUdiEvaluation.folNum}`);
        if (diagKmt === 'STOCK_EN_SITIO' && stockKmtEvaluation) parts.push(`KMT: Folio #${stockKmtEvaluation.folNum}`);
        primaryReason = `🛡️ Tienda con repuesto en STOCK en sitio (${parts.join(', ')}). Envío descartado.`;
        alertSupplyType = (diagTnr === 'STOCK_EN_SITIO' ? 'TNR' : (diagUdi === 'STOCK_EN_SITIO' ? 'UDI' : 'KMT'));
        alertLevel = (diagTnr === 'STOCK_EN_SITIO' ? row.tnrNivel : (diagUdi === 'STOCK_EN_SITIO' ? row.udiNivel : row.kmtNivel));
        relevantFolio = (diagTnr === 'STOCK_EN_SITIO' ? (stockTnrEvaluation?.folio || lastTnrFolio) : (stockUdiEvaluation?.folio || lastUdiFolio)) || sortedFolios[0];
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
        isTnrLow,
        udiNivel: row.udiNivel,
        udiSerie: row.udiSerie,
        deltaUdi,
        udiReplaced,
        diagUdi,
        reasonUdi,
        isUdiLow,
        kmtNivel: row.kmtNivel,
        deltaKmt,
        diagKmt,
        reasonKmt,
        isKmtLow,
        overallDiag,
        primaryReason,
        alertSupplyType,
        alertLevel,
        lastFolio: relevantFolio || sortedFolios[0] || null,
        lastTnrFolio: lastTnrFolio,
        lastUdiFolio: lastUdiFolio,
        lastKmtFolio: lastKmtFolio,
        stockTnrFolio: stockTnrEvaluation ? stockTnrEvaluation.folio : null,
        stockUdiFolio: stockUdiEvaluation ? stockUdiEvaluation.folio : null,
        equipFolios: sortedFolios,
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
  const percentSelect = document.getElementById('filterMonitoringPercentSelect');

  monitoringSearchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  monitoringFilterStatus = statusSelect ? statusSelect.value : 'ALL';
  monitoringFilterSupply = supplySelect ? supplySelect.value : 'ALL';
  monitoringFilterPercent = percentSelect ? percentSelect.value : 'ALL';

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

    // 3. Filtro por Porcentajes
    if (monitoringFilterPercent !== 'ALL') {
      const levels = [];
      if (monitoringFilterSupply === 'TNR') {
        if (row.tnrNivel !== null) levels.push({ type: 'TNR', val: row.tnrNivel, isCritical: row.isTnrLow });
      } else if (monitoringFilterSupply === 'UDI') {
        if (row.udiNivel !== null) levels.push({ type: 'UDI', val: row.udiNivel, isCritical: row.isUdiLow });
      } else if (monitoringFilterSupply === 'KMT') {
        if (row.kmtNivel !== null) levels.push({ type: 'KMT', val: row.kmtNivel, isCritical: row.isKmtLow });
      } else {
        if (row.tnrNivel !== null) levels.push({ type: 'TNR', val: row.tnrNivel, isCritical: row.isTnrLow });
        if (row.udiNivel !== null) levels.push({ type: 'UDI', val: row.udiNivel, isCritical: row.isUdiLow });
        if (row.kmtNivel !== null) levels.push({ type: 'KMT', val: row.kmtNivel, isCritical: row.isKmtLow });
      }

      if (levels.length === 0) return false;

      if (monitoringFilterPercent === 'CRITICAL') {
        if (!levels.some(l => l.isCritical)) return false;
      } else if (monitoringFilterPercent === 'LE_3') {
        if (!levels.some(l => l.val <= 3)) return false;
      } else if (monitoringFilterPercent === 'LE_5') {
        if (!levels.some(l => l.val <= 5)) return false;
      } else if (monitoringFilterPercent === 'LE_10') {
        if (!levels.some(l => l.val <= 10)) return false;
      } else if (monitoringFilterPercent === 'LE_15') {
        if (!levels.some(l => l.val <= 15)) return false;
      } else if (monitoringFilterPercent === 'LE_20') {
        if (!levels.some(l => l.val <= 20)) return false;
      } else if (monitoringFilterPercent === 'LE_30') {
        if (!levels.some(l => l.val <= 30)) return false;
      } else if (monitoringFilterPercent === 'RANGE_16_30') {
        if (!levels.some(l => l.val > 15 && l.val <= 30)) return false;
      } else if (monitoringFilterPercent === 'GT_30') {
        if (!levels.some(l => l.val > 30)) return false;
      }
    }

    // 3.b Filtro de Casillas por Cantidades/Niveles Específicos para TNR, UDI y KMT
    if (monitoringSelectedTnrLevels.size > 0) {
      if (row.tnrNivel === null || !monitoringSelectedTnrLevels.has(row.tnrNivel)) return false;
    }
    if (monitoringSelectedUdiLevels.size > 0) {
      if (row.udiNivel === null || !monitoringSelectedUdiLevels.has(row.udiNivel)) return false;
    }
    if (monitoringSelectedKmtLevels.size > 0) {
      if (row.kmtNivel === null || !monitoringSelectedKmtLevels.has(row.kmtNivel)) return false;
    }

    // 4. Búsqueda de Texto
    if (monitoringSearchQuery) {
      const text = `${row.serie} ${row.cliente} ${row.ubicacion} ${row.det} ${row.modelo} ${row.ip} ${row.tnrSerie} ${row.udiSerie}`.toLowerCase();
      if (!text.includes(monitoringSearchQuery)) return false;
    }

    return true;
  });

  monitoringCurrentPage = 1;
  updateSpecificSupplyLevelBadges();
  updateActiveSlideUI(monitoringFilterStatus);
  renderMonitoringTable();
}

// ==========================================
// LÓGICA DE FILTRADO POR CASILLAS DE SUMINISTROS
// ==========================================

function getSelectedSetForSupply(supplyType) {
  if (supplyType === 'TNR') return monitoringSelectedTnrLevels;
  if (supplyType === 'UDI') return monitoringSelectedUdiLevels;
  if (supplyType === 'KMT') return monitoringSelectedKmtLevels;
  return new Set();
}

function getAvailableLevelsForSupply(supplyType) {
  const map = new Map();
  monitoringProcessedList.forEach(row => {
    let level = null;
    if (supplyType === 'TNR') level = row.tnrNivel;
    else if (supplyType === 'UDI') level = row.udiNivel;
    else if (supplyType === 'KMT') level = row.kmtNivel;

    if (level !== null && level !== undefined && !isNaN(level)) {
      level = Math.round(Number(level));
      map.set(level, (map.get(level) || 0) + 1);
    }
  });

  const list = Array.from(map.entries()).map(([level, count]) => ({ level, count }));
  list.sort((a, b) => a.level - b.level);
  return list;
}

function openSupplyLevelsPopover(supplyType, triggerElem) {
  activeSupplyPopoverType = supplyType;
  popoverSearchQuery = '';

  const modal = document.getElementById('supplyLevelsPopoverModal');
  if (!modal) return;

  const titleElem = document.getElementById('popoverSupplyTitle');
  const typeBadge = document.getElementById('popoverSupplyTypeBadge');
  const searchInput = document.getElementById('popoverSearchLevelsInput');

  const names = {
    'TNR': 'Tóner (TNR)',
    'UDI': 'Unidad de Imagen (UDI)',
    'KMT': 'Kit de Mantenimiento (KMT)'
  };

  if (titleElem) titleElem.textContent = `Filtrar Niveles: ${names[supplyType] || supplyType}`;
  if (typeBadge) typeBadge.textContent = supplyType;
  if (searchInput) {
    searchInput.value = '';
    setTimeout(() => searchInput.focus(), 50);
  }

  renderSupplyLevelsChecklist();
  updateSupplyLevelsSelectionCount();

  modal.classList.remove('hidden');
}

function closeSupplyLevelsPopover() {
  const modal = document.getElementById('supplyLevelsPopoverModal');
  if (modal) modal.classList.add('hidden');
  activeSupplyPopoverType = null;
  popoverSearchQuery = '';
}

function renderSupplyLevelsChecklist() {
  const container = document.getElementById('popoverLevelsChecklist');
  if (!container || !activeSupplyPopoverType) return;

  const allLevels = getAvailableLevelsForSupply(activeSupplyPopoverType);
  const selectedSet = getSelectedSetForSupply(activeSupplyPopoverType);

  let filtered = allLevels;
  if (popoverSearchQuery) {
    const q = popoverSearchQuery.toLowerCase();
    filtered = allLevels.filter(item => String(item.level).includes(q) || `${item.level}%`.includes(q));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
        No se encontraron niveles con "${popoverSearchQuery}"
      </div>`;
    return;
  }

  let html = '';
  filtered.forEach(({ level, count }) => {
    const isChecked = selectedSet.has(level);
    let colorBadge = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300';
    if (level <= 5) {
      colorBadge = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-300';
    } else if (level <= 15) {
      colorBadge = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-300';
    } else if (level <= 30) {
      colorBadge = 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 border-sky-300';
    }

    html += `
      <label class="flex items-center justify-between p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer transition-colors shadow-2xs">
        <div class="flex items-center gap-2">
          <input type="checkbox"
            class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300 dark:border-slate-600 dark:bg-slate-700 cursor-pointer"
            ${isChecked ? 'checked' : ''}
            onchange="onSupplyLevelCheckboxChange(${level}, this.checked)"
          />
          <span class="px-2 py-0.5 rounded text-xs font-bold border ${colorBadge}">
            ${level}%
          </span>
        </div>
        <span class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
          ${count.toLocaleString()} ${count === 1 ? 'eq' : 'eqs'}
        </span>
      </label>
    `;
  });

  container.innerHTML = html;
}

function onSupplyLevelCheckboxChange(level, isChecked) {
  if (!activeSupplyPopoverType) return;
  const num = Number(level);
  const set = getSelectedSetForSupply(activeSupplyPopoverType);
  if (isChecked) {
    set.add(num);
  } else {
    set.delete(num);
  }
  updateSupplyLevelsSelectionCount();
}

function selectAllSupplyLevelsInPopover(selectAll) {
  if (!activeSupplyPopoverType) return;
  const set = getSelectedSetForSupply(activeSupplyPopoverType);
  const allLevels = getAvailableLevelsForSupply(activeSupplyPopoverType);

  if (selectAll) {
    allLevels.forEach(item => set.add(item.level));
  } else {
    set.clear();
  }
  renderSupplyLevelsChecklist();
  updateSupplyLevelsSelectionCount();
}

function invertSupplyLevelsInPopover() {
  if (!activeSupplyPopoverType) return;
  const set = getSelectedSetForSupply(activeSupplyPopoverType);
  const allLevels = getAvailableLevelsForSupply(activeSupplyPopoverType);

  allLevels.forEach(item => {
    if (set.has(item.level)) {
      set.delete(item.level);
    } else {
      set.add(item.level);
    }
  });

  renderSupplyLevelsChecklist();
  updateSupplyLevelsSelectionCount();
}

function onSupplyLevelsSearchInput(val) {
  popoverSearchQuery = (val || '').trim();
  renderSupplyLevelsChecklist();
}

function updateSupplyLevelsSelectionCount() {
  const badge = document.getElementById('popoverSelectionCountBadge');
  if (!badge || !activeSupplyPopoverType) return;

  const set = getSelectedSetForSupply(activeSupplyPopoverType);
  const allLevels = getAvailableLevelsForSupply(activeSupplyPopoverType);

  if (set.size === 0) {
    badge.textContent = `Todos (${allLevels.length} niveles)`;
    badge.className = "text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
  } else {
    badge.textContent = `${set.size} de ${allLevels.length} seleccionados`;
    badge.className = "text-[11px] font-semibold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300";
  }
}

function applySupplyLevelsPopover() {
  closeSupplyLevelsPopover();
  filterMonitoringTable();
}

function clearSpecificSupplyLevelType(supplyType) {
  const set = getSelectedSetForSupply(supplyType);
  set.clear();
  filterMonitoringTable();
}

function clearAllSpecificSupplyLevels() {
  monitoringSelectedTnrLevels.clear();
  monitoringSelectedUdiLevels.clear();
  monitoringSelectedKmtLevels.clear();
  filterMonitoringTable();
}

function updateSpecificSupplyLevelBadges() {
  const updateBadge = (badgeId, count) => {
    const el = document.getElementById(badgeId);
    if (!el) return;
    if (count > 0) {
      el.textContent = count;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  };

  updateBadge('badgeToolbarFilterTNR', monitoringSelectedTnrLevels.size);
  updateBadge('badgeToolbarFilterUDI', monitoringSelectedUdiLevels.size);
  updateBadge('badgeToolbarFilterKMT', monitoringSelectedKmtLevels.size);

  updateBadge('badgeHeaderFilterTNR', monitoringSelectedTnrLevels.size);
  updateBadge('badgeHeaderFilterUDI', monitoringSelectedUdiLevels.size);
  updateBadge('badgeHeaderFilterKMT', monitoringSelectedKmtLevels.size);

  // Chips activos y botón limpiar
  const chipsContainer = document.getElementById('activeSpecificLevelsChips');
  const clearBtn = document.getElementById('btnClearSpecificLevels');
  const totalSelected = monitoringSelectedTnrLevels.size + monitoringSelectedUdiLevels.size + monitoringSelectedKmtLevels.size;

  if (clearBtn) {
    if (totalSelected > 0) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }

  if (chipsContainer) {
    chipsContainer.innerHTML = '';
    const renderChips = (type, set, label, color) => {
      if (set.size === 0) return;
      const sorted = Array.from(set).sort((a,b) => a - b);
      const text = `${label}: ${sorted.map(s => s + '%').join(', ')}`;
      const chip = document.createElement('div');
      chip.className = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${color} border shadow-2xs`;
      chip.innerHTML = `
        <span>${text}</span>
        <button type="button" onclick="clearSpecificSupplyLevelType('${type}')" class="hover:opacity-75 font-bold cursor-pointer ml-1" title="Quitar filtro ${type}">✕</button>
      `;
      chipsContainer.appendChild(chip);
    };

    renderChips('TNR', monitoringSelectedTnrLevels, 'TNR', 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-amber-300');
    renderChips('UDI', monitoringSelectedUdiLevels, 'UDI', 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300 border-cyan-300');
    renderChips('KMT', monitoringSelectedKmtLevels, 'KMT', 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 border-purple-300');
  }
}

// Sincronización visual e interactiva de Slides KPIs y Píldoras con el estado de filtrado
function filterMonitoringBySlide(status) {
  const statusSelect = document.getElementById('filterMonitoringStatusSelect');
  if (statusSelect) {
    statusSelect.value = status || 'ALL';
  }
  monitoringFilterStatus = status || 'ALL';
  filterMonitoringTable();

  // Desplazamiento suave para visualizar la lista en pantallas móviles y desktop
  const targetScroll = document.getElementById('monitoringTableContainer') || document.getElementById('monitoringMobileCardsContainer');
  if (targetScroll && window.innerWidth < 1024) {
    targetScroll.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function updateActiveSlideUI(activeStatus) {
  const status = activeStatus || 'ALL';

  // 1. Tarjetas Superiores (Slides KPIs)
  const slideMap = {
    'ALL': document.getElementById('slideMonTotal'),
    'DESPACHO_REQUERIDO': document.getElementById('slideMonDespacho'),
    'REPOSICION_STOCK': document.getElementById('slideMonReponer'),
    'STOCK_EN_SITIO': document.getElementById('slideMonStockSitio'),
    'OPTIMO': document.getElementById('slideMonOptimos')
  };

  Object.keys(slideMap).forEach(key => {
    const el = slideMap[key];
    if (!el) return;
    if (key === status) {
      el.classList.add('ring-4', 'ring-rose-500/50', 'dark:ring-rose-400/50', 'border-rose-500', 'shadow-md', 'scale-[1.02]');
      // En móvil, hacer scroll suave del slide activo en el contenedor horizontal
      if (window.innerWidth < 1024 && el.scrollIntoView) {
        try {
          el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        } catch (e) {}
      }
    } else {
      el.classList.remove('ring-4', 'ring-rose-500/50', 'dark:ring-rose-400/50', 'border-rose-500', 'shadow-md', 'scale-[1.02]');
    }
  });

  // 2. Píldoras de filtrado táctil
  const pillMap = {
    'ALL': document.getElementById('pillMonFilterAll'),
    'DESPACHO_REQUERIDO': document.getElementById('pillMonFilterDespacho'),
    'REPOSICION_STOCK': document.getElementById('pillMonFilterReponer'),
    'STOCK_EN_SITIO': document.getElementById('pillMonFilterStockSitio'),
    'EN_TRANSITO': document.getElementById('pillMonFilterTransito'),
    'OPTIMO': document.getElementById('pillMonFilterOptimos')
  };

  Object.keys(pillMap).forEach(key => {
    const pill = pillMap[key];
    if (!pill) return;
    if (key === status) {
      pill.classList.remove('bg-rose-50', 'text-rose-700', 'bg-amber-50', 'text-amber-700', 'bg-blue-50', 'text-blue-700', 'bg-indigo-50', 'text-indigo-700', 'bg-emerald-50', 'text-emerald-700', 'bg-slate-100', 'text-slate-600');
      pill.classList.add('bg-slate-900', 'text-white', 'dark:bg-white', 'dark:text-slate-900', 'shadow-xs');
    } else {
      pill.classList.remove('bg-slate-900', 'text-white', 'dark:bg-white', 'dark:text-slate-900', 'shadow-xs');
      if (key === 'ALL') {
        pill.classList.add('bg-slate-100', 'text-slate-600', 'dark:bg-slate-800', 'dark:text-slate-400');
      } else if (key === 'DESPACHO_REQUERIDO') {
        pill.classList.add('bg-rose-50', 'text-rose-700', 'dark:bg-rose-950/60', 'dark:text-rose-300');
      } else if (key === 'REPOSICION_STOCK') {
        pill.classList.add('bg-amber-50', 'text-amber-700', 'dark:bg-amber-950/60', 'dark:text-amber-300');
      } else if (key === 'STOCK_EN_SITIO') {
        pill.classList.add('bg-blue-50', 'text-blue-700', 'dark:bg-blue-950/60', 'dark:text-blue-300');
      } else if (key === 'EN_TRANSITO') {
        pill.classList.add('bg-indigo-50', 'text-indigo-700', 'dark:bg-indigo-950/60', 'dark:text-indigo-300');
      } else if (key === 'OPTIMO') {
        pill.classList.add('bg-emerald-50', 'text-emerald-700', 'dark:bg-emerald-950/60', 'dark:text-emerald-300');
      }
    }
  });
}

// Consulta / Modificación interactiva de Folio en ventana emergente (SIN SALIR DE MONITOREO)
function goToFolioDetail(folioNum, serie) {
  // Nota: NO se ejecuta switchSuiteTab('salidas') para mantener al usuario 100% en Monitoreo & Stock

  const allFolios = (typeof sheetStore !== 'undefined' && sheetStore['FOLIOS']) ? sheetStore['FOLIOS'] : [];
  let targetIdx = -1;

  const fClean = (folioNum || '').toString().replace(/^[#\s]+/, '').trim();
  if (fClean && fClean !== 'S/N' && fClean !== '-' && fClean !== '0') {
    targetIdx = allFolios.findIndex(f => {
      const fn = (f['FOLIO'] || f['FOLIO '] || '').toString().replace(/^[#\s]+/, '').trim();
      return fn === fClean;
    });
  }

  // Si no se encontró por número de folio exacto, buscar la salida más reciente de esta serie
  if (targetIdx === -1 && serie) {
    const sClean = serie.toString().trim().toUpperCase();
    for (let i = allFolios.length - 1; i >= 0; i--) {
      const fs = (allFolios[i]['SERIE'] || '').toString().trim().toUpperCase();
      if (fs === sClean) {
        targetIdx = i;
        break;
      }
    }
  }

  // Si aún no se encuentra, buscar por referencia de lastFolio en la lista analizada
  if (targetIdx === -1 && typeof monitoringProcessedList !== 'undefined') {
    const item = monitoringProcessedList.find(r => r.serie === serie);
    if (item && item.lastFolio) {
      targetIdx = allFolios.indexOf(item.lastFolio);
      if (targetIdx === -1) {
        allFolios.push(item.lastFolio);
        targetIdx = allFolios.length - 1;
      }
    }
  }

  // Abrir ventana emergente in situ
  if (targetIdx !== -1 && typeof editSalida === 'function') {
    editSalida(targetIdx);

    const mTitle = document.getElementById('modalSalidaTitle');
    if (mTitle) {
      const folVal = allFolios[targetIdx]['FOLIO'] || allFolios[targetIdx]['FOLIO '] || fClean;
      mTitle.textContent = `Detalle de Folio #${folVal} (Monitoreo & Stock)`;
    }
    const subTitle = document.getElementById('modalSalidaSubtitle');
    if (subTitle) {
      subTitle.textContent = 'Consulta los datos del folio o modifica el Estado de Suministro para sincronizar el stock.';
    }

    if (typeof showToast === 'function') {
      showToast(`Folio #${fClean || (allFolios[targetIdx] && allFolios[targetIdx]['FOLIO']) || ''} abierto en ventana emergente.`);
    }
  } else {
    // Si no existe folio previo, abrir formulario para registrar nuevo movimiento precargando los datos
    if (typeof showToast === 'function') {
      showToast(`No se encontró folio previo para la serie ${serie || fClean}. Abriendo registro nuevo...`);
    }
    if (typeof openNewSalidaModal === 'function') {
      const item = (typeof monitoringProcessedList !== 'undefined') ? monitoringProcessedList.find(r => r.serie === serie) : null;
      openNewSalidaModal({
        serie: serie || '',
        modelo: item ? item.modelo : '',
        cliente: item ? item.cliente : '',
        destino: item ? item.ubicacion : '',
        det: item ? item.det : '',
        tipoSum: (item && item.alertSupplyType) ? item.alertSupplyType : 'TNR'
      });
    }
  }
}

// Despacho directo desde alertas de monitoreo precargando datos
function dispatchSalidaFromAlert(serie, supplyType = 'TNR', level = 10) {
  const item = (typeof monitoringProcessedList !== 'undefined') ? monitoringProcessedList.find(r => r.serie === serie) : null;
  if (typeof openNewSalidaModal === 'function') {
    openNewSalidaModal({
      serie: serie || '',
      modelo: item ? item.modelo : '',
      cliente: item ? item.cliente : '',
      destino: item ? item.ubicacion : '',
      det: item ? item.det : '',
      tipoSum: supplyType || (item && item.alertSupplyType ? item.alertSupplyType : 'TNR')
    });
    if (typeof showToast === 'function') {
      showToast(`⚡ Iniciando despacho de ${supplyType} para serie ${serie}...`);
    }
  } else {
    alert(`Iniciando despacho de ${supplyType} para equipo con serie: ${serie}`);
  }
}

// Creación de ticket desde alerta de monitoreo
function dispatchTicketFromAlert(serie, modelo, cliente, ubicacion) {
  if (typeof openNewOdsModal === 'function') {
    openNewOdsModal({ serie, modelo, cliente, ubicacion });
  } else if (typeof switchSuiteTab === 'function') {
    switchSuiteTab('tickets');
    if (typeof showToast === 'function') {
      showToast(`Creando Ticket ODS para equipo ${serie}...`);
    }
  } else {
    alert(`Ticket ODS solicitado para equipo: ${serie} (${modelo}) - ${ubicacion}`);
  }
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

// Renderizado de Filas de la Tabla y Tarjetas Móviles
function renderMonitoringTable() {
  const tbody = document.getElementById('monitoringTableBody');
  const cardsContainer = document.getElementById('monitoringMobileCardsContainer');
  if (tbody) tbody.innerHTML = '';
  if (cardsContainer) cardsContainer.innerHTML = '';

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
    if (tbody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="11" class="py-8 text-center text-slate-400">No hay registros que coincidan con los filtros aplicados.</td>`;
      tbody.appendChild(tr);
    }
    if (cardsContainer) {
      cardsContainer.innerHTML = `<div class="p-8 text-center text-slate-400">No hay registros que coincidan con los filtros aplicados.</div>`;
    }
    return;
  }

  const isMobileScreen = typeof window !== 'undefined' && window.innerWidth < 1024;
  const renderCards = monitoringViewMode === 'cards' || (monitoringViewMode === 'auto' && isMobileScreen);
  const renderTable = monitoringViewMode === 'table' || (monitoringViewMode === 'auto' && !isMobileScreen);

  const fragment = renderTable ? document.createDocumentFragment() : null;
  const cardsFragment = renderCards ? document.createDocumentFragment() : null;

  pageRows.forEach((r, idx) => {
    // Barra de Tóner
    let tnrBarColor = 'bg-emerald-500';
    if (r.tnrNivel === null) tnrBarColor = 'bg-slate-300 dark:bg-slate-600';
    else if (r.tnrNivel <= 5) tnrBarColor = 'bg-rose-600';
    else if (r.tnrNivel <= 15) tnrBarColor = 'bg-amber-500';

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
    else if (r.udiNivel <= 5) udiBarColor = 'bg-rose-600';
    else if (r.udiNivel <= 15) udiBarColor = 'bg-amber-500';

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
    else if (r.kmtNivel <= 3) kmtBarColor = 'bg-rose-600';
    else if (r.kmtNivel <= 10) kmtBarColor = 'bg-amber-500';

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
          <span>🟢 ÓPTIMO</span>
        </span>
      `;
    }

    // Última Salida Folios con enlace interactivo
    let lastFolioHtml = '<span class="text-slate-400 italic text-[11px]">Sin salidas en FOLIOS</span>';
    if (r.lastFolio) {
      const fNum = r.lastFolio['FOLIO'] || r.lastFolio['FOLIO '] || 'S/N';
      const fFecha = r.lastFolio['FECHA'] ? formatDateShort(r.lastFolio['FECHA']) : '';
      const fTipo = r.lastFolio['TIPO SUM'] || 'SUM';
      const fEst = r.lastFolio['ESTADO SUM'] || 'ENTREGADO';
      const fSerieSum = r.lastFolio['SERIE SUM'] || '';
      lastFolioHtml = `
        <div class="leading-tight">
          <button type="button" onclick="goToFolioDetail('${fNum}', '${r.serie}')" class="inline-flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400 hover:underline text-left group" title="Clic para ir a FOLIOS y modificar o consultar estatus">
            <span>Folio #${fNum}</span>
            <svg class="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
          </button>
          <span class="text-[10px] text-slate-500">(${fFecha})</span>
          <p class="text-[10px] text-slate-600 dark:text-slate-300">${fTipo}: ${fSerieSum || 'Sin serie'}</p>
          <div class="mt-1 flex items-center gap-1.5">
            <span class="text-[9px] px-1.5 py-0.2 rounded font-semibold ${
              fEst === 'ENTREGADO' 
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' 
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
            }">${fEst}</span>
            <button type="button" onclick="goToFolioDetail('${fNum}', '${r.serie}')" class="text-[9px] font-bold text-blue-600 dark:text-blue-400 hover:underline">
              ✏️ Modificar
            </button>
          </div>
        </div>
      `;
    }

    // 1. RENDERIZADO EN TABLA (Escritorio / Tablet)
    if (tbody && renderTable) {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-rose-50/40 dark:hover:bg-slate-700/60 active:bg-rose-100/50 transition border-b border-slate-100 dark:border-slate-800 cursor-pointer touch-manipulation select-none';
      tr.setAttribute('role', 'button');
      tr.setAttribute('tabindex', '0');
      tr.title = `Toca para abrir la Ficha e Historial del equipo ${r.serie}`;

      let trTouchStartX = 0, trTouchStartY = 0, trTouchMoved = false;
      tr.addEventListener('touchstart', (e) => {
        trTouchMoved = false;
        if (e.touches && e.touches[0]) {
          trTouchStartX = e.touches[0].clientX;
          trTouchStartY = e.touches[0].clientY;
        }
      }, { passive: true });
      tr.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
          const dx = Math.abs(e.touches[0].clientX - trTouchStartX);
          const dy = Math.abs(e.touches[0].clientY - trTouchStartY);
          if (dx > 10 || dy > 10) trTouchMoved = true;
        }
      }, { passive: true });
      tr.addEventListener('click', (e) => {
        if (trTouchMoved) {
          trTouchMoved = false;
          return;
        }
        if (e.target.closest('button, a, input, select')) return;
        openEquipmentHistoryModal(r.serie);
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, a, input, select')) return;
          e.preventDefault();
          openEquipmentHistoryModal(r.serie);
        }
      });

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
    }

    // 2. RENDERIZADO EN TARJETAS MÓVILES (Smartphone Friendly)
    if (cardsContainer && renderCards) {
      const card = document.createElement('div');
      card.className = 'bg-white dark:bg-slate-800 rounded-2xl p-3.5 sm:p-4 border-2 border-slate-200 dark:border-slate-700 hover:border-rose-400 dark:hover:border-rose-500 shadow-xs space-y-3 cursor-pointer active:scale-[0.99] active:bg-rose-50/20 dark:active:bg-slate-700/60 transition touch-manipulation select-none';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.title = `Toca para abrir la Ficha e Historial del equipo ${r.serie}`;

      let cardTouchStartX = 0, cardTouchStartY = 0, cardTouchMoved = false;
      card.addEventListener('touchstart', (e) => {
        cardTouchMoved = false;
        if (e.touches && e.touches[0]) {
          cardTouchStartX = e.touches[0].clientX;
          cardTouchStartY = e.touches[0].clientY;
        }
      }, { passive: true });
      card.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
          const dx = Math.abs(e.touches[0].clientX - cardTouchStartX);
          const dy = Math.abs(e.touches[0].clientY - cardTouchStartY);
          if (dx > 10 || dy > 10) cardTouchMoved = true;
        }
      }, { passive: true });
      card.addEventListener('click', (e) => {
        if (cardTouchMoved) {
          cardTouchMoved = false;
          return;
        }
        if (e.target.closest('button, a, input, select')) return;
        openEquipmentHistoryModal(r.serie);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('button, a, input, select')) return;
          e.preventDefault();
          openEquipmentHistoryModal(r.serie);
        }
      });

      card.innerHTML = `
        <!-- Banner Táctil para Móvil -->
        <div class="flex items-center justify-between text-[11px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-3 py-1.5 rounded-xl border border-rose-200/80 dark:border-rose-900/40">
          <span class="flex items-center gap-1.5">
            <span>📋 Toca para ver Ficha &amp; Historial</span>
          </span>
          <svg class="w-4 h-4 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
        </div>

        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="px-2 py-0.5 rounded-md text-[10px] font-bold ${
                r.cliente.includes('WALMART')
                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                  : (r.cliente.includes('BAC') ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300')
              }">${r.cliente}</span>
              <span class="font-mono font-bold text-sm text-slate-900 dark:text-white">${r.serie}</span>
              <button type="button" onclick="navigator.clipboard.writeText('${r.serie}'); showToast('Serie copiada: ${r.serie}');" title="Copiar Serie" class="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
              </button>
            </div>
            <p class="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-1">${r.modelo} • <span class="text-slate-500 dark:text-slate-400 font-normal">${r.ubicacion}</span></p>
            ${r.det ? `<p class="text-[10px] font-mono text-slate-400">DET: ${r.det} ${r.ip ? '• IP: ' + r.ip : ''}</p>` : (r.ip ? `<p class="text-[10px] font-mono text-slate-400">IP: ${r.ip}</p>` : '')}
          </div>
          <div class="text-right flex-shrink-0">
            ${diagBadge}
          </div>
        </div>

        <!-- Suministros (TNR, UDI, KMT) -->
        <div class="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
          <div class="bg-slate-50 dark:bg-slate-900/40 p-2 rounded-xl">
            <div class="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
              <span>Tóner (TNR)</span>
              <span class="${r.tnrNivel !== null && r.tnrNivel <= 5 ? 'text-rose-600 font-bold' : (r.tnrNivel !== null && r.tnrNivel <= 15 ? 'text-amber-600 font-bold' : 'text-slate-700 dark:text-slate-200')}">${r.tnrNivel !== null ? r.tnrNivel + '%' : 'N/D'}</span>
            </div>
            <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mt-1 overflow-hidden">
              <div class="${tnrBarColor} h-1.5 rounded-full" style="width: ${r.tnrNivel !== null ? Math.max(3, Math.min(100, r.tnrNivel)) : 0}%"></div>
            </div>
            <div class="mt-1">${deltaTnrBadge}</div>
            <p class="text-[9px] font-mono text-slate-400 mt-0.5 truncate" title="Serie: ${r.tnrSerie}">S: ${r.tnrSerie || 'N/D'}</p>
          </div>

          <div class="bg-slate-50 dark:bg-slate-900/40 p-2 rounded-xl">
            <div class="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
              <span>Imagen (UDI)</span>
              <span class="${r.udiNivel !== null && r.udiNivel <= 5 ? 'text-rose-600 font-bold' : (r.udiNivel !== null && r.udiNivel <= 15 ? 'text-amber-600 font-bold' : 'text-slate-700 dark:text-slate-200')}">${r.udiNivel !== null ? r.udiNivel + '%' : 'N/D'}</span>
            </div>
            <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mt-1 overflow-hidden">
              <div class="${udiBarColor} h-1.5 rounded-full" style="width: ${r.udiNivel !== null ? Math.max(3, Math.min(100, r.udiNivel)) : 0}%"></div>
            </div>
            <div class="mt-1">${deltaUdiBadge}</div>
            <p class="text-[9px] font-mono text-slate-400 mt-0.5 truncate" title="Serie: ${r.udiSerie}">S: ${r.udiSerie || 'N/D'}</p>
          </div>

          <div class="bg-slate-50 dark:bg-slate-900/40 p-2 rounded-xl">
            <div class="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
              <span>Mantto (KMT)</span>
              <span class="${r.kmtNivel !== null && r.kmtNivel <= 3 ? 'text-rose-600 font-bold' : (r.kmtNivel !== null && r.kmtNivel <= 10 ? 'text-amber-600 font-bold' : 'text-slate-700 dark:text-slate-200')}">${r.kmtNivel !== null ? r.kmtNivel + '%' : 'N/D'}</span>
            </div>
            <div class="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mt-1 overflow-hidden">
              <div class="${kmtBarColor} h-1.5 rounded-full" style="width: ${r.kmtNivel !== null ? Math.max(3, Math.min(100, r.kmtNivel)) : 0}%"></div>
            </div>
          </div>
        </div>

        <!-- Última Salida y Acciones -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700/60">
          <div class="text-xs">
            ${r.lastFolio 
              ? `<div class="leading-tight">
                  <div class="flex items-center gap-1">
                    <button type="button" onclick="goToFolioDetail('${r.lastFolio['FOLIO'] || ''}', '${r.serie}')" class="font-bold text-amber-600 dark:text-amber-400 hover:underline inline-flex items-center gap-1" title="Consultar o modificar folio en ventana emergente">
                      <span>Folio #${r.lastFolio['FOLIO'] || ''}</span>
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                    </button>
                    <span class="text-[10px] text-slate-400">(${r.lastFolio['FECHA'] ? formatDateShort(r.lastFolio['FECHA']) : ''})</span>
                  </div>
                  <p class="text-[10px] text-slate-500 mt-0.5">${r.lastFolio['TIPO SUM'] || 'SUM'}: <button type="button" onclick="goToFolioDetail('${r.lastFolio['FOLIO'] || ''}', '${r.serie}')" class="font-bold underline text-emerald-600 dark:text-emerald-400">${r.lastFolio['ESTADO SUM'] || 'ENTREGADO'} ✏️</button></p>
                </div>`
              : '<span class="text-[11px] text-slate-400 italic">Sin salidas en FOLIOS</span>'
            }
          </div>
          <div class="flex items-center gap-1.5 w-full sm:w-auto justify-end">
            ${r.lastFolio ? `
              <button type="button" onclick="goToFolioDetail('${r.lastFolio['FOLIO'] || ''}', '${r.serie}')" class="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800 transition" title="Consultar o modificar estatus del folio">
                <span>👁️ Ver Folio</span>
              </button>
            ` : ''}
            <button type="button" onclick="dispatchSalidaFromAlert('${r.serie}', '${r.alertSupplyType || 'TNR'}', ${r.alertLevel !== null ? r.alertLevel : 10})" class="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-2xs transition">
              <span>📦 Despachar</span>
            </button>
            <button type="button" onclick="openEquipmentHistoryModal('${r.serie}')" class="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 transition shrink-0" title="Ver Historial Completo y Folios">
              <span>📋 Ficha</span>
            </button>
          </div>
        </div>
      `;
      cardsFragment.appendChild(card);
    }
  });

  if (tbody && fragment) tbody.appendChild(fragment);
  if (cardsContainer && cardsFragment) cardsContainer.appendChild(cardsFragment);
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

      <!-- Bloque de Folios Amarrados por Tipo de Suministro (TNR y UDI) -->
      <div class="col-span-2 sm:col-span-4 bg-amber-50 dark:bg-amber-950/40 p-3 rounded-xl border border-amber-200 dark:border-amber-800 space-y-2 mt-1">
        <div class="flex items-center justify-between flex-wrap gap-1">
          <p class="text-amber-800 dark:text-amber-300 text-[10px] uppercase font-bold tracking-wider">
            📦 Control de Stock en Sitio & Folios por Suministro (TNR / UDI)
          </p>
          <span class="text-[10px] font-semibold text-slate-500">Salidas más recientes al inicio</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 min-w-0">
          <!-- Tarjeta TNR (Tóner) -->
          <div class="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-xs font-bold text-slate-800 dark:text-slate-100">🖨️ Tóner (TNR):</span>
                <span class="font-bold text-xs ${matchProcessed && matchProcessed.isTnrLow ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">${matchProcessed && matchProcessed.tnrNivel !== null ? matchProcessed.tnrNivel + '%' : 'N/D'}</span>
              </div>
              <div class="mt-1 flex items-center gap-1.5 flex-wrap">
                ${matchProcessed && matchProcessed.lastTnrFolio ? `
                  <span class="font-mono font-bold text-xs text-slate-900 dark:text-white">Folio #${matchProcessed.lastTnrFolio['FOLIO'] || matchProcessed.lastTnrFolio['FOLIO '] || ''}</span>
                  <span class="text-[10px] text-slate-500">(${matchProcessed.lastTnrFolio['FECHA'] ? formatDateShort(matchProcessed.lastTnrFolio['FECHA']) : ''})</span>
                  <span class="text-[9px] font-bold px-1.5 py-0.2 rounded ${
                    (matchProcessed.lastTnrFolio['ESTADO SUM'] || '').includes('STOCK') 
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                      : ((matchProcessed.lastTnrFolio['ESTADO SUM'] || '') === 'ENTREGADO'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300')
                  }">${matchProcessed.lastTnrFolio['ESTADO SUM'] || 'ENTREGADO'}</span>
                ` : `
                  <span class="text-[11px] text-slate-400 italic">Sin folio de TNR registrado</span>
                `}
              </div>
            </div>
            <div class="w-full sm:w-auto flex justify-end shrink-0 pt-1 sm:pt-0">
              ${matchProcessed && matchProcessed.lastTnrFolio ? `
                <button type="button" onclick="goToFolioDetail('${matchProcessed.lastTnrFolio['FOLIO'] || matchProcessed.lastTnrFolio['FOLIO '] || ''}', '${serieUpper}');" class="w-full sm:w-auto px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs transition whitespace-nowrap text-center">
                  ✏️ Folio TNR
                </button>
              ` : `
                <button type="button" onclick="dispatchSalidaFromAlert('${serieUpper}', 'TNR', ${matchProcessed ? matchProcessed.tnrNivel : 10});" class="w-full sm:w-auto px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-2xs transition whitespace-nowrap text-center">
                  📦 Salida TNR
                </button>
              `}
            </div>
          </div>

          <!-- Tarjeta UDI (Unidad de Imagen) -->
          <div class="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-xs font-bold text-slate-800 dark:text-slate-100">⚙️ UDI (Imagen):</span>
                <span class="font-bold text-xs ${matchProcessed && matchProcessed.isUdiLow ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}">${matchProcessed && matchProcessed.udiNivel !== null ? matchProcessed.udiNivel + '%' : 'N/D'}</span>
              </div>
              <div class="mt-1 flex items-center gap-1.5 flex-wrap">
                ${matchProcessed && matchProcessed.lastUdiFolio ? `
                  <span class="font-mono font-bold text-xs text-slate-900 dark:text-white">Folio #${matchProcessed.lastUdiFolio['FOLIO'] || matchProcessed.lastUdiFolio['FOLIO '] || ''}</span>
                  <span class="text-[10px] text-slate-500">(${matchProcessed.lastUdiFolio['FECHA'] ? formatDateShort(matchProcessed.lastUdiFolio['FECHA']) : ''})</span>
                  <span class="text-[9px] font-bold px-1.5 py-0.2 rounded ${
                    (matchProcessed.lastUdiFolio['ESTADO SUM'] || '').includes('STOCK') 
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                      : ((matchProcessed.lastUdiFolio['ESTADO SUM'] || '') === 'ENTREGADO'
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300')
                  }">${matchProcessed.lastUdiFolio['ESTADO SUM'] || 'ENTREGADO'}</span>
                ` : `
                  <span class="text-[11px] text-slate-400 italic">Sin folio de UDI registrado</span>
                `}
              </div>
            </div>
            <div class="w-full sm:w-auto flex justify-end shrink-0 pt-1 sm:pt-0">
              ${matchProcessed && matchProcessed.lastUdiFolio ? `
                <button type="button" onclick="goToFolioDetail('${matchProcessed.lastUdiFolio['FOLIO'] || matchProcessed.lastUdiFolio['FOLIO '] || ''}', '${serieUpper}');" class="w-full sm:w-auto px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs transition whitespace-nowrap text-center">
                  ✏️ Folio UDI
                </button>
              ` : `
                <button type="button" onclick="dispatchSalidaFromAlert('${serieUpper}', 'UDI', ${matchProcessed ? matchProcessed.udiNivel : 10});" class="w-full sm:w-auto px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-2xs transition whitespace-nowrap text-center">
                  📦 Salida UDI
                </button>
              `}
            </div>
          </div>
        </div>
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
          } else if (nextOlder.tnrNivel <= 15 && h.tnrNivel >= 80) {
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

  // 4. Salidas Registradas en FOLIOS para este equipo (Más recientes al inicio)
  const foliosBody = document.getElementById('modalEquipFoliosBody');
  if (foliosBody) {
    foliosBody.innerHTML = '';
    const allFolios = (typeof sheetStore !== 'undefined' && sheetStore['FOLIOS']) ? sheetStore['FOLIOS'] : [];
    const equipFolios = allFolios.filter(f => (f['SERIE'] || '').toString().trim().toUpperCase() === serieUpper);
    
    // Ordenamiento riguroso cronológico descendente (más recientes al inicio)
    equipFolios.sort((a, b) => {
      const tsA = (typeof getRowDateTimestamp === 'function') ? getRowDateTimestamp(a) : ((typeof parseFlexibleDate === 'function' ? parseFlexibleDate(a['FECHA'])?.getTime() : 0) || (a['FECHA'] ? new Date(a['FECHA']).getTime() : 0) || 0);
      const tsB = (typeof getRowDateTimestamp === 'function') ? getRowDateTimestamp(b) : ((typeof parseFlexibleDate === 'function' ? parseFlexibleDate(b['FECHA'])?.getTime() : 0) || (b['FECHA'] ? new Date(b['FECHA']).getTime() : 0) || 0);
      if (tsB !== tsA) return tsB - tsA;
      const numA = parseInt(String(a['FOLIO'] || a['FOLIO '] || '').replace(/\D/g, ''), 10) || 0;
      const numB = parseInt(String(b['FOLIO'] || b['FOLIO '] || '').replace(/\D/g, ''), 10) || 0;
      if (numB !== numA) return numB - numA;
      return 0;
    });

    if (equipFolios.length === 0) {
      foliosBody.innerHTML = `<tr><td colspan="8" class="py-4 text-center text-slate-400">Sin salidas registradas en la hoja FOLIOS para esta serie.</td></tr>`;
    } else {
      equipFolios.forEach(f => {
        const folNum = f['FOLIO'] || f['FOLIO '] || 'S/N';
        const fFecha = f['FECHA'] ? formatDateShort(f['FECHA']) : 'N/D';
        const fTipo = f['TIPO SUM'] || 'SUM';
        const fDesc = f['DESCRIPCION'] || f['DESCRIPCIÓN'] || '';
        const fSerie = f['SERIE SUM'] || 'Sin serie';
        const fCant = f['CANT'] || 1;
        const fEst = (f['ESTADO SUM'] || 'ENTREGADO').toString().trim().toUpperCase();

        let badgeClass = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
        let badgeIcon = '';
        if (fEst.includes('STOCK') || fEst === 'NUEVO') {
          badgeClass = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 font-bold';
          badgeIcon = '📦 ';
        } else if (fEst === 'ENTREGADO') {
          badgeClass = 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-semibold';
          badgeIcon = '✅ ';
        } else if (fEst.includes('TRANSIT') || fEst.includes('TRÁNSIT') || fEst.includes('ENVIADO') || fEst.includes('RUTA')) {
          badgeClass = 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 font-semibold';
          badgeIcon = '🚚 ';
        } else if (fEst.includes('INSTALAD') || fEst.includes('CONSUMID') || fEst.includes('AGOTAD')) {
          badgeClass = 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 font-medium';
          badgeIcon = '🔧 ';
        } else if (fEst.includes('PENDIENT')) {
          badgeClass = 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-semibold';
          badgeIcon = '⏳ ';
        }

        const tr = document.createElement('tr');
        tr.className = 'border-b border-slate-100 dark:border-slate-800 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/40';
        tr.innerHTML = `
          <td class="py-2 px-3 font-bold font-mono text-slate-900 dark:text-white">Folio #${folNum}</td>
          <td class="py-2 px-3 text-slate-600 dark:text-slate-300">${fFecha}</td>
          <td class="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">${fTipo}</td>
          <td class="py-2 px-3 text-slate-700 dark:text-slate-300">${fDesc}</td>
          <td class="py-2 px-3 font-mono text-slate-800 dark:text-slate-100">${fSerie}</td>
          <td class="py-2 px-3 text-center font-bold text-slate-800 dark:text-slate-200">${fCant}</td>
          <td class="py-2 px-3">
            <span class="px-2 py-0.5 rounded text-[10px] ${badgeClass}">${badgeIcon}${fEst}</span>
          </td>
          <td class="py-2 px-3 text-center">
            <button type="button" onclick="goToFolioDetail('${folNum}', '${serieUpper}');" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-2xs transition" title="Consultar o modificar folio in situ">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
              <span>✏️ Modificar</span>
            </button>
          </td>
        `;
        foliosBody.appendChild(tr);
      });
    }
  }

  if (typeof pushModalToHistory === 'function') {
    pushModalToHistory('modalEquipmentHistory');
  } else {
    modal.classList.remove('hidden');
  }
}

function closeEquipmentHistoryModal(force = false) {
  if (typeof triggerModalClose === 'function') {
    triggerModalClose('modalEquipmentHistory', force);
    return;
  }
  const modal = document.getElementById('modalEquipmentHistory');
  if (modal) modal.classList.add('hidden');
}

// Consultar o Modificar Detalle de Folio en Ventana Emergente (Sin salir de Monitoreo)
function goToFolioDetail(folNum, serieUpper) {
  if (typeof sheetStore === 'undefined' || !sheetStore['FOLIOS']) {
    alert("Base de datos de FOLIOS no disponible.");
    return;
  }
  
  const folClean = String(folNum).replace(/\D/g, '');
  const folios = sheetStore['FOLIOS'];
  const index = folios.findIndex(f => {
    const fId = String(f['FOLIO'] || f['FOLIO '] || '').replace(/\D/g, '');
    return fId === folClean;
  });

  if (index !== -1 && typeof editSalida === 'function') {
    editSalida(index);
  } else {
    alert(`No se encontró el Folio #${folNum} en la base de datos de FOLIOS.`);
  }
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
  window.setMonitoringViewMode = setMonitoringViewMode;
  window.deleteMonitoringClient = deleteMonitoringClient;
  window.resetMonitoringToDefault = resetMonitoringToDefault;
  window.exportMonitoringAuditToExcel = exportMonitoringAuditToExcel;
  window.parseLexmarkFleetCsv = parseLexmarkFleetCsv;
  window.detectClientFromCsvRows = detectClientFromCsvRows;
  window.addMonitoringSnapshot = addMonitoringSnapshot;
  window.filterMonitoringBySlide = filterMonitoringBySlide;
  window.updateActiveSlideUI = updateActiveSlideUI;
  window.goToFolioDetail = goToFolioDetail;

  // Funciones de Filtro de Casillas por Cantidades de Suministros
  window.openSupplyLevelsPopover = openSupplyLevelsPopover;
  window.closeSupplyLevelsPopover = closeSupplyLevelsPopover;
  window.renderSupplyLevelsChecklist = renderSupplyLevelsChecklist;
  window.onSupplyLevelCheckboxChange = onSupplyLevelCheckboxChange;
  window.selectAllSupplyLevelsInPopover = selectAllSupplyLevelsInPopover;
  window.invertSupplyLevelsInPopover = invertSupplyLevelsInPopover;
  window.onSupplyLevelsSearchInput = onSupplyLevelsSearchInput;
  window.applySupplyLevelsPopover = applySupplyLevelsPopover;
  window.clearSpecificSupplyLevelType = clearSpecificSupplyLevelType;
  window.clearAllSpecificSupplyLevels = clearAllSpecificSupplyLevels;
  window.updateSpecificSupplyLevelBadges = updateSpecificSupplyLevelBadges;
  window.monitoringSelectedTnrLevels = monitoringSelectedTnrLevels;
  window.monitoringSelectedUdiLevels = monitoringSelectedUdiLevels;
  window.monitoringSelectedKmtLevels = monitoringSelectedKmtLevels;

  // Auto-inicialización inmediata al cargar el DOM
  const autoInitMonitoringModule = () => {
    const navSuite = document.getElementById('suiteNavigation');
    if (navSuite) navSuite.classList.remove('hidden');
    initMonitoringModule();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitMonitoringModule);
  } else {
    autoInitMonitoringModule();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseLexmarkFleetCsv,
    detectClientFromCsvRows,
    addMonitoringSnapshot,
    refreshMonitoringAnalysis,
    filterMonitoringTable,
    filterMonitoringBySlide,
    updateActiveSlideUI,
    goToFolioDetail,
    renderMonitoringTable,
    initMonitoringModule,
    exportMonitoringAuditToExcel,
    openSupplyLevelsPopover,
    closeSupplyLevelsPopover,
    renderSupplyLevelsChecklist,
    onSupplyLevelCheckboxChange,
    selectAllSupplyLevelsInPopover,
    invertSupplyLevelsInPopover,
    onSupplyLevelsSearchInput,
    applySupplyLevelsPopover,
    clearSpecificSupplyLevelType,
    clearAllSpecificSupplyLevels,
    updateSpecificSupplyLevelBadges,
    getMonitoringSelectedTnrLevels: () => monitoringSelectedTnrLevels,
    getMonitoringSelectedUdiLevels: () => monitoringSelectedUdiLevels,
    getMonitoringSelectedKmtLevels: () => monitoringSelectedKmtLevels,
    getMonitoringData: () => monitoringData,
    setMonitoringData: (d) => { monitoringData = d; },
    getMonitoringProcessedList: () => monitoringProcessedList
  };
}
