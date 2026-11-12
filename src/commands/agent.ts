import type { Bot } from "grammy"
import type { App } from "../app.js"
import { chatIdOf, commandArg, errorMessage, replyMarkdown, replyView } from "./shared.js"
import { agentsView, modelsView, providersView } from "./views.js"

async function setAgent(app: App, chatId: number, name: string): Promise<void> {
  const chat = app.state.get(chatId)
  if (!chat.projectDir) throw new Error("Selecciona un proyecto primero con `/use`.")
  const agents = await app.opencode.agents(chat.projectDir)
  if (!agents.some((agent) => agent.name === name)) {
    throw new Error(`Agente desconocido: ${name}`)
  }
  app.state.update(chatId, (state) => {
    state.agent = name
  })
}

export function registerAgent(bot: Bot, app: App): void {
  bot.command("agent", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    try {
      await replyView(ctx, await agentsView(app, chatId, chat.projectDir))
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  for (const name of ["plan", "build"]) {
    bot.command(name, async (ctx) => {
      const chatId = chatIdOf(ctx)
      try {
        await setAgent(app, chatId, name)
        await replyMarkdown(ctx, `🧭 Agente: **${name}**`)
      } catch (error) {
        await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
      }
    })
  }

  bot.command("tab", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    try {
      const agents = (await app.opencode.agents(chat.projectDir)).filter(
        (agent) => agent.mode !== "subagent",
      )
      if (agents.length === 0) {
        await replyMarkdown(ctx, "No hay agentes disponibles.")
        return
      }
      const index = agents.findIndex((agent) => agent.name === chat.agent)
      const next = agents[(index + 1) % agents.length]
      if (!next) {
        await replyMarkdown(ctx, "No hay agentes disponibles.")
        return
      }
      app.state.update(chatId, (state) => {
        state.agent = next.name
      })
      await replyMarkdown(ctx, `🧭 Agente: **${next.name}**`)
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("model", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    const arg = commandArg(ctx)
    try {
      if (!arg) {
        await replyView(ctx, await providersView(app, chatId, chat.projectDir))
        return
      }
      if (arg === "reset" || arg === "default") {
        app.state.update(chatId, (state) => {
          state.model = undefined
        })
        await replyMarkdown(ctx, "🧠 Modelo: **default**")
        return
      }

      const providers = await app.opencode.providers(chat.projectDir)
      const slash = arg.indexOf("/")
      if (slash > 0) {
        const providerID = arg.slice(0, slash)
        const modelID = arg.slice(slash + 1)
        const provider = providers.providers.find((item) => item.id === providerID)
        if (!provider) throw new Error(`Proveedor desconocido: ${providerID}`)
        if (!provider.models?.[modelID]) throw new Error(`Modelo desconocido: ${modelID}`)
        app.state.update(chatId, (state) => {
          state.model = { providerID, modelID }
        })
        await replyMarkdown(ctx, `🧠 Modelo: \`${providerID}/${modelID}\``)
        return
      }

      const query = arg.toLowerCase()
      const matches: Array<{ providerID: string; modelID: string }> = []
      for (const provider of providers.providers) {
        for (const model of Object.values(provider.models ?? {})) {
          if (
            model.id.toLowerCase().includes(query) ||
            (model.name ?? "").toLowerCase().includes(query)
          ) {
            matches.push({ providerID: provider.id, modelID: model.id })
          }
        }
      }
      const exact = matches.length === 1 ? matches[0] : undefined
      if (exact) {
        app.state.update(chatId, (state) => {
          state.model = exact
        })
        await replyMarkdown(ctx, `🧠 Modelo: \`${exact.providerID}/${exact.modelID}\``)
        return
      }
      if (matches.length === 0) {
        await replyMarkdown(ctx, `Sin modelos que coincidan con \`${arg}\`.`)
        return
      }
      const lines = [`🔎 Varios modelos (${matches.length}); usa \`/model provider/model\`:`]
      for (const match of matches.slice(0, 25)) {
        lines.push(`\`${match.providerID}/${match.modelID}\``)
      }
      await replyMarkdown(ctx, lines.join("\n"))
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("models", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const chat = app.state.get(chatId)
    if (!chat.projectDir) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    const arg = commandArg(ctx)
    try {
      if (arg) {
        await replyView(ctx, await modelsView(app, chatId, chat.projectDir, arg))
      } else {
        await replyView(ctx, await providersView(app, chatId, chat.projectDir))
      }
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })
}
