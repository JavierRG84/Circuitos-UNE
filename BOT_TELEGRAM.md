# Bot de lectura automática del grupo de Telegram

Lee `t.me/s/EmpresaElectricaDeLaHabana` cada 10 minutos, le pide a un modelo
de IA (gratis, vía GitHub Models) que extraiga qué circuitos se
desconectaron/reconectaron y a qué hora, actualiza `data/carga.json`, y lo
sube solo al hosting por FTP. No necesita que tu PC esté prendida ni que
entres a ejecutar nada — corre en los servidores de GitHub.

## Qué vas a necesitar crear (una sola vez)

### 1. Un repositorio en GitHub
Crea un repo nuevo (público, para que las 144 corridas diarias de Actions
no gasten tus minutos gratis — un repo privado tiene límite mensual de
minutos). Sube ahí TODO el contenido de la carpeta del sitio (`index.html`,
`app.js`, etc.) más las dos carpetas nuevas que te doy: `bot/` y
`.github/workflows/`.

### 2. Un token para usar GitHub Models (gratis)
1. Ve a **github.com/settings/tokens** → "Fine-grained tokens" → "Generate new token".
2. Dale un nombre (ej. "bot-eelh"), sin fecha de expiración corta (o la que prefieras).
3. En "Permissions" → busca **Models** → ponlo en **Read-only**.
4. Genera el token y cópialo (empieza con `github_pat_...`) — no lo vuelves a ver.

### 3. Los 4 "Secrets" del repositorio
En tu repo de GitHub: **Settings → Secrets and variables → Actions → New repository secret**.
Crea estos cuatro, uno por uno:

| Nombre | Valor |
|---|---|
| `GH_MODELS_TOKEN` | el token que generaste en el paso 2 |
| `FTP_HOST` | `190.92.127.206` |
| `FTP_USER` | tu usuario FTP (`demipatiftp`) |
| `FTP_PASS` | tu contraseña FTP |

## Cómo probarlo

En tu repo, pestaña **Actions** → selecciona "Bot de lectura Telegram EELH"
→ botón **Run workflow** (arriba a la derecha) → **Run workflow** de nuevo
para confirmar. Corre una vez a mano sin esperar los 10 minutos. Si algo
falla, el log de esa corrida te dice exactamente en qué paso fue.

Una vez que veas que corrió bien, se queda corriendo solo cada 10 minutos
para siempre (mientras el repo exista y el workflow no se desactive).

## Qué hace en cada corrida

1. Descarga la página pública del canal de Telegram.
2. Compara con el último mensaje que ya proceso (guardado en
   `data/telegram_estado.json`) — si no hay mensajes nuevos, no hace nada
   (no gasta cuota de IA de balde).
3. Si hay mensajes nuevos, se los manda TODOS juntos en una sola consulta a
   la IA (para gastar lo menos posible de la cuota gratis — 50-150
   consultas/día según el modelo).
4. La IA devuelve qué circuitos se afectaron/restablecieron y a qué hora.
5. Actualiza `data/carga.json` — mismo archivo que edita `carga.html` a
   mano, así que puedes seguir corrigiendo cosas ahí también sin que se
   pisen.
6. Si el mensaje era un resumen general del sistema (MW totales, cantidad
   de circuitos afectados), lo guarda en `data/resumen_telegram.json` y
   aparece como un banner extra en el resumen del mapa.
7. Sube los archivos actualizados al hosting por FTP.

## Limitaciones que debes saber

- **IDs de circuito ambiguos entre municipios**: si el mensaje de Telegram
  no aclara el municipio (ej. dice solo "1249" y no "1249 (Marianao)") y
  ese código existe en más de un municipio en tu base de datos, el bot NO
  adivina — lo deja sin aplicar y lo anota en el log de esa corrida
  (pestaña Actions → esa corrida → "Correr el bot") para que lo revises
  a mano si hace falta.
- **Cuota gratis de GitHub Models**: con un modelo "mini" (gpt-4o-mini) el
  límite es ~150 consultas al día. El bot solo consulta cuando hay mensajes
  nuevos y los agrupa en una sola llamada por corrida, así que en un día
  normal no debería acercarse al límite; en un día con muchísimos avisos
  seguidos, podría toparlo — si pasa, esa corrida no actualiza nada hasta
  la siguiente ventana en que la cuota se resetee (medianoche UTC).
- **Ráfagas de mensajes**: si se publican muchísimos mensajes en menos de
  10 minutos, el bot pagina hacia atrás en Telegram para no perderse
  ninguno (hasta 6 páginas de respaldo), pero es un límite de seguridad,
  no infinito.
- El bot NO reemplaza `carga.html` — sigue estando para que cargues a mano
  lo que la IA no pueda capturar bien, o para corregir algo que interpretó mal.
