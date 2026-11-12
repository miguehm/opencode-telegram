import type { Bot, Context } from "grammy"
import type { App } from "../app.js"
import { displayPath } from "../util/paths.js"
import { chatIdOf, commandArg, errorMessage, replyMarkdown } from "./shared.js"

export async function openTerminal(ctx: Context, app: App): Promise<void> {
  const chatId = chatIdOf(ctx)
  const chat = app.state.get(chatId)
  if (!chat.projectDir) {
    await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
    return
  }
  if (app.terminal.get(chatId)) {
    await replyMarkdown(ctx, "La terminal ya está abierta. Usa `/exit` para cerrarla.")
    return
  }
  if (app.turns.isBusy(chatId)) {
    await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` primero.")
    return
  }
  try {
    await replyMarkdown(ctx, `⏳ Abriendo terminal en \`${displayPath(chat.projectDir)}\`…`)
    await app.terminal.open(chatId, chat.projectDir)
  } catch (error) {
    await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
  }
}

export function registerTerminal(bot: Bot, app: App): void {
  bot.command("term", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const arg = commandArg(ctx).toLowerCase()
    if (arg === "close" || arg === "off" || arg === "exit") {
      const closed = await app.terminal.close(chatId)
      await replyMarkdown(ctx, closed ? "🖥️ Terminal cerrada." : "No hay terminal abierta.")
      return
    }
    await openTerminal(ctx, app)
  })

  bot.command("exit", async (ctx) => {
    const closed = await app.terminal.close(chatIdOf(ctx))
    await replyMarkdown(ctx, closed ? "🖥️ Terminal cerrada." : "No hay terminal abierta.")
  })

  bot.command("key", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const terminal = app.terminal.get(chatId)
    const key = commandArg(ctx).toLowerCase()
    if (!terminal) {
      await replyMarkdown(ctx, "No hay terminal abierta. Usa `/term`.")
      return
    }
    if (!key) {
      await replyMarkdown(
        ctx,
        "Uso: `/key <ctrl-c|ctrl-d|ctrl-z|tab|esc|enter|up|down|left|right>`",
      )
      return
    }
    terminal.sendKey(key)
    await replyMarkdown(ctx, `⌨️ Tecla enviada: \`${key}\``)
  })

  for (const [command, key] of [
    ["ctrl-c", "ctrl-c"],
    ["ctrl-d", "ctrl-d"],
  ] as const) {
    bot.command(command, async (ctx) => {
      const terminal = app.terminal.get(chatIdOf(ctx))
      if (!terminal) {
        await replyMarkdown(ctx, "No hay terminal abierta. Usa `/term`.")
        return
      }
      terminal.sendKey(key)
      await replyMarkdown(ctx, `⌨️ ${command} enviado.`)
    })
  }
}
