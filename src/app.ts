import type { Api } from "grammy"
import type { TurnManager } from "./chat/turns.js"
import type { Config } from "./config.js"
import type { Logger } from "./logger.js"
import type { OpencodeApi } from "./opencode/api.js"
import type { EventStream } from "./opencode/events.js"
import type { PermissionBridge } from "./opencode/permissions.js"
import type { QuestionBridge } from "./opencode/questions.js"
import type { OpencodeServer } from "./opencode/server.js"
import type { ProjectRegistry } from "./projects/registry.js"
import type { TryService } from "./projects/try-service.js"
import type { StateStore } from "./state.js"
import type { CallbackStore } from "./telegram/callbacks.js"
import type { TerminalManager } from "./terminal/pty.js"

export type App = {
  config: Config
  logger: Logger
  state: StateStore
  server: OpencodeServer
  opencode: OpencodeApi
  events: EventStream
  projects: ProjectRegistry
  tryService: TryService
  turns: TurnManager
  permissions: PermissionBridge
  questions: QuestionBridge
  terminal: TerminalManager
  callbacks: CallbackStore
  api: Api
}
