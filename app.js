// ---------- Estado ----------
let CIRCUITOS = [];
let CARGA = {};          // clave -> {mw, estado, horario, actualizado}
const capas = {};        // clave -> array de capas Leaflet
const activos = new Set(); // claves activas
const municipiosAbiertos = new Set();
const COLOR_INACTIVO = "#9aa5b1";

function clave(c) { return `${c.municipio}::${c.id}`; }

const map = L.map('map', { zoomControl: true }).setView([23.11, -82.35], 11);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

Promise.all([
  fetch('data/circuitos.json').then(r => r.json()).catch(() => null),
  fetch('data/carga.json').then(r => r.json()).catch(() => ({})),
  fetch('data/resumen_telegram.json').then(r => r.json()).catch(() => null)
]).then(([data, carga, resumenTelegram]) => {
  if (!data) throw new Error('sin circuitos.json');
  CIRCUITOS = data.circuitos;
  CARGA = carga || {};

  const municipiosUnicos = [...new Set(CIRCUITOS.map(c => c.municipio))];
  if (municipiosUnicos.length === 1) municipiosAbiertos.add(municipiosUnicos[0]);

  renderPanel(CIRCUITOS);
  CIRCUITOS.forEach(dibujarCircuito);
  ajustarVistaGeneral();
  actualizarContador();
  actualizarResumenSistema();
  mostrarResumenTelegram(resumenTelegram);
}).catch(err => {
  document.getElementById('lista-municipios').innerHTML =
    '<p style="padding:14px;color:#a33;font-size:13px;">No se pudo cargar data/circuitos.json. Corre geocode.html y sube el resultado.</p>';
  console.error(err);
});

function mostrarResumenTelegram(r) {
  if (!r) return;
  const cont = document.getElementById('resumen-sistema');
  if (!cont) return;
  const banner = document.createElement('div');
  banner.className = 'resumen-item telegram';
  banner.innerHTML = `
    <span class="resumen-num">${r.mw ?? '—'} MW</span>
    <span class="resumen-label">reportado · ${r.circuitos_afectados ?? '—'} circ. (${r.hora || ''})</span>
  `;
  cont.appendChild(banner);
}

// ---------- Dibujar un circuito en el mapa ----------
function dibujarCircuito(c) {
  const grupo = [];
  const k = clave(c);

  (c.lineas || []).forEach(linea => {
    const pl = L.polyline(linea, { color: COLOR_INACTIVO, weight: 3, opacity: 0.75 }).addTo(map);
    pl.bindTooltip(`${c.id} · ${c.municipio}`, { className: 'circ-tooltip', direction: 'center', sticky: true });
    pl.on('click', () => abrirModal(c));
    grupo.push(pl);
  });

  (c.puntos || []).forEach(punto => {
    const cm = L.circleMarker(punto, { radius: 7, color: COLOR_INACTIVO, fillColor: COLOR_INACTIVO, fillOpacity: 0.85, weight: 2 }).addTo(map);
    cm.bindTooltip(`${c.id} · ${c.municipio}`, { className: 'circ-tooltip', direction: 'top' });
    cm.on('click', () => abrirModal(c));
    grupo.push(cm);
  });

  capas[k] = grupo;
}

function estiloCircuito(c, activo) {
  const grupo = capas[clave(c)];
  if (!grupo) return;
  grupo.forEach(capa => {
    if (capa instanceof L.Polyline && !(capa instanceof L.Polygon)) {
      capa.setStyle({ color: activo ? c.color : COLOR_INACTIVO, weight: activo ? 5 : 3, opacity: activo ? 0.95 : 0.75 });
      if (activo) capa.bringToFront();
    } else {
      capa.setStyle({ color: activo ? c.color : COLOR_INACTIVO, fillColor: activo ? c.color : COLOR_INACTIVO, radius: activo ? 9 : 7 });
      if (activo) capa.bringToFront();
    }
  });
}

function ajustarVistaGeneral() {
  const todasCapas = Object.values(capas).flat();
  if (!todasCapas.length) return;
  const grupo = L.featureGroup(todasCapas);
  const bounds = grupo.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
}

// ---------- Panel lateral: Municipio > Circuitos ----------
function agruparPorMunicipio(lista) {
  const grupos = {};
  lista.forEach(c => {
    const m = c.municipio || 'Sin municipio';
    if (!grupos[m]) grupos[m] = [];
    grupos[m].push(c);
  });
  return grupos;
}

function renderPanel(lista) {
  const cont = document.getElementById('lista-municipios');
  cont.innerHTML = '';
  const grupos = agruparPorMunicipio(lista);
  const nombresMunicipio = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'es'));

  nombresMunicipio.forEach(municipio => {
    const circuitosDelMunicipio = grupos[municipio];
    const abierto = municipiosAbiertos.has(municipio);

    const seccion = document.createElement('div');
    seccion.className = 'municipio-seccion';

    const mwMunicipio = circuitosDelMunicipio.reduce((s, c) => {
      const d = CARGA[clave(c)];
      return s + (d && d.mw ? Number(d.mw) : 0);
    }, 0);

    const cabecera = document.createElement('div');
    cabecera.className = 'municipio-head' + (abierto ? ' abierto' : '');
    cabecera.innerHTML = `
      <span class="municipio-caret">${abierto ? '▾' : '▸'}</span>
      <span class="municipio-nombre">${municipio}</span>
      ${mwMunicipio ? `<span class="municipio-mw">${mwMunicipio.toFixed(1)} MW</span>` : ''}
      <span class="municipio-count">${circuitosDelMunicipio.length}</span>
    `;
    cabecera.addEventListener('click', () => {
      if (municipiosAbiertos.has(municipio)) municipiosAbiertos.delete(municipio);
      else municipiosAbiertos.add(municipio);
      renderPanel(lista);
    });
    seccion.appendChild(cabecera);

    if (abierto) {
      const ul = document.createElement('ul');
      ul.className = 'circuit-list';
      circuitosDelMunicipio.forEach(c => ul.appendChild(crearItemCircuito(c)));
      seccion.appendChild(ul);
    }

    cont.appendChild(seccion);
  });

  if (nombresMunicipio.length === 0) {
    cont.innerHTML = '<p style="padding:14px;color:var(--ink-soft);font-size:13px;">Sin resultados.</p>';
  }
}

