// ---------- Mapa ----------
const map = L.map('map').setView([23.135, -82.395], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors — geocodificación por Nominatim'
}).addTo(map);

const log = document.getElementById('log');
const progressFill = document.getElementById('progress');
const btnStart = document.getElementById('btn-start');
const btnDownload = document.getElementById('btn-download');

function el(tag, opts = {}) {
  const e = document.createElement(tag);
  Object.entries(opts).forEach(([k, v]) => {
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  });
  return e;
}

// ---------- Estado global: cada elemento resoluble vive aquí ----------
// item: { circuito, tipo:'linea'|'punto', calle, desde, hasta, query, p1, p2, capaMapa, filaDOM }
const items = [];
const salidaPorCircuito = {}; // clave 'municipio::id' -> {id,municipio,ubicacion,color}
function clave(c) { return `${c.municipio}::${c.id}`; }

// ---------- Geocodificación ----------
const cache = {};
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const VIEWBOX = '-82.445,23.165,-82.335,23.095'; // La Habana (lon1,lat1,lon2,lat2)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function geocodeCruda(query) {
  if (cache[query] !== undefined) return cache[query];
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=cu&viewbox=${VIEWBOX}&bounded=1&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    const data = await res.json();
    const point = (data && data.length > 0) ? [parseFloat(data[0].lat), parseFloat(data[0].lon)] : null;
    cache[query] = point;
    return point;
  } catch (e) {
    return null;
  }
}

async function geocodeConEspera(query) {
  const p = await geocodeCruda(query);
  await sleep(1100);
  return p;
}

async function geocodeInterseccion(calle, cruce) {
  const intentos = [
    `Calle ${calle} y ${cruce}, Vedado, La Habana, Cuba`,
    `Calle ${calle} y Calle ${cruce}, Vedado, La Habana, Cuba`,
    `${calle} y ${cruce}, Plaza, La Habana, Cuba`,
    `${calle} esquina ${cruce}, La Habana, Cuba`
  ];
  for (const q of intentos) {
    const p = await geocodeConEspera(q);
    if (p) return { punto: p, queryUsada: q };
  }
  return { punto: null, queryUsada: intentos[0] };
}

// ---------- Dibujo incremental en el mapa ----------
function dibujarLinea(item) {
  if (item.capaMapa) map.removeLayer(item.capaMapa);
  if (item.p1 && item.p2) {
    item.capaMapa = L.polyline([item.p1, item.p2], { color: item.color, weight: 3, opacity: 0.85 }).addTo(map);
  }
}
function dibujarPunto(item) {
  if (item.capaMapa) map.removeLayer(item.capaMapa);
  if (item.p1) {
    item.capaMapa = L.circleMarker(item.p1, { radius: 7, color: item.color, fillColor: item.color, fillOpacity: 0.9 }).addTo(map);
  }
}

// ---------- UI de cada fila (con reintento manual si falla) ----------
function crearFila(item) {
  const fila = el('div', { class: 'geo-row' });
  fila.style.marginBottom = '4px';
  actualizarFila(item, fila);
  log.appendChild(fila);
  log.scrollTop = log.scrollHeight;
  item.filaDOM = fila;
}

function etiquetaItem(item) {
  return item.tipo === 'linea'
    ? `Calle ${item.calle} (${item.desde} → ${item.hasta})`
    : item.query;
}

function actualizarFila(item, filaOverride) {
  const fila = filaOverride || item.filaDOM;
  if (!fila) return;
  fila.innerHTML = '';

  if (item.resuelto()) {
    fila.appendChild(el('span', { class: 'ok', html: `&nbsp;&nbsp;✓ ${etiquetaItem(item)}` }));
  } else {
    const linea1 = el('div', { class: 'fail', html: `&nbsp;&nbsp;✗ ${etiquetaItem(item)} — no ubicado` });
    fila.appendChild(linea1);

    const retryBox = el('div');
    retryBox.style.cssText = 'margin:3px 0 8px 16px;display:flex;gap:6px;';
    const input = el('input', { type: 'text', placeholder: 'consulta alternativa para OpenStreetMap…' });
    input.style.cssText = 'flex:1;font-size:12px;padding:4px 6px;border:1px solid var(--line);border-radius:5px;';
    input.value = item.ultimaQuery || '';
    const btn = el('button', { text: 'Reintentar' });
    btn.style.cssText = 'font-size:11.5px;padding:4px 8px;border-radius:5px;border:none;background:var(--navy);color:#fff;cursor:pointer;';
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '…';
      const q = input.value.trim();
      const p = await geocodeConEspera(q);
      item.ultimaQuery = q;
      if (p) {
        if (item.tipo === 'linea') { item.p1 = item.p1 || p; if (item.p1 !== p) item.p2 = p; else item.p1 = p; }
        else item.p1 = p;
        if (item.tipo === 'linea') dibujarLinea(item); else dibujarPunto(item);
      }
      btn.disabled = false; btn.textContent = 'Reintentar';
      actualizarFila(item);
    });
    retryBox.appendChild(input);
    retryBox.appendChild(btn);
    fila.appendChild(retryBox);
  }
}

