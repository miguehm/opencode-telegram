import type { Bot } from "grammy"
import type { App } from "../app.js"
import { registerAgent } from "./agent.js"
import { registerChat } from "./chat.js"
import { registerHelp } from "./help.js"
import { registerOpencode } from "./opencode.js"
import { registerPalette } from "./palette.js"
import { registerProjects } from "./projects.js"
import { registerTerminal } from "./terminal.js"

export function registerCommands(bot: Bot, app: App): void {
  registerHelp(bot)
  registerPalette(bot, app)
  registerProjects(bot, app)
  registerChat(bot, app)
  registerAgent(bot, app)
  registerOpencode(bot, app)
  registerTerminal(bot, app)
}
