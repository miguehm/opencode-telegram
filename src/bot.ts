import { autoRetry } from "@grammyjs/auto-retry"
import type { Bot } from "grammy"
import type { App } from "./app.js"
import { BOT_COMMANDS } from "./commands/help.js"
import { registerCommands } from "./commands/index.js"
import { runCommand, sendPrompt } from "./commands/opencode.js"
import { runPaletteAction } from "./commands/palette.js"
import { activateProject } from "./commands/projects.js"
import { chatIdOf, editView, errorMessage, replyMarkdown } from "./commands/shared.js"
import { agentsView, modelsView, sessionsView } from "./commands/views.js"
import { escapeHtml } from "./telegram/render.js"

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export async function setupBot(bot: Bot, app: App): Promise<Bot> {
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 10 }))

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id
    if (!userId || !app.config.allowedUsers.has(userId)) {
      if (ctx.chat) {
        await ctx.reply("⛔ No estás autorizado para usar este bot.").catch(() => undefined)
      }
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: "No autorizado" }).catch(() => undefined)
      }
      return
    }
    await next()
  })

  await register(bot, app)

  bot.catch((error) => {
    app.logger.error("bot handler failed", error.error)
  })

  try {
    await bot.api.setMyCommands(BOT_COMMANDS)
  } catch (error) {
    app.logger.warn("could not set bot commands", error)
  }

  return bot
}

async function register(bot: Bot, app: App): Promise<void> {
  registerCommands(bot, app)

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data
    if (!data.startsWith("cb:")) {
      await ctx.answerCallbackQuery().catch(() => undefined)
      return
    }
    const chatId = chatIdOf(ctx)
    const payload = app.callbacks.take(chatId, data.slice(3))
    if (!payload) {
      await ctx
        .answerCallbackQuery({ text: "Botón caducado. Vuelve a abrir el menú con /p." })
        .catch(() => undefined)
      return
    }

    try {
      switch (payload.kind) {
        case "project": {
          const dir = text(payload.dir)
          if (!dir) throw new Error("Proyecto inválido")
          if (app.turns.isBusy(chatId)) {
            await ctx.answerCallbackQuery({ text: "Hay una respuesta en curso. Usa /abort." })
            return
          }
          await ctx.answerCallbackQuery({ text: "Activando proyecto…" }).catch(() => undefined)
          const summary = await activateProject(app, chatId, dir)
          await editView(ctx, { text: summary })
          return
        }
        case "session": {
          const dir = text(payload.dir)
          const id = text(payload.id)
          if (!dir || !id) throw new Error("Sesión inválida")
          if (app.turns.isBusy(chatId)) {
            await ctx.answerCallbackQuery({ text: "Hay una respuesta en curso. Usa /abort." })
            return
          }
          const session = await app.opencode.getSession(dir, id)
          app.state.update(chatId, (state) => {
            state.projectDir = dir
            state.sessions[dir] = id
          })
          await ctx.answerCallbackQuery({ text: "Sesión activada" }).catch(() => undefined)
          await editView(ctx, { text: `✅ Sesión: ${escapeHtml(session.title)}` })
          return
        }
        case "sessionDelete": {
          const dir = text(payload.dir)
          const id = text(payload.id)
          if (!dir || !id) throw new Error("Sesión inválida")
          if (app.turns.isBusy(chatId)) {
            await ctx.answerCallbackQuery({ text: "Hay una respuesta en curso. Usa /abort." })
            return
          }
          await app.opencode.deleteSession(dir, id)
          app.state.update(chatId, (state) => {
            if (state.sessions[dir] === id) delete state.sessions[dir]
          })
          await ctx.answerCallbackQuery({ text: "Sesión borrada" }).catch(() => undefined)
          await editView(ctx, await sessionsView(app, chatId, dir))
          return
        }
        case "agent": {
          const name = text(payload.name)
          if (!name) throw new Error("Agente inválido")
          const project = app.state.get(chatId).projectDir
          if (!project) throw new Error("Selecciona un proyecto primero")
          app.state.update(chatId, (state) => {
            state.agent = name
          })
          await ctx.answerCallbackQuery({ text: `Agente: ${name}` }).catch(() => undefined)
          await editView(ctx, await agentsView(app, chatId, project))
          return
        }
        case "modelProvider": {
          const dir = text(payload.dir)
          const providerID = text(payload.providerID)
          if (!dir || !providerID) throw new Error("Modelo inválido")
          await ctx.answerCallbackQuery().catch(() => undefined)
          await editView(ctx, await modelsView(app, chatId, dir, providerID))
          return
        }
        case "model": {
          const providerID = text(payload.providerID)
          const modelID = text(payload.modelID)
          if (!providerID || !modelID) throw new Error("Modelo inválido")
          app.state.update(chatId, (state) => {
            state.model = { providerID, modelID }
          })
          await ctx.answerCallbackQuery({ text: `Modelo: ${modelID}` }).catch(() => undefined)
          await editView(ctx, {
            text: `🧠 Modelo: \`${escapeHtml(providerID)}/${escapeHtml(modelID)}\``,
          })
          return
        }
        case "command": {
          const name = text(payload.name)
          if (!name) throw new Error("Comando inválido")
          await ctx.answerCallbackQuery({ text: `Ejecutando /${name}` }).catch(() => undefined)
          await runCommand(ctx, app, name, "")
          return
        }
        case "palette": {
          await ctx.answerCallbackQuery().catch(() => undefined)
          await runPaletteAction(app, ctx, text(payload.action))
          return
        }
        case "perm": {
          const result = await app.permissions.resolve(chatId, payload)
          await ctx.answerCallbackQuery({ text: result }).catch(() => undefined)
          return
        }
        case "pty": {
          const action = text(payload.action)
          const terminal = app.terminal.get(chatId)
          if (!terminal) {
            await ctx
              .answerCallbackQuery({ text: "No hay terminal abierta." })
              .catch(() => undefined)
            return
          }
          if (action === "close") {
            await ctx.answerCallbackQuery({ text: "Cerrando…" }).catch(() => undefined)
            await app.terminal.close(chatId)
            return
          }
          terminal.sendKey(action)
          await ctx.answerCallbackQuery({ text: `Tecla: ${action}` }).catch(() => undefined)
          return
        }
        default:
          await ctx.answerCallbackQuery({ text: "Acción desconocida" }).catch(() => undefined)
      }
    } catch (error) {
      app.logger.warn("callback failed", error)
      await ctx
        .answerCallbackQuery({ text: `⚠️ ${errorMessage(error)}`.slice(0, 190), show_alert: true })
        .catch(() => undefined)
    }
  })

  bot.on("message:text", async (ctx) => {
    const value = ctx.message.text
    const chatId = chatIdOf(ctx)
    const terminal = app.terminal.get(chatId)
    if (terminal) {
      terminal.sendLine(value)
      return
    }
    if (value.startsWith("/")) {
      await replyMarkdown(ctx, "Comando desconocido. Usa `/help` para ver la lista.")
      return
    }
    await sendPrompt(ctx, app, value)
  })

  bot.on(["message:photo", "message:document", "message:voice", "message:audio"], async (ctx) => {
    await replyMarkdown(ctx, "Por ahora solo puedo procesar mensajes de texto.")
  })
}
