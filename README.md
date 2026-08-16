# Mapa de Circuitos Eléctricos — Empresa Eléctrica de La Habana

Aplicación web estática que dibuja los tramos de calle de cada circuito
eléctrico sobre un mapa real (OpenStreetMap vía Leaflet.js), organizados por
municipio, con checkbox para resaltar cada circuito y un panel de
estadísticas (MW, estado de conexión, horarios) alimentado a mano.

**Estado actual: 152 circuitos en 13 municipios** (10 de Octubre, Centro
Habana, Cerro, Cotorro, Guanabacoa, Habana Vieja, Habana del Este, La Lisa,
Marianao, Playa, Plaza, Regla, San Miguel del Padrón).

## Estructura

```
circuitos/
├── index.html            → mapa público
├── geocode.html           → herramienta: resuelve calles reales contra OpenStreetMap
├── geocode.js
├── carga.html              → herramienta: cargar MW / estado / horarios por circuito
├── carga.js
├── app.js                    → lógica del mapa público
├── style.css
├── data/
│   ├── segmentos.json      → los 152 circuitos en texto (editable), tal como están en los PDF
│   ├── circuitos.json      → SE GENERA con geocode.html (coordenadas reales)
│   └── carga.json           → SE GENERA con carga.html (estadísticas)
└── README.md
```

## Cómo funciona

1. **`data/segmentos.json`** tiene los 152 circuitos como texto: para cada
   uno, `municipio`, `ubicacion` (tal como aparece en el PDF de UNE), y sus
   tramos de calle (`{"calle":"4","desde":"35","hasta":"Hidalgo"}`) o puntos
   de referencia (hoteles, repartos sin calles definidas).
2. **`geocode.html`** — corres esto una vez. Consulta OpenStreetMap
   (Nominatim) calle por calle y dibuja los tramos reales en un mapa. Con
   152 circuitos hay unas **1000 consultas**, a ~1.1s cada una por la
   política de uso de Nominatim → **cerca de 20 minutos**. Puedes dejarlo
   corriendo de fondo; el log de la izquierda te muestra el avance y marca
   en rojo lo que no se pudo ubicar, con un cuadro para reintentar con otra
   consulta ahí mismo.
3. Al terminar, descargas `circuitos.json` y lo subes a `data/circuitos.json`.
4. **`carga.html`** — formulario para cargar, por circuito: estado
   (conectado/desconectado), MW, horario (texto libre) y fecha de
   actualización. Lo llenas con lo que saques del grupo de Telegram, exportas
   `carga.json`, lo subes a `data/carga.json`.
5. **`index.html`** (mapa público) solo lee los dos JSON ya resueltos — no
   vuelve a consultar Nominatim en cada visita.

## Panel de resumen del sistema

En la parte superior del mapa aparece un resumen: total de circuitos, MW
totales, cuántos están conectados/desconectados y cuántos no tienen dato
cargado aún. Cada municipio en el panel izquierdo también muestra su MW
acumulado si tiene datos cargados. Al hacer click en un circuito, el modal
muestra sus chips de estado/MW/horario si existen.

## Importante: IDs de circuito repetidos entre municipios

Algunos IDs se repiten en varios municipios en los datos reales de UNE
(`1249`, `A980`, `A1380`, `R454`, `R464`, `H341`, `H342`, `P327`, `A815`,
`2210`, `1175`, `1245`, `1246`). Esto es así en el PDF original — el
código internamente distingue cada circuito por **municipio + id
combinados**, así que no hay conflicto: puedes marcar el `1249` de Plaza sin
afectar el `1249` de Marianao o el de Playa.

## Añadir más circuitos o municipios (próximos PDFs)

Añade objetos al array `"circuitos"` de `data/segmentos.json` con el mismo
formato, corre `geocode.html` de nuevo (usa caché en memoria — lo ya
geocodificado no repite consulta si la calle no cambió) y descarga el
`circuitos.json` actualizado. El panel del mapa se reorganiza solo por
municipio.

## Si algún tramo queda mal o falta

La cobertura de OpenStreetMap en Cuba es despareja — vías principales del
Vedado o Habana Vieja suelen estar bien mapeadas, pero calles de barrios
periféricos (Cotorro, San Miguel del Padrón, Guanabacoa) pueden faltar. Usa
el cuadro de reintento en `geocode.html`, o ajusta el nombre de la calle en
`segmentos.json` y vuelve a correr.

## Hosting

Sitio 100% estático — sube la carpeta completa por FTP/SFTP a
`www.demipati.cu/UNE/`. No requiere PHP ni base de datos.
