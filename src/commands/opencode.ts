import type { Bot, Context } from "grammy"
import type { App } from "../app.js"
import { chatIdOf, commandArg, ensureSession, errorMessage, replyMarkdown } from "./shared.js"
import { commandsView } from "./views.js"

export async function runCommand(
  ctx: Context,
  app: App,
  name: string,
  args: string,
): Promise<void> {
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
  let started = false
  try {
    const session = await ensureSession(app, chatId, chat.projectDir)
    app.turns.start(chatId, chat.projectDir, session.id, chat.thinking)
    started = true
    await app.opencode.runCommand(chat.projectDir, session.id, name, args, chat.agent)
  } catch (error) {
    const message = errorMessage(error)
    if (!started || !(await app.turns.fail(chatId, message))) {
      await replyMarkdown(ctx, `⚠️ ${message}`)
    }
  }
}

export async function sendPrompt(ctx: Context, app: App, text: string): Promise<void> {
  const chatId = chatIdOf(ctx)
  const chat = app.state.get(chatId)
  if (!chat.projectDir) {
    await replyMarkdown(ctx, "Selecciona un proyecto primero con `/projects` o `/use <nombre>`.")
    return
  }
  if (app.turns.isBusy(chatId)) {
    await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` para cancelarla.")
    return
  }
  let started = false
  try {
    const session = await ensureSession(app, chatId, chat.projectDir)
    app.turns.start(chatId, chat.projectDir, session.id, chat.thinking)
    started = true
    await app.opencode.promptAsync(chat.projectDir, session.id, {
      text,
      agent: chat.agent,
      ...(chat.model ? { model: chat.model } : {}),
    })
  } catch (error) {
    const message = errorMessage(error)
    if (!started || !(await app.turns.fail(chatId, message))) {
      await replyMarkdown(ctx, `⚠️ ${message}`)
    }
  }
}

export async function runShellCommand(ctx: Context, app: App, command: string): Promise<void> {
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
  let started = false
  try {
    const session = await ensureSession(app, chatId, chat.projectDir)
    app.turns.start(chatId, chat.projectDir, session.id, chat.thinking)
    started = true
    await app.opencode.runShell(chat.projectDir, session.id, command, chat.agent)
  } catch (error) {
    const message = errorMessage(error)
    if (!started || !(await app.turns.fail(chatId, message))) {
      await replyMarkdown(ctx, `⚠️ ${message}`)
    }
  }
}

export function registerOpencode(bot: Bot, app: App): void {
  bot.command("cmd", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    const arg = commandArg(ctx)
    if (!arg) {
      if (!chat.projectDir) {
        await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
        return
      }
      await ctx.reply("Elige un comando:", {
        reply_markup: (await commandsView(app, chatId, chat.projectDir)).keyboard,
      })
      return
    }
    const [rawName, ...rest] = arg.split(/\s+/)
    if (!rawName) {
      await replyMarkdown(ctx, "Uso: `/cmd <nombre> [argumentos]`")
      return
    }
    const name = rawName.replace(/^\//, "")
    await runCommand(ctx, app, name, rest.join(" "))
  })

  bot.command("sh", async (ctx) => {
    const command = commandArg(ctx)
    if (!command) {
      await replyMarkdown(ctx, "Uso: `/sh <comando>`\nEjemplo: `/sh git status --short`")
      return
    }
    await runShellCommand(ctx, app, command)
  })

  bot.command("exec", async (ctx) => {
    const command = commandArg(ctx)
    if (!command) {
      await replyMarkdown(ctx, "Uso: `/exec <comando>` (alias de `/sh`)")
      return
    }
    await runShellCommand(ctx, app, command)
  })

  bot.command("say", async (ctx) => {
    const text = commandArg(ctx)
    if (!text) {
      await replyMarkdown(ctx, "Uso: `/say <texto>`")
      return
    }
    await sendPrompt(ctx, app, text)
  })
}
