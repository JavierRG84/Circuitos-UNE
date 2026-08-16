let CIRCUITOS = [];
let CARGA = {};

function clave(c) { return `${c.municipio}::${c.id}`; }

function hoyLocal() {
  const d = new Date();
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

async function init() {
  const respCircuitos = await fetch('data/circuitos.json').then(r => r.json()).catch(() => null);
  if (respCircuitos) {
    CIRCUITOS = respCircuitos.circuitos;
  } else {
    // si aún no corriste geocode.html, igual permite cargar estadísticas desde segmentos.json
    const seg = await fetch('data/segmentos.json').then(r => r.json());
    CIRCUITOS = seg.circuitos;
  }

  try {
    CARGA = await fetch('data/carga.json').then(r => r.json());
  } catch (e) { CARGA = {}; }

  llenarFiltroMunicipios();
  render();
}

function llenarFiltroMunicipios() {
  const select = document.getElementById('filtro-municipio');
  const municipios = [...new Set(CIRCUITOS.map(c => c.municipio))].sort((a, b) => a.localeCompare(b, 'es'));
  municipios.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    select.appendChild(opt);
  });
  select.addEventListener('change', render);
}

function render() {
  const filtro = document.getElementById('filtro-municipio').value;
  const tbody = document.getElementById('tabla-body');
  tbody.innerHTML = '';

  const grupos = {};
  CIRCUITOS.forEach(c => {
    if (filtro && c.municipio !== filtro) return;
    if (!grupos[c.municipio]) grupos[c.municipio] = [];
    grupos[c.municipio].push(c);
  });

  Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'es')).forEach(municipio => {
    const filaMunicipio = document.createElement('tr');
    filaMunicipio.className = 'municipio-fila';
    filaMunicipio.innerHTML = `<td colspan="5">${municipio}</td>`;
    tbody.appendChild(filaMunicipio);

    grupos[municipio].forEach(c => {
      const k = clave(c);
      const d = CARGA[k] || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${c.id}</strong><br><span style="color:var(--ink-soft);font-size:11px;">${c.ubicacion.slice(0, 40)}${c.ubicacion.length > 40 ? '…' : ''}</span></td>
        <td>
          <select data-k="${k}" data-campo="estado">
            <option value="" ${!d.estado ? 'selected' : ''}>—</option>
            <option value="conectado" ${d.estado === 'conectado' ? 'selected' : ''}>Conectado</option>
            <option value="desconectado" ${d.estado === 'desconectado' ? 'selected' : ''}>Desconectado</option>
          </select>
        </td>
        <td><input type="number" step="0.1" data-k="${k}" data-campo="mw" value="${d.mw || ''}" placeholder="MW"></td>
        <td><input type="text" data-k="${k}" data-campo="horario" value="${d.horario || ''}" placeholder="ej. 9:00–13:00"></td>
        <td><input type="text" data-k="${k}" data-campo="actualizado" value="${d.actualizado || ''}" placeholder="fecha/hora"></td>
      `;
      tbody.appendChild(tr);
    });
  });

  tbody.querySelectorAll('input, select').forEach(el => {
    el.addEventListener('change', (e) => {
      const k = e.target.dataset.k, campo = e.target.dataset.campo;
      if (!CARGA[k]) CARGA[k] = {};
      CARGA[k][campo] = e.target.value;
      if (campo !== 'actualizado' && e.target.value) {
        CARGA[k].actualizado = CARGA[k].actualizado || hoyLocal();
      }
      // limpiar objetos vacíos
      if (Object.values(CARGA[k]).every(v => !v)) delete CARGA[k];
    });
  });
}

document.getElementById('btn-guardar').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(CARGA, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'carga.json';
  a.click();
});

document.getElementById('input-cargar').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      CARGA = JSON.parse(reader.result);
      render();
    } catch (err) {
      alert('Ese archivo no es un JSON válido.');
    }
  };
  reader.readAsText(file);
});

init();