function crearItemCircuito(c) {
  const k = clave(c);
  const d = CARGA[k];
  const li = document.createElement('li');
  li.className = 'circuit-item' + (activos.has(k) ? ' activo' : '');
  li.dataset.key = k;

  let estadoTag = '';
  if (d && d.estado) {
    const cls = d.estado === 'desconectado' ? 'tag-desconectado' : 'tag-conectado';
    estadoTag = `<span class="estado-tag ${cls}">${d.estado === 'desconectado' ? '⚡ desc.' : 'conectado'}</span>`;
  }

  li.innerHTML = `
    <input type="checkbox" data-key="${k}" ${activos.has(k) ? 'checked' : ''}>
    <span class="circuit-swatch" style="background:${c.color}"></span>
    <div class="circuit-info">
      <div class="nombre">${c.id} ${estadoTag}</div>
      <div class="ubic">${c.ubicacion}</div>
    </div>
  `;
  li.querySelector('.circuit-info').addEventListener('click', () => abrirModal(c));
  li.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
    toggleCircuito(c, e.target.checked);
  });
  return li;
}

function toggleCircuito(c, activado) {
  const k = clave(c);
  if (activado) activos.add(k); else activos.delete(k);
  estiloCircuito(c, activado);
  const li = document.querySelector(`.circuit-item[data-key="${k}"]`);
  if (li) li.classList.toggle('activo', activado);
  actualizarContador();
}

function actualizarContador() {
  document.getElementById('contador-activos').textContent = `${activos.size} activos`;
}

// ---------- Resumen del sistema (dashboard) ----------
function actualizarResumenSistema() {
  const cont = document.getElementById('resumen-sistema');
  if (!cont) return;

  const total = CIRCUITOS.length;
  let totalMW = 0, conectados = 0, desconectados = 0, sinDato = 0;

  CIRCUITOS.forEach(c => {
    const d = CARGA[clave(c)];
    if (d && d.mw) totalMW += Number(d.mw);
    if (!d || !d.estado) sinDato++;
    else if (d.estado === 'desconectado') desconectados++;
    else conectados++;
  });

  cont.innerHTML = `
    <div class="resumen-item"><span class="resumen-num">${total}</span><span class="resumen-label">circuitos</span></div>
    <div class="resumen-item"><span class="resumen-num">${totalMW.toFixed(1)}</span><span class="resumen-label">MW totales</span></div>
    <div class="resumen-item ok"><span class="resumen-num">${conectados}</span><span class="resumen-label">conectados</span></div>
    <div class="resumen-item alerta"><span class="resumen-num">${desconectados}</span><span class="resumen-label">desconectados</span></div>
    <div class="resumen-item"><span class="resumen-num">${sinDato}</span><span class="resumen-label">sin dato</span></div>
  `;
}

// ---------- Modal ----------
const overlay = document.getElementById('modal-overlay');

function abrirModal(c) {
  const d = CARGA[clave(c)] || {};
  document.getElementById('modal-titulo').textContent = c.id;
  document.getElementById('modal-municipio').textContent = c.municipio;
  document.getElementById('modal-ubicacion').textContent = c.ubicacion;
  document.getElementById('modal-color-dot').style.background = c.color;

  const statsEl = document.getElementById('modal-stats');
  const partes = [];
  if (d.estado) partes.push(`<span class="stat-chip ${d.estado === 'desconectado' ? 'tag-desconectado' : 'tag-conectado'}">${d.estado}</span>`);
  if (d.mw) partes.push(`<span class="stat-chip">${d.mw} MW</span>`);
  if (d.horario) partes.push(`<span class="stat-chip">${d.horario}</span>`);
  if (d.actualizado) partes.push(`<span class="stat-chip stat-fecha">act. ${d.actualizado}</span>`);
  statsEl.innerHTML = partes.length ? partes.join('') : '<span class="stat-chip stat-vacio">Sin datos de carga cargados aún</span>';

  overlay.classList.add('visible');
}

document.getElementById('modal-close').addEventListener('click', () => overlay.classList.remove('visible'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('visible'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.classList.remove('visible'); });

// ---------- Buscador ----------
document.getElementById('buscador').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) {
    renderPanel(CIRCUITOS);
    return;
  }
  const filtrados = CIRCUITOS.filter(c =>
    c.id.toLowerCase().includes(q) ||
    c.ubicacion.toLowerCase().includes(q) ||
    c.municipio.toLowerCase().includes(q)
  );
  [...new Set(filtrados.map(c => c.municipio))].forEach(m => municipiosAbiertos.add(m));
  renderPanel(filtrados);
});

// ---------- Desmarcar todos ----------
document.getElementById('btn-limpiar').addEventListener('click', () => {
  [...activos].forEach(k => {
    const c = CIRCUITOS.find(x => clave(x) === k);
    if (c) estiloCircuito(c, false);
  });
  activos.clear();
  document.querySelectorAll('.circuit-item input[type="checkbox"]').forEach(chk => chk.checked = false);
  document.querySelectorAll('.circuit-item.activo').forEach(li => li.classList.remove('activo'));
  actualizarContador();
});
