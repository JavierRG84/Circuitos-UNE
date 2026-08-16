#!/usr/bin/env python3
"""
Bot de lectura del grupo público de Telegram de la Empresa Eléctrica de La Habana.
Corre cada 10 minutos vía GitHub Actions:
  1. Descarga la vista pública del grupo (t.me/s/<canal>)
  2. Detecta mensajes nuevos desde la última corrida (data/telegram_estado.json)
  3. Le pide a un modelo de IA (GitHub Models, gratis) que extraiga los datos útiles
  4. Actualiza data/carga.json con estado/MW/horario por circuito
  5. Actualiza data/resumen_telegram.json con el último reporte general del sistema
  6. Sube ambos archivos al hosting por FTP
"""
import json
import os
import re
import sys
import time
import ftplib
import urllib.request
from datetime import datetime, timezone

CANAL = os.environ.get("TELEGRAM_CANAL", "EmpresaElectricaDeLaHabana")
BASE_URL = f"https://t.me/s/{CANAL}"
DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SEGMENTOS_PATH = os.path.join(DATA_DIR, "segmentos.json")
CARGA_PATH = os.path.join(DATA_DIR, "carga.json")
ESTADO_PATH = os.path.join(DATA_DIR, "telegram_estado.json")
RESUMEN_PATH = os.path.join(DATA_DIR, "resumen_telegram.json")

GH_MODELS_TOKEN = os.environ.get("GH_MODELS_TOKEN")
GH_MODELS_URL = "https://models.github.ai/inference/chat/completions"
GH_MODELS_MODEL = os.environ.get("GH_MODELS_MODEL", "openai/gpt-4o-mini")

MAX_PAGINAS_ATRAS = 6  # tope de seguridad para no golpear Telegram de más


def cargar_json(path, default):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return default


