import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Bot } from "grammy"
import type { Update } from "grammy/types"
import { beforeAll, describe, expect, it } from "vitest"
import type { App } from "../src/app.js"
import { setupBot } from "../src/bot.js"
import { createLogger } from "../src/logger.js"
import { StateStore } from "../src/state.js"
import { type CallbackPayload, CallbackStore } from "../src/telegram/callbacks.js"

type Call = { method: string; payload: Record<string, unknown> }

type Harness = {
  bot: Bot
  app: App
  calls: Call[]
  root: string
  projectDir: string
  prompts: Array<{ directory: string; sessionId: string; text: string; agent: string }>
  turns: Array<{ chatId: number; directory: string; sessionId: string }>
  questions: {
    capture: boolean
    pending: boolean
    captures: string[]
    resolved: CallbackPayload[]
  }
}

const logger = createLogger("error")

function sentTexts(calls: Call[]): string[] {
  return calls
    .filter((call) => call.method === "sendMessage")
    .map((call) => String(call.payload.text ?? ""))
}

function updateMessage(updateId: number, text: string, userId = 1): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      chat: { id: 1, type: "private", first_name: "U" },
      from: { id: userId, is_bot: false, first_name: "U" },
      text,
      ...(text.startsWith("/")
        ? {
            entities: [
              { type: "bot_command", offset: 0, length: text.split(/\s/)[0]?.length ?? 0 },
            ],
          }
        : {}),
    },
  } as Update
}

async function harness(): Promise<Harness> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oc-tg-bot-"))
  const projectDir = path.join(root, "api")
  await fs.mkdir(projectDir)

  const state = new StateStore(path.join(root, "state"), logger)
  await state.load()
  const callbacks = new CallbackStore()
  const calls: Call[] = []
  const prompts: Harness["prompts"] = []
  const turns: Harness["turns"] = []
  const questions: Harness["questions"] = {
    capture: false,
    pending: false,
    captures: [],
    resolved: [],
  }

  const bot = new Bot("123:test")
  bot.api.config.use(async (_prev, method, payload) => {
    const body = payload as Record<string, unknown>
    calls.push({ method, payload: body })
    let result: unknown = true
    if (method === "getMe") {
      result = { id: 123, is_bot: true, first_name: "bot", username: "test_bot" }
    } else if (method === "sendMessage") {
      result = {
        message_id: calls.length,
        date: 1,
        chat: { id: body.chat_id, type: "private" },
        text: body.text,
      }
    } else if (method === "editMessageText") {
      result = true
    }
    return { ok: true, result } as never
  })

  const app = {
    config: {
      botToken: "123:test",
      allowedUsers: new Set([1]),
      tryPath: root,
      tryBin: "try",
      opencodeHost: "127.0.0.1",
      opencodePort: 4096,
      opencodeServerUsername: "opencode",
      stateDir: path.join(root, "state"),
      logLevel: "error",
      termCols: 120,
      termRows: 40,
    },
    logger,
    state,
    server: {} as App["server"],
    opencode: {
      agents: async () => [{ name: "build", mode: "primary" }],
      listSessions: async () => [],
      getSession: async (_dir: string, id: string) => ({
        id,
        title: "Sesión",
        directory: projectDir,
      }),
      createSession: async (_dir: string, title: string) => ({
        id: "session-new",
        title,
        directory: projectDir,
      }),
      promptAsync: async (
        directory: string,
        sessionId: string,
        body: { text: string; agent: string },
      ) => {
        prompts.push({ directory, sessionId, text: body.text, agent: body.agent })
      },
      runCommand: async () => undefined,
      runShell: async () => undefined,
      abortSession: async () => undefined,
      summarizeSession: async () => undefined,
      renameSession: async () => undefined,
      deleteSession: async () => undefined,
    } as unknown as App["opencode"],
    events: {} as App["events"],
    projects: {
      root,
      isProjectDir: (dir: string) => dir === projectDir,
      list: async () => [{ name: "api", dir: projectDir, mtime: Date.now() }],
      find: async () => [{ name: "api", dir: projectDir, mtime: Date.now() }],
      resolve: async () => ({ name: "api", dir: projectDir, mtime: Date.now() }),
      info: async () => ({ branch: "main", dirty: false }),
    } as unknown as App["projects"],
    tryService: {} as App["tryService"],
    turns: {
      isBusy: () => false,
      start: (chatId: number, directory: string, sessionId: string) => {
        turns.push({ chatId, directory, sessionId })
      },
      abort: async () => true,
      fail: async () => undefined,
    } as unknown as App["turns"],
    permissions: {} as App["permissions"],
    questions: {
      captureText: async (_chatId: number, value: string) => {
        if (!questions.capture) return false
        questions.captures.push(value)
        return true
      },
      hasPendingChat: () => questions.pending,
      resolve: async (_chatId: number, payload: CallbackPayload) => {
        questions.resolved.push(payload)
        return "ok"
      },
      rejectForChat: async () => 0,
      showPending: async () => false,
    } as unknown as App["questions"],
    terminal: {
      get: () => undefined,
      open: async () => undefined,
      close: async () => false,
    } as unknown as App["terminal"],
    callbacks,
    api: bot.api,
  } as unknown as App

  await setupBot(bot, app)
  await bot.init()
  return { bot, app, calls, root, projectDir, prompts, turns, questions }
}

