import type { Bot } from "grammy"

export const BOT_COMMANDS = [
  { command: "p", description: "Command palette (equivalente a Ctrl+P)" },
  { command: "projects", description: "Listar proyectos en TRY_PATH" },
  { command: "use", description: "Seleccionar proyecto por nombre" },
  { command: "try", description: "Crear try: new, clone o worktree" },
  { command: "clone", description: "Clonar repo con try clone" },
  { command: "worktree", description: "Crear worktree con try worktree" },
  { command: "new", description: "Nueva sesión de opencode" },
  { command: "sessions", description: "Listar y cambiar sesiones" },
  { command: "agent", description: "Elegir agente (build/plan)" },
  { command: "plan", description: "Cambiar al agente plan" },
  { command: "build", description: "Cambiar al agente build" },
  { command: "tab", description: "Ciclar agente como Tab" },
  { command: "model", description: "Elegir modelo" },
  { command: "sh", description: "Ejecutar comando de shell" },
  { command: "term", description: "Abrir o cerrar terminal PTY" },
  { command: "cmd", description: "Ejecutar slash command de opencode" },
  { command: "status", description: "Estado del proyecto y sesión" },
  { command: "help", description: "Mostrar ayuda" },
]

export const HELP_HTML = `<b>🤖 opencode Telegram bot</b>

<b>Proyectos</b>
<code>/projects</code> — listar proyectos en TRY_PATH
<code>/use &lt;nombre&gt;</code> — seleccionar proyecto
<code>/try new &lt;nombre&gt;</code> — crear try vacío
<code>/try clone &lt;url&gt; [nombre]</code> — clonar repo con try
<code>/try worktree &lt;nombre&gt;</code> — worktree desde el proyecto actual
<code>/ls [ruta]</code> · <code>/find &lt;texto&gt;</code> · <code>/read &lt;ruta&gt;</code> — explorar archivos
<code>/diff</code> · <code>/todo</code> — cambios y tareas de la sesión

<b>Sesiones</b>
<code>/new [título]</code> · <code>/sessions</code> · <code>/switch &lt;id|título&gt;</code>
<code>/rename &lt;título&gt;</code> · <code>/delete</code> · <code>/abort</code> · <code>/compact</code>
<code>/status</code> — proyecto, sesión, agente, modelo y coste

<b>Agente y modelo</b>
<code>/agent</code> · <code>/plan</code> · <code>/build</code> · <code>/tab</code>
<code>/model</code> · <code>/model &lt;provider/model&gt;</code> · <code>/thinking on|off</code>

<b>Control</b>
<code>/p</code> — command palette (equivalente a Ctrl+P)
<code>/cmd &lt;nombre&gt; [args]</code> — slash command de opencode
<code>/sh &lt;comando&gt;</code> — shell con permisos de opencode
<code>/term</code> — terminal PTY interactiva; <code>/exit</code> para cerrar
<code>/key &lt;ctrl-c|ctrl-d|tab|esc|up|down|enter&gt;</code> — enviar tecla

<b>Uso normal</b>
Escribe un mensaje sin <code>/</code> para enviarlo al agente activo.`

export function registerHelp(bot: Bot): void {
  bot.command(["start", "help"], async (ctx) => {
    await ctx.reply(HELP_HTML, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
  })
}
