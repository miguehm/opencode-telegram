import type { InlineKeyboardMarkup } from "grammy/types"
import type { App } from "../app.js"
import type { ButtonSpec } from "../telegram/callbacks.js"
import { displayPath } from "../util/paths.js"
import { relativeAge, truncate } from "../util/text.js"

export type View = {
  text: string
  keyboard?: InlineKeyboardMarkup
}

function providerName(id: string, name?: string): string {
  return name || id
}

export async function projectsView(app: App, chatId: number, query = ""): Promise<View> {
  const chat = app.state.get(chatId)
  const entries = query ? await app.projects.find(query) : await app.projects.list()
  const limited = entries.slice(0, 20)

  const lines = [
    `📁 **Proyectos en** \`${displayPath(app.projects.root)}\``,
    query ? `Filtro: \`${query}\`` : "",
    chat.projectDir ? `Actual: \`${displayPath(chat.projectDir)}\`` : "",
    "",
  ].filter(Boolean)

  if (limited.length === 0) {
    lines.push("_No hay proyectos que coincidan._")
  }

  for (const entry of limited) {
    const current = chat.projectDir === entry.dir ? "✅ " : ""
    const git = entry.git ? ` · \`${entry.git.branch}\`${entry.git.dirty ? " ●" : ""}` : ""
    lines.push(`${current}${entry.name}${git} · ${relativeAge(entry.mtime)}`)
  }

  const rows = limited.map((entry) => [
    {
      text: `${chat.projectDir === entry.dir ? "✅ " : ""}${truncate(entry.name, 40)}`,
      payload: { kind: "project", dir: entry.dir },
    },
  ])

  return {
    text: lines.join("\n"),
    ...(rows.length > 0 ? { keyboard: app.callbacks.keyboard(chatId, rows) } : {}),
  }
}

export async function agentsView(app: App, chatId: number, dir: string): Promise<View> {
  const chat = app.state.get(chatId)
  const agents = await app.opencode.agents(dir)
  const primary = agents.filter((agent) => agent.mode !== "subagent")
  const lines = [
    "🧭 **Agentes disponibles**",
    `Actual: **${chat.agent}**`,
    "",
    ...primary.map((agent) => {
      const mark = agent.name === chat.agent ? "✅ " : ""
      const description = agent.description ? ` — ${truncate(agent.description, 80)}` : ""
      return `${mark}\`${agent.name}\`${description}`
    }),
  ]
  const rows = primary.map((agent) => [
    {
      text: `${agent.name === chat.agent ? "✅ " : ""}${truncate(agent.name, 40)}`,
      payload: { kind: "agent", name: agent.name },
    },
  ])
  return {
    text: lines.join("\n"),
    ...(rows.length ? { keyboard: app.callbacks.keyboard(chatId, rows) } : {}),
  }
}

export async function sessionsView(app: App, chatId: number, dir: string): Promise<View> {
  const chat = app.state.get(chatId)
  const sessions = await app.opencode.listSessions(dir)
  const current = chat.sessions[dir]
  const sorted = [...sessions]
    .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0))
    .slice(0, 12)

  const lines = [
    "🗂️ **Sesiones**",
    current ? `Actual: \`${current.slice(0, 12)}\`` : "Sin sesión activa",
    "",
  ]
  if (sorted.length === 0) lines.push("_No hay sesiones._")
  for (const session of sorted) {
    const mark = session.id === current ? "✅ " : ""
    lines.push(`${mark}${truncate(session.title, 60)} · ${relativeAge(session.time?.updated ?? 0)}`)
  }

  const rows: ButtonSpec[][] = []
  rows.push([{ text: "➕ Nueva sesión", payload: { kind: "palette", action: "new_session" } }])
  for (const session of sorted) {
    rows.push([
      {
        text: `${session.id === current ? "✅ " : ""}${truncate(session.title, 32)}`,
        payload: { kind: "session", id: session.id, dir },
      },
      { text: "🗑", payload: { kind: "sessionDelete", id: session.id, dir } },
    ])
  }
  return { text: lines.join("\n"), keyboard: app.callbacks.keyboard(chatId, rows) }
}

export async function providersView(app: App, chatId: number, dir: string): Promise<View> {
  const chat = app.state.get(chatId)
  const providers = await app.opencode.providers(dir)
  const current = chat.model ? `${chat.model.providerID}/${chat.model.modelID}` : "default"
  const list = providers.providers.slice(0, 20)
  const lines = ["🧠 **Modelos**", `Actual: \`${current}\``, "", "Elige un proveedor:"]
  const rows = list.map((provider) => [
    {
      text: truncate(providerName(provider.id, provider.name), 40),
      payload: { kind: "modelProvider", providerID: provider.id, dir },
    },
  ])
  return {
    text: lines.join("\n"),
    ...(rows.length ? { keyboard: app.callbacks.keyboard(chatId, rows) } : {}),
  }
}

