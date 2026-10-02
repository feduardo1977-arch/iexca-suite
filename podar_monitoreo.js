// podar_monitoreo.js  -  Mantiene solo los últimos N cortes por cliente en default_monitoring_data.js
// Uso (desde la carpeta del repo, requiere Node.js):
//   node podar_monitoreo.js            -> conserva 5 cortes por cliente
//   node podar_monitoreo.js 4          -> conserva 4
//   node podar_monitoreo.js 4 --dry    -> solo muestra el resultado, no escribe nada
// Crea un respaldo default_monitoring_data.js.bak antes de sobrescribir.
const fs = require('fs'), vm = require('vm');
const FILE = 'default_monitoring_data.js';
const keep = parseInt(process.argv[2], 10) > 0 ? parseInt(process.argv[2], 10) : 5;
const dry = process.argv.includes('--dry');

const src = fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, '');
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const data = ctx.window.DEFAULT_MONITORING_DATA;
if (!data || typeof data !== 'object') { console.error('No se encontró window.DEFAULT_MONITORING_DATA'); process.exit(1); }

const out = {};
for (const cliente of Object.keys(data)) {
  const cortes = (data[cliente] || []).slice()
    .sort((a, b) => String(b.uploadDate).localeCompare(String(a.uploadDate))); // más reciente primero (el motor usa snaps[0] como "última lectura")
  out[cliente] = cortes.slice(0, keep);
  console.log(`${cliente}: ${cortes.length} cortes -> ${out[cliente].length}`);
}
const nuevo = 'window.DEFAULT_MONITORING_DATA = ' + JSON.stringify(out) + ';\n';
console.log(`Tamaño: ${(Buffer.byteLength(src) / 1024).toFixed(0)} KB -> ${(Buffer.byteLength(nuevo) / 1024).toFixed(0)} KB`);
if (dry) { console.log('(modo --dry: no se escribió nada)'); process.exit(0); }
fs.copyFileSync(FILE, FILE + '.bak');
fs.writeFileSync(FILE, nuevo, 'utf8');
console.log('Listo. Respaldo en ' + FILE + '.bak');
