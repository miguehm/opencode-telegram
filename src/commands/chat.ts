import type { Bot } from "grammy"
import type { App } from "../app.js"
import { escapeHtml } from "../telegram/render.js"
import { truncate } from "../util/text.js"
import {
  chatIdOf,
  commandArg,
  currentSession,
  errorMessage,
  projectName,
  replyMarkdown,
  replyView,
} from "./shared.js"
import { sessionsView, statusView } from "./views.js"

export function registerChat(bot: Bot, app: App): void {
  bot.command("new", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    if (app.turns.isBusy(chatId)) {
      await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` primero.")
      return
    }
    try {
      const title = commandArg(ctx) || `${projectName(chat.projectDir)} · nueva sesión`
      const session = await app.opencode.createSession(chat.projectDir, title)
      app.state.update(chatId, (state) => {
        state.sessions[chat.projectDir as string] = session.id
      })
      await replyMarkdown(ctx, `🗂️ Nueva sesión: \`${session.id.slice(0, 12)}\`\n${session.title}`)
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("sessions", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    try {
      await replyView(ctx, await sessionsView(app, chatId, chat.projectDir))
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("switch", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    const query = commandArg(ctx).toLowerCase()
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    if (!query) {
      await replyMarkdown(ctx, "Uso: `/switch <id|título>`")
      return
    }
    if (app.turns.isBusy(chatId)) {
      await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` primero.")
      return
    }
    try {
      const sessions = await app.opencode.listSessions(chat.projectDir)
      const match =
        sessions.find((session) => session.id === query) ??
        sessions.find((session) => session.id.startsWith(query)) ??
        sessions.find((session) => session.title.toLowerCase().includes(query))
      if (!match) {
        await replyMarkdown(ctx, "No encontré esa sesión. Prueba `/sessions`.")
        return
      }
      app.state.update(chatId, (state) => {
        state.sessions[chat.projectDir as string] = match.id
      })
      await replyMarkdown(ctx, `✅ Sesión: ${truncate(match.title, 120)}`)
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("rename", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    const title = commandArg(ctx)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    if (!title) {
      await replyMarkdown(ctx, "Uso: `/rename <título>`")
      return
    }
    try {
      const session = await currentSession(app, chatId, chat.projectDir)
      if (!session) {
        await replyMarkdown(ctx, "No hay sesión activa. Usa `/new`.")
        return
      }
      await app.opencode.renameSession(chat.projectDir, session.id, title)
      await replyMarkdown(ctx, `✅ Renombrada: ${title}`)
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("delete", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    try {
      const session = await currentSession(app, chatId, chat.projectDir)
      if (!session) {
        await replyMarkdown(ctx, "No hay sesión activa.")
        return
      }
      const keyboard = app.callbacks.keyboard(chatId, [
        [
          {
            text: "🗑 Sí, borrar",
            payload: { kind: "sessionDelete", id: session.id, dir: chat.projectDir },
          },
          { text: "Cancelar", payload: { kind: "palette", action: "sessions" } },
        ],
      ])
      await ctx.reply(
        `¿Borrar la sesión \`${session.id.slice(0, 12)}\` (${escapeHtml(truncate(session.title, 80))})?`,
        { parse_mode: "HTML", reply_markup: keyboard },
      )
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("abort", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    try {
      if (app.turns.isBusy(chatId)) {
        await app.turns.abort(chatId)
        await replyMarkdown(ctx, "⛔ Respuesta abortada.")
        return
      }
      if (chat.projectDir) {
        const session = await currentSession(app, chatId, chat.projectDir)
        if (session) await app.opencode.abortSession(chat.projectDir, session.id)
      }
      await replyMarkdown(ctx, "No hay nada en ejecución.")
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("compact", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    if (app.turns.isBusy(chatId)) {
      await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` primero.")
      return
    }
    try {
      const session = await currentSession(app, chatId, chat.projectDir)
      if (!session) {
        await replyMarkdown(ctx, "No hay sesión activa. Usa `/new`.")
        return
      }
      await replyMarkdown(ctx, "🗜️ Compactando la sesión…")
      await app.opencode.summarizeSession(chat.projectDir, session.id)
      await replyMarkdown(ctx, "✅ Sesión compactada.")
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("status", async (ctx) => {
    const chatId = chatIdOf(ctx)
    await replyView(ctx, await statusView(app, chatId))
  })

  bot.command("thinking", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const value = commandArg(ctx).toLowerCase()
    const chat = app.state.get(chatId)
    const next = value === "on" ? true : value === "off" ? false : !chat.thinking
    app.state.update(chatId, (state) => {
      state.thinking = next
    })
    await replyMarkdown(ctx, `Razonamiento visible: **${next ? "sí" : "no"}**`)
  })
}