describe("bot handlers", () => {
  let h: Harness

  beforeAll(async () => {
    h = await harness()
  })

  it("rejects users outside the allowlist", async () => {
    await h.bot.handleUpdate(updateMessage(1, "/help", 999))
    expect(sentTexts(h.calls).at(-1)).toContain("No estás autorizado")
  })

  it("answers /help", async () => {
    await h.bot.handleUpdate(updateMessage(2, "/help"))
    expect(sentTexts(h.calls).at(-1)).toContain("opencode Telegram bot")
  })

  it("answers unknown commands", async () => {
    await h.bot.handleUpdate(updateMessage(3, "/nope"))
    expect(sentTexts(h.calls).at(-1)).toContain("Comando desconocido")
  })

  it("lists projects", async () => {
    await h.bot.handleUpdate(updateMessage(4, "/projects"))
    expect(sentTexts(h.calls).at(-1)).toContain("Proyectos")
  })

  it("activates a project and creates a session", async () => {
    await h.bot.handleUpdate(updateMessage(5, "/use api"))
    expect(h.app.state.get(1).projectDir).toBe(h.projectDir)
    expect(h.app.state.get(1).sessions[h.projectDir]).toBe("session-new")
    expect(sentTexts(h.calls).at(-1)).toContain("Proyecto activo")
  })

  it("forwards plain text to the active agent", async () => {
    await h.bot.handleUpdate(updateMessage(6, "hola agente"))
    expect(h.prompts.at(-1)).toEqual({
      directory: h.projectDir,
      sessionId: "session-new",
      text: "hola agente",
      agent: "build",
    })
    expect(h.turns.at(-1)?.chatId).toBe(1)
  })

  it("captures text answers for pending questions", async () => {
    h.questions.capture = true
    const before = h.prompts.length
    await h.bot.handleUpdate(updateMessage(9, "respuesta libre"))
    h.questions.capture = false
    expect(h.questions.captures).toEqual(["respuesta libre"])
    expect(h.prompts.length).toBe(before)
  })

  it("routes question callbacks", async () => {
    const token = h.app.callbacks.put(1, {
      kind: "question",
      action: "option",
      requestId: "que_1",
      index: 0,
      choice: 1,
    })
    await h.bot.handleUpdate({
      update_id: 10,
      callback_query: {
        id: "cb3",
        from: { id: 1, is_bot: false, first_name: "U" },
        chat_instance: "x",
        data: `cb:${token}`,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 1, type: "private" },
          text: "question",
        },
      },
    } as Update)
    expect(h.questions.resolved.at(-1)).toMatchObject({ requestId: "que_1", choice: 1 })
  })

  it("executes a palette callback", async () => {
    const token = h.app.callbacks.put(1, { kind: "palette", action: "help" })
    await h.bot.handleUpdate({
      update_id: 7,
      callback_query: {
        id: "cb1",
        from: { id: 1, is_bot: false, first_name: "U" },
        chat_instance: "x",
        data: `cb:${token}`,
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 1, type: "private" },
          text: "menu",
        },
      },
    } as Update)
    expect(sentTexts(h.calls).at(-1)).toContain("opencode Telegram bot")
  })

  it("rejects stale callback tokens", async () => {
    await h.bot.handleUpdate({
      update_id: 8,
      callback_query: {
        id: "cb2",
        from: { id: 1, is_bot: false, first_name: "U" },
        chat_instance: "x",
        data: "cb:missing",
        message: {
          message_id: 1,
          date: 1,
          chat: { id: 1, type: "private" },
          text: "menu",
        },
      },
    } as Update)
    const answers = h.calls.filter((call) => call.method === "answerCallbackQuery")
    expect(answers.at(-1)?.payload.text).toContain("caducado")
  })
})