// ---------- Proceso principal ----------
async function run() {
  btnStart.disabled = true;
  const resp = await fetch('data/segmentos.json');
  const data = await resp.json();
  const circuitos = data.circuitos;

  let totalPasos = 0;
  circuitos.forEach(c => {
    totalPasos += (c.segmentos ? c.segmentos.length : 0) + (c.puntos ? c.puntos.length : 0);
  });
  let pasoActual = 0;

  for (const c of circuitos) {
    salidaPorCircuito[clave(c)] = { id: c.id, municipio: c.municipio, ubicacion: c.ubicacion, color: c.color };
    logLineHead(`${c.id} — ${c.ubicacion.slice(0, 60)}${c.ubicacion.length > 60 ? '…' : ''}`);

    if (c.segmentos) {
      for (const seg of c.segmentos) {
        const item = {
          circuito: clave(c), tipo: 'linea', color: c.color,
          calle: seg.calle, desde: seg.desde, hasta: seg.hasta,
          p1: null, p2: null, capaMapa: null,
          resuelto() { return !!(this.p1 && this.p2); }
        };
        items.push(item);
        crearFila(item);

        const r1 = await geocodeInterseccion(seg.calle, seg.desde);
        const r2 = await geocodeInterseccion(seg.calle, seg.hasta);
        item.p1 = r1.punto; item.p2 = r2.punto;
        item.ultimaQuery = !item.p1 ? r1.queryUsada : r2.queryUsada;
        dibujarLinea(item);
        actualizarFila(item);

        pasoActual++; progressFill.style.width = (100 * pasoActual / totalPasos) + '%';
      }
    }

    if (c.puntos) {
      for (const pt of c.puntos) {
        const item = {
          circuito: clave(c), tipo: 'punto', color: c.color, query: pt.query,
          p1: null, capaMapa: null,
          resuelto() { return !!this.p1; }
        };
        items.push(item);
        crearFila(item);

        const p = await geocodeConEspera(pt.query);
        item.p1 = p; item.ultimaQuery = pt.query;
        dibujarPunto(item);
        actualizarFila(item);

        pasoActual++; progressFill.style.width = (100 * pasoActual / totalPasos) + '%';
      }
    }
  }

  logLineHead('Listo. Los tramos en rojo tienen un cuadro para reintentar con otra consulta — corrígelos antes de descargar, o descarga igual y complétalos luego a mano en el JSON.');
  btnDownload.disabled = false;
}

function logLineHead(text) {
  log.appendChild(el('div', { class: 'circ-head', text }));
  log.scrollTop = log.scrollHeight;
}

btnStart.addEventListener('click', run);

function construirJSON() {
  const porCircuito = {};
  Object.entries(salidaPorCircuito).forEach(([k, c]) => {
    porCircuito[k] = { ...c, lineas: [], puntos: [] };
  });
  items.forEach(item => {
    const c = porCircuito[item.circuito];
    if (item.tipo === 'linea' && item.p1 && item.p2) {
      c.lineas.push([item.p1, item.p2]);
    } else if (item.tipo === 'punto' && item.p1) {
      c.puntos.push(item.p1);
    }
  });
  return { circuitos: Object.values(porCircuito) };
}

btnDownload.addEventListener('click', () => {
  const resultado = construirJSON();
  const blob = new Blob([JSON.stringify(resultado, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'circuitos.json';
  a.click();
});
