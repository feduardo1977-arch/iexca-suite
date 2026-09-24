# Excel Analytics Dashboard

Una aplicación interactiva para visualizar, explorar y analizar datos de cualquier archivo de Microsoft Excel (`.xlsx`, `.xls`) o archivo delimitado (`.csv`, `.tsv`) directamente en tu navegador web, **sin necesidad de instalar Python, Node.js ni configurar servidores**.

---

## 🚀 ¿Cómo abrir y usar el Dashboard?

1. Dirígete a la carpeta del proyecto:
   `C:\Users\Personal\.gemini\antigravity\scratch\excel-dashboard`
2. Haz **doble clic en el archivo `index.html`**. Se abrirá en tu navegador web predeterminado (Google Chrome, Microsoft Edge, Firefox o Brave).
3. **Carga tu archivo de Excel**:
   - Arrastra y suelta tu archivo `.xlsx`, `.xls` o `.csv` en la zona central señalizada.
   - O haz clic en el botón superior **"Subir Excel"** para seleccionarlo desde tu equipo.
4. Si tu libro de Excel contiene varias hojas o pestañas, aparecerá automáticamente un selector de **"Hoja"** para cambiar de una a otra al instante.

---

## 📊 Funcionalidades Principales

### 1. Detección Inteligente de Columnas y Tipos
- Identifica automáticamente columnas numéricas (precios, cantidades, totales, porcentajes), categóricas (departamentos, regiones, categorías) y fechas.
- Genera visualizaciones lógicas y coherentes desde el primer segundo.

### 2. Tarjetas de Indicadores Clave (KPIs)
- **Total de registros**: Muestra cuántas filas tiene el archivo y cuántas cumplen con los filtros activos.
- **Suma Total**: Métrica acumulada de la columna numérica seleccionada.
- **Promedio**: Media aritmética calculada en tiempo real.
- **Valor Máximo y Mínimo**: Picos y valores más bajos detectados.
- Puedes cambiar la métrica objetivo de los KPIs con el selector superior *"Métrica clave"*.

### 3. Estudio de Gráficos Interactivos (4 Paneles)
Cada panel incluye controles individuales para personalizar:
- **Gráfico 1 (Distribución por Categorías)**: Barras verticales, horizontales o líneas para comparar dimensiones y métricas.
- **Gráfico 2 (Evolución y Tendencia)**: Línea continua o área sombreada para seguir fechas, meses o secuencias.
- **Gráfico 3 (Participación / Cuota)**: Gráfico de dona o pastel que agrupa automáticamente las categorías principales y consolida las menores en "Otros" para mantener la claridad visual.
- **Gráfico 4 (Ranking Top 10)**: Comparativo de los 10 elementos líderes ordenados de mayor a menor o viceversa.
- **Exportación en PNG**: Cada gráfico cuenta con un botón en forma de icono de descarga para guardar la imagen en alta calidad y usarla en informes o presentaciones.

### 4. Filtros Dinámicos en Tiempo Real
- **Buscador global**: Escribe cualquier texto o número para filtrar instantáneamente todas las filas y gráficos.
- **Selectores de categoría**: Se generan automáticamente filtros por cada dimensión con valores representativos.
- Botón **"Restablecer filtros"** para volver a la vista completa con un clic.

### 5. Tabla de Datos Detallada
- Visualiza todos los registros cargados.
- **Ordenación por columnas**: Haz clic en cualquier encabezado para ordenar ascendentemente o descendentemente.
- **Paginación**: Elige ver 10, 25, 50 o 100 registros por página.
- **Descargar Excel**: Exporta únicamente los registros filtrados a un nuevo archivo `.xlsx` listo para compartir.

### 6. Privacidad y Seguridad Total
- Toda la lectura y procesamiento de los archivos ocurre **100% de manera local en la memoria de tu navegador** mediante SheetJS y Chart.js. Ningún dato ni fila se envía por internet a ningún servidor externo.

---

## 📁 Archivos incluidos en esta carpeta

- [index.html](file:///C:/Users/Personal/.gemini/antigravity/scratch/excel-dashboard/index.html): Aplicación completa del dashboard.
- [sample_ventas.csv](file:///C:/Users/Personal/.gemini/antigravity/scratch/excel-dashboard/sample_ventas.csv): Archivo de prueba con registros de ventas para probar arrastrar y soltar.
- [README.md](file:///C:/Users/Personal/.gemini/antigravity/scratch/excel-dashboard/README.md): Esta guía.
