import type { Bot, Context } from "grammy"
import type { App } from "../app.js"
import { HELP_HTML } from "./help.js"
import { showDiff, showTodo } from "./projects.js"
import {
  chatIdOf,
  currentSession,
  editView,
  errorMessage,
  replyMarkdown,
  replyView,
} from "./shared.js"
import { openTerminal } from "./terminal.js"
import {
  agentsView,
  commandsView,
  paletteView,
  projectsView,
  providersView,
  sessionsView,
  statusView,
} from "./views.js"

async function requireProjectDir(app: App, ctx: Context): Promise<string | undefined> {
  const chatId = chatIdOf(ctx)
  const project = app.state.get(chatId).projectDir
  if (!project) {
    await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
    return undefined
  }
  return project
}

export async function runPaletteAction(app: App, ctx: Context, action: string): Promise<void> {
  const chatId = chatIdOf(ctx)

  if (action === "help") {
    await ctx.reply(HELP_HTML, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
    return
  }
  if (action === "projects") {
    await editView(ctx, await projectsView(app, chatId))
    return
  }
  if (action === "new_session") {
    const project = await requireProjectDir(app, ctx)
    if (!project) return
    if (app.turns.isBusy(chatId)) {
      await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` primero.")
      return
    }
    const session = await app.opencode.createSession(project, `tg ${new Date().toISOString()}`)
    app.state.update(chatId, (state) => {
      state.sessions[project] = session.id
    })
    await editView(ctx, {
      text: `🗂️ Nueva sesión: \`${session.id.slice(0, 12)}\`\n${session.title}`,
    })
    return
  }
  if (action === "sessions") {
    const project = await requireProjectDir(app, ctx)
    if (project) await editView(ctx, await sessionsView(app, chatId, project))
    return
  }
  if (action === "agents") {
    const project = await requireProjectDir(app, ctx)
    if (project) await editView(ctx, await agentsView(app, chatId, project))
    return
  }
  if (action === "models") {
    const project = await requireProjectDir(app, ctx)
    if (project) await editView(ctx, await providersView(app, chatId, project))
    return
  }
  if (action === "commands") {
    const project = await requireProjectDir(app, ctx)
    if (project) await editView(ctx, await commandsView(app, chatId, project))
    return
  }
  if (action === "diff") {
    await showDiff(ctx, app)
    return
  }
  if (action === "todo") {
    await showTodo(ctx, app)
    return
  }
  if (action === "status") {
    await editView(ctx, await statusView(app, chatId))
    return
  }
  if (action === "terminal") {
    await openTerminal(ctx, app)
    return
  }
  if (action === "abort") {
    const project = app.state.get(chatId).projectDir
    try {
      if (app.turns.isBusy(chatId)) {
        await app.turns.abort(chatId)
      } else if (project) {
        const session = await currentSession(app, chatId, project)
        if (session) await app.opencode.abortSession(project, session.id)
      }
      await editView(ctx, { text: "⛔ Ejecución abortada." })
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
    return
  }
  if (action === "compact") {
    const project = await requireProjectDir(app, ctx)
    if (!project) return
    try {
      const session = await currentSession(app, chatId, project)
      if (!session) {
        await replyMarkdown(ctx, "No hay sesión activa. Usa `/new`.")
        return
      }
      await editView(ctx, { text: "🗜️ Compactando la sesión…" })
      await app.opencode.summarizeSession(project, session.id)
      await editView(ctx, { text: "✅ Sesión compactada." })
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
    return
  }
  if (action === "cmd_hint") {
    await editView(ctx, {
      text: "Usa `/cmd <nombre> [argumentos]`.\nPor ejemplo: `/cmd init` o `/cmd review src/index.ts`.",
    })
    return
  }
  if (action === "model_provider") {
    const project = await requireProjectDir(app, ctx)
    if (project) await editView(ctx, await providersView(app, chatId, project))
    return
  }

  await editView(ctx, paletteView(app, chatId))
}

export function registerPalette(bot: Bot, app: App): void {
  bot.command(["p", "palette"], async (ctx) => {
    await replyView(ctx, paletteView(app, chatIdOf(ctx)))
  })
}
