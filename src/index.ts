import { Bot } from "grammy"
import type { App } from "./app.js"
import { setupBot } from "./bot.js"
import { TurnManager } from "./chat/turns.js"
import { loadConfig } from "./config.js"
import { createLogger } from "./logger.js"
import { OpencodeApi } from "./opencode/api.js"
import { EventStream } from "./opencode/events.js"
import { PermissionBridge } from "./opencode/permissions.js"
import { QuestionBridge } from "./opencode/questions.js"
import { OpencodeServer } from "./opencode/server.js"
import { ProjectRegistry } from "./projects/registry.js"
import { TryService } from "./projects/try-service.js"
import { StateStore } from "./state.js"
import { CallbackStore } from "./telegram/callbacks.js"
import { TerminalManager } from "./terminal/pty.js"

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = createLogger(config.logLevel)
  logger.info(
    `starting bot · try=${config.tryPath} · state=${config.stateDir} · opencode=${
      config.opencodeUrl ?? `${config.opencodeHost}:${config.opencodePort}`
    }`,
  )

  const state = new StateStore(config.stateDir, logger)
  await state.load()

  const server = new OpencodeServer(config, logger)
  const info = await server.start()
  const headers = server.headers()

  const opencode = new OpencodeApi(info.url, headers)
  const bot = new Bot(config.botToken)
  const callbacks = new CallbackStore()
  const projects = new ProjectRegistry(config.tryPath, logger)
  const tryService = new TryService(config.tryPath, config.tryBin, logger)
  const events = new EventStream(info.url, headers, logger)
  const questions = new QuestionBridge(bot.api, opencode, events, state, callbacks, logger)
  const turns = new TurnManager(bot.api, opencode, events, logger, {
    hasPendingSession: (sessionID) => questions.hasPendingSession(sessionID),
  })
  const permissions = new PermissionBridge(bot.api, opencode, events, state, callbacks, logger)
  const terminal = new TerminalManager(bot.api, opencode, info.url, headers, callbacks, logger)

  const app: App = {
    config,
    logger,
    state,
    server,
    opencode,
    events,
    projects,
    tryService,
    turns,
    permissions,
    questions,
    terminal,
    callbacks,
    api: bot.api,
  }

  await setupBot(bot, app)
  events.start()

  let stopping = false
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return
    stopping = true
    logger.info(`shutting down (${signal})`)
    events.stop()
    try {
      await bot.stop()
    } catch (error) {
      logger.warn("bot.stop failed", error)
    }
    await terminal.closeAll()
    await server.stop()
    await state.flush()
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal).then(() => process.exit(0))
    })
  }

  await bot.start({
    onStart: (me) => logger.info(`telegram bot @${me.username} ready`),
  })
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exit(1)
})