export async function modelsView(
  app: App,
  chatId: number,
  dir: string,
  providerID: string,
): Promise<View> {
  const chat = app.state.get(chatId)
  const providers = await app.opencode.providers(dir)
  const provider = providers.providers.find((item) => item.id === providerID)
  if (!provider) return { text: `Proveedor desconocido: \`${providerID}\`` }
  const models = Object.values(provider.models ?? {}).slice(0, 40)
  const current = chat.model
  const lines = [
    `🧠 **${providerName(provider.id, provider.name)}**`,
    current ? `Actual: \`${current.providerID}/${current.modelID}\`` : "Actual: default",
    "",
  ]
  for (const model of models) {
    const mark = current?.providerID === provider.id && current.modelID === model.id ? "✅ " : ""
    lines.push(`${mark}${model.name || model.id}`)
  }
  const rows = models.map((model) => [
    {
      text: `${current?.providerID === provider.id && current.modelID === model.id ? "✅ " : ""}${truncate(model.name || model.id, 40)}`,
      payload: { kind: "model", providerID: provider.id, modelID: model.id },
    },
  ])
  return {
    text: lines.join("\n"),
    ...(rows.length ? { keyboard: app.callbacks.keyboard(chatId, rows) } : {}),
  }
}

export async function commandsView(app: App, chatId: number, dir: string): Promise<View> {
  const commands = await app.opencode.commands(dir)
  const lines = [
    "⌘ **Comandos de opencode**",
    "Pulsa uno para ejecutarlo o usa `/cmd nombre argumentos`.",
    "",
  ]
  for (const command of commands.slice(0, 30)) {
    lines.push(`\`/${command.name}\` — ${truncate(command.description ?? "", 80)}`)
  }
  const rows: ButtonSpec[][] = commands.slice(0, 30).map((command) => [
    {
      text: `/${truncate(command.name, 36)}`,
      payload: { kind: "command", name: command.name },
    },
  ])
  rows.push([{ text: "✏️ Escribir argumentos", payload: { kind: "palette", action: "cmd_hint" } }])
  return { text: lines.join("\n"), keyboard: app.callbacks.keyboard(chatId, rows) }
}

export function paletteView(app: App, chatId: number): View {
  const rows = [
    [
      { text: "➕ Nueva sesión", payload: { kind: "palette", action: "new_session" } },
      { text: "🗂️ Sesiones", payload: { kind: "palette", action: "sessions" } },
    ],
    [
      { text: "📁 Proyectos", payload: { kind: "palette", action: "projects" } },
      { text: "🧭 Agentes", payload: { kind: "palette", action: "agents" } },
    ],
    [
      { text: "🧠 Modelos", payload: { kind: "palette", action: "models" } },
      { text: "⌘ Comandos", payload: { kind: "palette", action: "commands" } },
    ],
    [
      { text: "📝 Diff", payload: { kind: "palette", action: "diff" } },
      { text: "✅ Todo", payload: { kind: "palette", action: "todo" } },
    ],
    [
      { text: "🗜️ Compactar", payload: { kind: "palette", action: "compact" } },
      { text: "⛔ Abortar", payload: { kind: "palette", action: "abort" } },
    ],
    [
      { text: "📊 Estado", payload: { kind: "palette", action: "status" } },
      { text: "🖥️ Terminal", payload: { kind: "palette", action: "terminal" } },
    ],
    [{ text: "❓ Ayuda", payload: { kind: "palette", action: "help" } }],
  ]

  return {
    text: [
      "⌨️ **Command palette** _(equivalente a Ctrl+P)_",
      "Selecciona una acción:",
      "",
      "También puedes usar `/p` en cualquier momento.",
    ].join("\n"),
    keyboard: app.callbacks.keyboard(chatId, rows),
  }
}

export async function statusView(app: App, chatId: number): Promise<View> {
  const chat = app.state.get(chatId)
  const lines = ["📊 **Estado**"]

  if (!chat.projectDir) {
    lines.push("Proyecto: _sin seleccionar_ (usa `/projects`)")
  } else {
    const git = await app.projects.info(chat.projectDir)
    const gitText = git ? ` · \`${git.branch}\`${git.dirty ? " ●" : ""}` : ""
    lines.push(`Proyecto: \`${displayPath(chat.projectDir)}\`${gitText}`)
  }

  lines.push(`Agente: \`${chat.agent}\``)
  lines.push(
    `Modelo: \`${chat.model ? `${chat.model.providerID}/${chat.model.modelID}` : "default"}\``,
  )
  lines.push(`Razonamiento visible: ${chat.thinking ? "sí" : "no"}`)

  if (chat.projectDir) {
    const sessionId = chat.sessions[chat.projectDir]
    if (!sessionId) {
      lines.push("Sesión: _sin crear_")
    } else {
      lines.push(`Sesión: \`${sessionId.slice(0, 12)}\``)
      try {
        const session = await app.opencode.getSession(chat.projectDir, sessionId)
        lines.push(`Título: ${session.title}`)
        if (session.cost !== undefined) lines.push(`Coste: $${session.cost.toFixed(4)}`)
        if (session.tokens) {
          lines.push(
            `Tokens: ${session.tokens.input} in · ${session.tokens.output} out · ${session.tokens.reasoning} reasoning`,
          )
        }
      } catch {
        lines.push("_La sesión ya no existe en el servidor._")
      }
    }
  }

  lines.push(`Ocupado: ${app.turns.isBusy(chatId) ? "sí" : "no"}`)
  const terminal = app.terminal.get(chatId)
  if (terminal) lines.push(`Terminal: abierta en \`${displayPath(terminal.directory)}\``)

  return { text: lines.join("\n") }
}