def guardar_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def fetch_html(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", errors="ignore")


def parsear_mensajes(html):
    """Extrae (id, hora_texto, texto_plano) de cada mensaje del HTML de t.me/s/<canal>."""
    mensajes = []
    bloques = re.findall(
        r'<div class="tgme_widget_message[^"]*"\s+data-post="([^"]+)".*?'
        r'(?=<div class="tgme_widget_message[^"]*"\s+data-post|\Z)',
        html, re.DOTALL
    )
    # el regex de arriba no captura bien contenido completo por bloque con solo findall simple;
    # usamos un split manual por data-post para mayor fiabilidad:
    partes = re.split(r'(<div class="tgme_widget_message[^"]*"\s+data-post="([^"]+)")', html)
    for i in range(1, len(partes), 3):
        post_id = partes[i + 1]
        cuerpo = partes[i + 2] if i + 2 < len(partes) else ""
        texto_match = re.search(
            r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>',
            cuerpo, re.DOTALL
        )
        hora_match = re.search(r'<time[^>]*datetime="([^"]+)"', cuerpo)
        if not texto_match:
            continue
        texto_html = texto_match.group(1)
        texto = re.sub(r"<br\s*/?>", "\n", texto_html)
        texto = re.sub(r"<[^>]+>", "", texto)
        texto = re.sub(r"&amp;", "&", texto)
        texto = re.sub(r"&#33;|&#x21;", "!", texto)
        texto = texto.strip()
        try:
            num_id = int(post_id.split("/")[-1])
        except ValueError:
            continue
        mensajes.append({
            "id": num_id,
            "hora": hora_match.group(1) if hora_match else None,
            "texto": texto,
        })
    return mensajes


def obtener_mensajes_nuevos(ultimo_id_visto):
    """Pagina hacia atrás si hace falta hasta cubrir todo lo nuevo desde ultimo_id_visto."""
    todos = []
    url = BASE_URL
    for _ in range(MAX_PAGINAS_ATRAS):
        html = fetch_html(url)
        mensajes = parsear_mensajes(html)
        if not mensajes:
            break
        todos.extend(mensajes)
        mas_viejo = min(m["id"] for m in mensajes)
        if mas_viejo <= ultimo_id_visto:
            break
        url = f"{BASE_URL}?before={mas_viejo}"
        time.sleep(1)

    nuevos = [m for m in todos if m["id"] > ultimo_id_visto]
    nuevos.sort(key=lambda m: m["id"])
    return nuevos


PROMPT_SISTEMA = """Eres un asistente que lee comunicados de la Empresa Eléctrica de La Habana (UNE) \
publicados en Telegram y extrae datos estructurados sobre circuitos de distribución eléctrica.

De cada mensaje, identifica:
- Códigos de circuito mencionados (ej: PZ9, 1245, A815, GC18, OP304 — letras+números, a veces varios en un mismo mensaje)
- Si el mensaje indica DESCONEXIÓN/AFECTACIÓN (circuito se fue) o RECONEXIÓN/RESTABLECIMIENTO (circuito volvió)
- La hora mencionada en el texto (formato tal cual aparece, ej "06:49 PM")
- El municipio, SOLO si aparece explícito entre paréntesis o mencionado junto al circuito (ej "R454 (Guanabacoa)")
- Si el mensaje es un RESUMEN GENERAL DEL SISTEMA con MW totales y cantidad de circuitos afectados (ej "644 MW distribuidos en 183 circuitos"), captúralo aparte.

Responde SOLO con JSON válido, sin texto adicional, con esta forma exacta:
{
  "eventos": [
    {"circuito": "GC18", "municipio_hint": null, "tipo": "desconexion", "hora": "06:49 PM"}
  ],
  "resumen_sistema": null
}

Si el mensaje es un resumen general, usa:
{"eventos": [], "resumen_sistema": {"mw": 644, "circuitos_afectados": 183, "hora": "09:00 pm"}}

Si el mensaje no tiene información útil de circuitos (ej. avisos genéricos, agradecimientos), responde:
{"eventos": [], "resumen_sistema": null}

"tipo" debe ser exactamente uno de: "desconexion", "conexion", "averia".
"""


def pedir_extraccion_ia(mensajes):
    """Envía todos los mensajes nuevos en un solo lote al modelo y pide extracción estructurada."""
    if not mensajes:
        return []
    if not GH_MODELS_TOKEN:
        print("AVISO: no hay GH_MODELS_TOKEN configurado, no se puede usar IA. Saltando extracción.")
        return []

    bloque = "\n\n---\n\n".join(f"[msg {m['id']} · {m['hora']}]\n{m['texto']}" for m in mensajes)

    body = json.dumps({
        "model": GH_MODELS_MODEL,
        "messages": [
            {"role": "system", "content": PROMPT_SISTEMA},
            {"role": "user", "content": f"Analiza estos mensajes, uno por uno, y devuelve un JSON con la lista total de eventos de TODOS los mensajes combinados:\n\n{bloque}"}
        ],
        "temperature": 0,
    }).encode("utf-8")

    req = urllib.request.Request(
        GH_MODELS_URL, data=body,
        headers={
            "Authorization": f"Bearer {GH_MODELS_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.loads(r.read().decode("utf-8"))
        contenido = resp["choices"][0]["message"]["content"]
        contenido = re.sub(r"^```json\s*|\s*```$", "", contenido.strip())
        return [json.loads(contenido)]
    except Exception as e:
        print(f"ERROR llamando a GitHub Models: {e}")
        return []


def clave(municipio, cid):
    return f"{municipio}::{cid}"


def aplicar_eventos(circuitos, carga, resultados, ahora_iso):
    """Actualiza carga (dict clave->datos) según los eventos extraídos por la IA."""
    por_id = {}
    for c in circuitos:
        por_id.setdefault(c["id"], []).append(c["municipio"])

    pendientes_ambiguos = []
    ultimo_resumen_sistema = None

    for resultado in resultados:
        for ev in resultado.get("eventos", []):
            cid = (ev.get("circuito") or "").strip().upper()
            if not cid or cid not in por_id:
                continue
            municipios_posibles = por_id[cid]
            municipio_hint = (ev.get("municipio_hint") or "").strip()
            municipio_final = None

            if len(municipios_posibles) == 1:
                municipio_final = municipios_posibles[0]
            elif municipio_hint:
                for m in municipios_posibles:
                    if municipio_hint.lower() in m.lower() or m.lower() in municipio_hint.lower():
                        municipio_final = m
                        break

            if not municipio_final:
                pendientes_ambiguos.append(ev)
                continue

            k = clave(municipio_final, cid)
            estado = {"desconexion": "desconectado", "averia": "desconectado", "conexion": "conectado"}.get(ev.get("tipo"), None)
            if not estado:
                continue

            registro = carga.get(k, {})
            registro["estado"] = estado
            if ev.get("hora"):
                registro["horario"] = f"{'Desconectado' if estado=='desconectado' else 'Reconectado'} {ev['hora']}"
            registro["actualizado"] = ahora_iso
            registro["fuente"] = "telegram-bot"
            carga[k] = registro

        if resultado.get("resumen_sistema"):
            ultimo_resumen_sistema = resultado["resumen_sistema"]
            ultimo_resumen_sistema["actualizado"] = ahora_iso

    return carga, pendientes_ambiguos, ultimo_resumen_sistema


def subir_ftp(archivos_locales_remotos):
    host = os.environ.get("FTP_HOST")
    user = os.environ.get("FTP_USER")
    passwd = os.environ.get("FTP_PASS")
    if not host or not user or not passwd:
        print("AVISO: faltan credenciales FTP (FTP_HOST/FTP_USER/FTP_PASS). No se sube nada.")
        return
    with ftplib.FTP(host, timeout=30) as ftp:
        ftp.login(user, passwd)
        for local_path, remote_path in archivos_locales_remotos:
            with open(local_path, "rb") as f:
                ftp.storbinary(f"STOR {remote_path}", f)
            print(f"Subido: {remote_path}")


def main():
    circuitos_data = cargar_json(SEGMENTOS_PATH, {"circuitos": []})
    circuitos = circuitos_data["circuitos"]

    estado = cargar_json(ESTADO_PATH, {"ultimo_id": 0})
    carga = cargar_json(CARGA_PATH, {})

    print(f"Último mensaje procesado: {estado['ultimo_id']}")
    nuevos = obtener_mensajes_nuevos(estado["ultimo_id"])
    print(f"Mensajes nuevos encontrados: {len(nuevos)}")

    if not nuevos:
        print("Nada nuevo. Fin.")
        return

    resultados = pedir_extraccion_ia(nuevos)
    ahora_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    carga, pendientes, resumen_sistema = aplicar_eventos(circuitos, carga, resultados, ahora_iso)

    guardar_json(CARGA_PATH, carga)

    estado["ultimo_id"] = max(m["id"] for m in nuevos)
    estado["ultima_corrida"] = ahora_iso
    guardar_json(ESTADO_PATH, estado)

    archivos_a_subir = [(CARGA_PATH, "data/carga.json"), (ESTADO_PATH, "data/telegram_estado.json")]

    if resumen_sistema:
        guardar_json(RESUMEN_PATH, resumen_sistema)
        archivos_a_subir.append((RESUMEN_PATH, "data/resumen_telegram.json"))

    if pendientes:
        print(f"AVISO: {len(pendientes)} eventos no se pudieron asignar a un municipio con certeza (ids ambiguos entre municipios). Revisar manualmente:")
        for p in pendientes:
            print(f"  - {p}")

    subir_ftp(archivos_a_subir)
    print("Listo.")


if __name__ == "__main__":
    sys.exit(main())
