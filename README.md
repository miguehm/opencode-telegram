# opencode Telegram bot

Bot de Telegram que permite usar el harness de [opencode](https://opencode.ai) desde el chat y trabajar con proyectos creados con `try`.

El bot ofrece una interfaz nativa de Telegram, no una TUI completa: muestra el streaming de las respuestas, los permisos de opencode, una command palette, sesiones, agentes, modelos, comandos de shell y una terminal PTY interactiva.

## Características

- Servidor `opencode serve` compartido, con aislamiento por directorio.
- Proyectos descubiertos dentro de `TRY_PATH`.
- Creación de proyectos con `try new`, `try clone` y `try worktree`.
- Conversaciones con streaming en Telegram.
- Command palette equivalente a `Ctrl+P`.
- Cambio de agente equivalente a `Tab` (`plan` / `build`).
- Sesiones de opencode por proyecto, con creación, cambio, renombrado, borrado y compactación.
- Permisos de opencode enviados como botones inline.
- Ejecución de comandos con `/sh`, `/cmd` y `/exec`.
- Terminal interactiva por WebSocket mediante `/term`.
- Persistencia del proyecto, sesión, agente, modelo y preferencias por chat.

## Requisitos

- Node.js 22 o superior (probado con 22.23.2).
- El CLI `opencode` disponible en `PATH`.
- El binario `try` disponible en `PATH` (probado con `try` 1.10.1).
- `git` y `bash` disponibles en `PATH`.
- Un bot de Telegram creado con [@BotFather](https://t.me/BotFather).
- Tu ID numérico de Telegram, por ejemplo obtenido con [@userinfobot](https://t.me/userinfobot).

`try` es el gestor de workspaces efímeros. No es el paquete npm `try-cli`; este proyecto invoca el binario `try` real.

## Inicio rápido

```bash
npm install
cp .env.example .env
```

Edita `.env` con al menos estos valores:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIjKlMnOpQrStUvWxYz
TELEGRAM_ALLOWED_USERS=123456789
TRY_PATH=~/src/tries
```

Arranca en modo desarrollo:

```bash
npm run dev
```

El bot levantará su propio `opencode serve` en `127.0.0.1:4096` si no configuras `OPENCODE_URL`. Cuando el proceso termina con `Ctrl+C`, el servidor gestionado también se detiene.

En Telegram:

1. Envía `/start` para ver la ayuda.
2. Envía `/projects` para listar los proyectos de `TRY_PATH`.
3. Selecciona uno con `/use <nombre>`.
4. Escribe un mensaje normal para enviarlo al agente activo.

También puedes abrir el menú con `/p`.

## Configuración

Todas las variables se leen desde el entorno o desde `.env`. `.env.example` contiene una plantilla.

| Variable | Obligatoria | Valor por defecto | Descripción |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Sí | — | Token del bot de Telegram. |
| `TELEGRAM_ALLOWED_USERS` | Sí | — | IDs numéricos de Telegram autorizados, separados por comas o espacios. |
| `TRY_PATH` | No | `~/src/tries` | Directorio raíz donde se buscan y crean los proyectos. |
| `TRY_BIN` | No | `try` | Nombre o ruta del binario `try`. |
| `OPENCODE_URL` | No | — | URL de un servidor opencode existente. Si se define, el bot no lanza uno propio. Debe incluir el esquema, por ejemplo `http://127.0.0.1:4096`. |
| `OPENCODE_HOST` | No | `127.0.0.1` | Host del servidor opencode gestionado por el bot. |
| `OPENCODE_PORT` | No | `4096` | Puerto del servidor opencode gestionado por el bot. |
| `OPENCODE_SERVER_PASSWORD` | No | — | Contraseña para el servidor opencode gestionado o para autenticar contra uno externo protegido. |
| `OPENCODE_SERVER_USERNAME` | No | `opencode` | Usuario para la autenticación básica del servidor opencode. |
| `STATE_DIR` | No | `$XDG_STATE_HOME/opencode-telegram` o `~/.local/state/opencode-telegram` | Directorio donde se guarda `state.json`. |
| `LOG_LEVEL` | No | `info` | Nivel de log: `debug`, `info`, `warn` o `error`. |
| `TERM_COLS` | No | `120` | Ancho de la PTY. |
| `TERM_ROWS` | No | `40` | Alto de la PTY. |

Notas:

- `TELEGRAM_ALLOWED_USERS` debe contener IDs numéricos positivos. Los usuarios que no estén en la lista no pueden usar el bot.
- `OPENCODE_URL` tiene prioridad sobre `OPENCODE_HOST` y `OPENCODE_PORT`.
- El servidor externo debe responder correctamente en `/global/health`; el bot lo comprueba al arrancar.
- `OPENCODE_SERVER_PASSWORD` se pasa al servidor gestionado mediante el entorno. Si usas un servidor externo con contraseña, configura también `OPENCODE_SERVER_USERNAME`.
- `SMOKE_PROJECT` es opcional y solo lo usa `npm run smoke` para elegir el proyecto de prueba.

## Arranque

### Desarrollo

```bash
npm run dev
```

Ejecuta TypeScript directamente con `tsx` y carga el archivo `.env` si existe.

### Producción

```bash
npm run build
npm start
```

`npm run build` genera `dist/`. `npm start` ejecuta `dist/index.js` con el `.env` si está presente.

Si usas systemd u otro gestor de procesos, pasa las variables con `EnvironmentFile` y ejecuta directamente Node:

```bash
node dist/index.js
```

### Comprobación rápida

```bash
TELEGRAM_BOT_TOKEN=dummy TELEGRAM_ALLOWED_USERS=1 npm run smoke
```

El smoke test no usa Telegram, pero `loadConfig()` exige token y allowlist. Comprueba `try`, levanta opencode, valida `/global/health`, lista proyectos, consulta agentes/sesiones/proveedores/comandos/archivos y, si hay algún proyecto, crea y borra una sesión temporal. Al terminar detiene el servidor gestionado.

Puedes elegir el proyecto de prueba con `SMOKE_PROJECT=/ruta/al/proyecto`.

## Uso

### Primeros pasos

1. `/projects` muestra los directorios encontrados en `TRY_PATH`, incluyendo rama y estado git si es un repositorio.
2. `/use <nombre>` selecciona un proyecto y crea o reutiliza una sesión de opencode.
3. Los mensajes que no empiezan por `/` se envían al agente activo.
4. `/p` abre la command palette con accesos a sesiones, proyectos, agentes, modelos, comandos, diff, tareas, terminal y estado.

### Proyectos y archivos

| Comando | Descripción |
| --- | --- |
| `/projects [filtro]` | Lista proyectos de `TRY_PATH`, opcionalmente filtrados. |
| `/use <nombre>` | Selecciona un proyecto por nombre. |
| `/try new <nombre>` | Crea un directorio de trabajo vacío con `try`. |
| `/try clone <url> [nombre]` | Clona un repositorio con `try clone`. |
| `/try worktree <nombre>` | Crea un worktree desde el proyecto actual. |
| `/clone <url> [nombre]` | Alias directo de `try clone`. |
| `/worktree <nombre>` | Alias directo de `try worktree`. |
| `/ls [ruta]` | Lista archivos y directorios del proyecto. |
| `/find <texto>` | Busca archivos por nombre o ruta. |
| `/read <ruta>` | Muestra un archivo de texto. Si es grande, lo envía como documento. |
| `/diff` | Muestra el estado y el diff de git. Los diffs grandes se envían como archivo. |
| `/todo` | Muestra las tareas de la sesión activa. |

`try worktree` y `/worktree` requieren que el proyecto actual sea un repositorio git. Los nombres de `try` no pueden contener rutas ni empezar por `-`.

### Sesiones

| Comando | Descripción |
| --- | --- |
| `/new [título]` | Crea una sesión nueva en el proyecto actual. |
| `/sessions` | Lista las sesiones y permite cambiar o borrar. |
| `/switch <id\|título>` | Cambia a una sesión por ID, prefijo de ID o título. |
| `/rename <título>` | Renombra la sesión activa. |
| `/delete` | Pide confirmación y borra la sesión activa. |
| `/abort` | Aborta la respuesta o ejecución en curso. |
| `/compact` | Compacta la sesión activa. |
| `/status` | Muestra proyecto, sesión, agente, modelo, coste, tokens y si hay una ejecución o terminal activa. |
| `/thinking [on\|off]` | Activa o desactiva la visualización del razonamiento; sin argumento la alterna. |

Mientras hay una respuesta en curso, no puedes cambiar de proyecto, crear o cambiar de sesión activa ni abrir o cambiar la terminal. Usa `/abort` primero.

### Agentes y modelos

| Comando | Descripción |
| --- | --- |
| `/agent` | Lista los agentes principales disponibles. |
| `/plan` | Cambia al agente `plan`. |
| `/build` | Cambia al agente `build`. |
| `/tab` | Cicla al siguiente agente principal, como `Tab` en opencode. |
| `/model` | Muestra los proveedores de modelos. |
| `/model <texto>` | Busca un modelo por ID o nombre. |
| `/model <provider/model>` | Selecciona un modelo concreto. |
| `/model reset` | Vuelve al modelo por defecto. |
| `/models [provider]` | Lista modelos de un proveedor o muestra los proveedores. |

### Control y terminal

| Comando | Descripción |
| --- | --- |
| `/p` o `/palette` | Abre la command palette. |
| `/cmd <nombre> [args]` | Ejecuta un slash command de opencode. Sin argumentos muestra un teclado con los comandos disponibles. |
| `/sh <comando>` | Ejecuta un comando de shell con el agente activo y los permisos de opencode. |
| `/exec <comando>` | Alias de `/sh`. |
| `/say <texto>` | Envía un texto al agente, equivalente a un mensaje normal. |
| `/term` | Abre una terminal PTY en el proyecto actual. |
| `/term close` o `/exit` | Cierra la terminal. |
| `/key <tecla>` | Envía una tecla a la terminal. |
| `/ctrl-c` | Envía `Ctrl+C` a la terminal. |
| `/ctrl-d` | Envía `Ctrl+D` a la terminal. |
| `/help` | Muestra la ayuda del bot. |

Teclas disponibles en `/key`: `ctrl-c`, `ctrl-d`, `ctrl-z`, `tab`, `esc`, `enter`, `up`, `down`, `left`, `right`.

La terminal usa `$SHELL` si existe y no es bash; en caso contrario usa `bash`. Mientras esté abierta, los mensajes de texto normales se escriben en la PTY. Los comandos del bot que empiezan por `/` siguen funcionando como comandos de Telegram. Los botones de la terminal permiten enviar `Ctrl+C`, `Ctrl+D` y cerrarla.

## Seguridad

Este bot puede ejecutar comandos de shell y abrir terminales en los proyectos. Ejecútalo con un usuario del sistema con los permisos mínimos necesarios.

- Mantén `TELEGRAM_ALLOWED_USERS` restringido a tus IDs.
- No publiques el token del bot ni el archivo `.env`; si es posible, aplica `chmod 600 .env`.
- No expongas el servidor opencode a Internet sin autenticación.
- Si usas una red no confiable, protege opencode con `OPENCODE_SERVER_PASSWORD` y un usuario adecuado.
- El archivo `state.json` contiene rutas de proyectos, IDs de sesiones y preferencias. Protégelo con permisos razonables.
- Los permisos que opencode solicita se reenvían a Telegram; revisa el comando antes de aprobarlo.
- `try` ejecuta el script que genera el binario `try`. El bot valida que el directorio creado quede dentro de `TRY_PATH`, pero conviene usar una versión confiable de `try`.

## Estado y persistencia

Por defecto el estado se guarda en:

```text
~/.local/state/opencode-telegram/state.json
```

o en `$XDG_STATE_HOME/opencode-telegram/state.json` si `XDG_STATE_HOME` está definido.

Se guarda por chat:

- Proyecto activo.
- Sesión activa por proyecto.
- Agente y modelo seleccionados.
- Preferencia de razonamiento visible.

Borrar el archivo de estado no borra las sesiones de opencode; solo reinicia la selección del bot. Las sesiones viven en el servidor opencode.

## Arquitectura

- `src/index.ts` carga la configuración, levanta el servidor opencode, crea los servicios, arranca los eventos, inicia el bot y gestiona el apagado ordenado.
- `src/opencode/` contiene el cliente de opencode, el servidor gestionado, el stream de eventos SSE y el puente de permisos.
- `src/projects/` descubre proyectos y ejecuta `try` de forma segura.
- `src/chat/` gestiona los turnos, el streaming y el renderizado de mensajes.
- `src/telegram/` contiene la conversión Markdown/HTML, los botones inline y los tokens de callback.
- `src/terminal/` implementa la terminal PTY por WebSocket.
- `src/commands/` registra los comandos de Telegram y las vistas.
- `src/state.ts` persiste el estado por chat.

El bot usa un único servidor opencode compartido. Cada operación se envía con el `directory` del proyecto correspondiente, de modo que opencode mantiene el contexto por proyecto.

## Desarrollo

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Arranca en modo desarrollo con `tsx`. |
| `npm run build` | Compila TypeScript a `dist/`. |
| `npm start` | Ejecuta `dist/index.js`. |
| `npm run typecheck` | Comprueba tipos sin emitir archivos. |
| `npm run lint` | Ejecuta Biome sobre `src`, `tests` y `scripts`. |
| `npm run lint:fix` | Aplica correcciones seguras de Biome. |
| `npm test` | Ejecuta la suite de Vitest. |
| `npm run test:watch` | Ejecuta Vitest en modo watch. |
| `npm run smoke` | Comprueba el servidor y la API de opencode. |

En NixOS, el binario local de Biome de `node_modules` puede no ser ejecutable. `npm run lint` usa `scripts/biome.sh`, que detecta ese caso y ejecuta `nix run nixpkgs#biome`.

## Despliegue con systemd

En NixOS se recomienda un servicio de sistema ejecutado como el usuario dueño
de la sesión de opencode (no como root). Ejemplo con `systemd.services`:

```nix
systemd.services.opencode-telegram = {
  wantedBy = [ "multi-user.target" ];
  wants = [ "network-online.target" ];
  after = [ "network-online.target" ];
  path = [
    pkgs.nodejs_22
    pkgs.git
    pkgs.bash
    pkgs.coreutils
    pkgs.opencode
    pkgs.try
  ];
  environment = {
    HOME = "/home/miguehm";
    NODE_ENV = "production";
  };
  serviceConfig = {
    Type = "simple";
    User = "miguehm";
    Group = "users";
    WorkingDirectory = "/home/miguehm/src/opencode-telegram";
    EnvironmentFile = "/etc/opencode-telegram.env";
    ExecStart = "${pkgs.nodejs_22}/bin/node dist/index.js";
    Restart = "always";
    RestartSec = 5;
    TimeoutStopSec = 30;
    KillSignal = "SIGTERM";
    NoNewPrivileges = true;
  };
};
```

Ajusta `pkgs.opencode` y `pkgs.try` a los paquetes reales de tu instalación;
en este servidor son `opencodePinned` (nixpkgs pinneado) y `tryPkg` (flake
`tobi/try`).

Unidad equivalente si no usas NixOS:

```ini
[Unit]
Description=opencode Telegram bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=miguehm
Group=users
WorkingDirectory=/home/miguehm/src/opencode-telegram
Environment=HOME=/home/miguehm
Environment=NODE_ENV=production
EnvironmentFile=/etc/opencode-telegram.env
Environment=PATH=/run/current-system/sw/bin
ExecStart=/run/current-system/sw/bin/node dist/index.js
Restart=always
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Antes de activarlo:

```bash
cd /home/miguehm/src/opencode-telegram
npm ci
npm run build
sudo install -m 600 /dev/null /etc/opencode-telegram.env
sudoedit /etc/opencode-telegram.env   # TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS, TRY_PATH...
sudo nixos-rebuild switch --flake /etc/nixos-flake#nixos-laptop-1
systemctl status opencode-telegram --no-pager
journalctl -u opencode-telegram -f
```

Contenido mínimo de `/etc/opencode-telegram.env`:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USERS=TU_ID
TRY_PATH=/home/miguehm/src/tries
TRY_BIN=try
OPENCODE_HOST=127.0.0.1
OPENCODE_PORT=4096
STATE_DIR=/home/miguehm/.local/state/opencode-telegram
LOG_LEVEL=info
```

Consideraciones para NixOS:

- No se asume que exista `/bin/bash`. El bot invoca `bash` desde `PATH`, así que el servicio debe tener bash disponible.
- Asegúrate de que Node, `opencode`, `try`, `git` y bash estén en el `PATH` del servicio.
- `try` puede requerir instalación propia si no está en los paquetes del sistema.
- El servidor opencode gestionado se inicia como hijo del bot y se detiene al apagar el servicio.
- En este servidor el flake `nixos-server` declara el servicio en
  `modules/services/opencode-telegram.nix`; se actualiza con
  `./scripts/deploy-opencode-telegram.sh` (`git pull`, `npm ci`, build y restart).

## Solución de problemas

### `Invalid configuration`

Falta `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS` o alguno de los valores no es válido. Revisa `.env` en desarrollo o `/etc/opencode-telegram.env` si corre como servicio systemd.

### El bot no responde

Comprueba que tu ID numérico esté en `TELEGRAM_ALLOWED_USERS`. El bot rechaza a usuarios no autorizados y también responde a sus callbacks con `No autorizado`.

### `opencode server at ... did not become healthy`

`opencode` no está en `PATH`, el puerto está ocupado o el servidor externo no responde. Prueba:

```bash
opencode --version
curl http://127.0.0.1:4096/global/health
```

También puedes arrancar opencode aparte y definir `OPENCODE_URL`.

### `try falló` o no se crea el proyecto

Comprueba que `TRY_BIN` apunte al binario correcto y que `try`, `git` y `bash` estén en `PATH`. Verifica que el destino quede dentro de `TRY_PATH`.

### Error al ejecutar `/worktree`

El proyecto actual debe ser un repositorio git y debe tener commits o una rama válida para crear el worktree. Revisa la salida del error y el estado con `/status`.

### La terminal no responde

Abre `/term` con un proyecto seleccionado. Si el shell no arranca, comprueba que `$SHELL` o `bash` existan en el servidor. Usa `/exit` para cerrar la terminal antes de cambiar de proyecto.

### Los botones dicen que caducaron

Los tokens de los botones inline caducan a los 15 minutos. Vuelve a abrir el menú con `/p`.

### Error de lint en NixOS

El wrapper `scripts/biome.sh` usa `nix run nixpkgs#biome` cuando el binario local no se puede ejecutar. Si el problema continúa, revisa que Nix esté disponible y que el canal `nixpkgs` tenga Biome.

## Estructura del proyecto

```text
src/
  bot.ts                 registro y autorización del bot
  config.ts              carga y validación del entorno
  index.ts               arranque y apagado ordenado
  state.ts               estado persistente por chat
  chat/                  turnos y renderizado de conversaciones
  commands/              comandos, vistas y command palette
  opencode/              servidor, API, eventos y permisos
  projects/              descubrimiento de proyectos e integración con try
  telegram/              Markdown/HTML, callbacks y streaming
  terminal/              terminal PTY
scripts/
  smoke.ts               comprobación de humo
  biome.sh               wrapper de Biome para NixOS
tests/                   pruebas con Vitest
```
