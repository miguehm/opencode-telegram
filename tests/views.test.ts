import { describe, expect, it } from "vitest"
import type { App } from "../src/app.js"
import {
  agentsView,
  commandsView,
  modelsView,
  paletteView,
  projectsView,
  providersView,
  sessionsView,
  statusView,
} from "../src/commands/views.js"
import type { ChatState } from "../src/state.js"
import { CallbackStore } from "../src/telegram/callbacks.js"

const chat: ChatState = {
  projectDir: "/home/user/src/tries/api",
  sessions: { "/home/user/src/tries/api": "session-1" },
  agent: "build",
  thinking: false,
}

function app(): App {
  const callbacks = new CallbackStore()
  return {
    config: {} as App["config"],
    logger: {} as App["logger"],
    state: {
      get: () => chat,
      update: () => chat,
      findChatBySession: () => "1",
    } as unknown as App["state"],
    server: {} as App["server"],
    opencode: {
      agents: async () => [
        { name: "build", mode: "primary", description: "Implementa" },
        { name: "plan", mode: "primary" },
        { name: "explore", mode: "subagent" },
      ],
      listSessions: async () => [
        {
          id: "session-1",
          title: "Sesión actual",
          directory: chat.projectDir ?? "",
          time: { created: Date.now() - 1000, updated: Date.now() },
          cost: 0.0123,
          tokens: { input: 10, output: 20, reasoning: 0 },
        },
        {
          id: "session-2",
          title: "Otra sesión",
          directory: chat.projectDir ?? "",
          time: { created: Date.now() - 86_400_000, updated: Date.now() - 86_400_000 },
        },
      ],
      providers: async () => ({
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-sonnet": { id: "claude-sonnet", name: "Claude Sonnet" },
              "claude-haiku": { id: "claude-haiku", name: "Claude Haiku" },
            },
          },
        ],
      }),
      commands: async () => [
        { name: "init", description: "Inicializa el proyecto" },
        { name: "review", description: "Revisa cambios" },
      ],
      getSession: async () => ({
        id: "session-1",
        title: "Sesión actual",
        directory: chat.projectDir ?? "",
        cost: 0.0123,
        tokens: { input: 10, output: 20, reasoning: 0 },
      }),
    } as unknown as App["opencode"],
    events: {} as App["events"],
    projects: {
      root: "/home/user/src/tries",
      list: async () => [
        {
          name: "api",
          dir: "/home/user/src/tries/api",
          mtime: Date.now(),
          git: { branch: "main", dirty: true },
        },
      ],
      find: async () => [],
      info: async () => ({ branch: "main", dirty: true }),
    } as unknown as App["projects"],
    tryService: {} as App["tryService"],
    turns: { isBusy: () => false } as unknown as App["turns"],
    permissions: {} as App["permissions"],
    questions: {} as App["questions"],
    terminal: { get: () => undefined } as unknown as App["terminal"],
    callbacks,
    api: {} as App["api"],
  }
}

describe("views", () => {
  it("lists projects with a keyboard", async () => {
    const view = await projectsView(app(), 1)
    expect(view.text).toContain("api")
    expect(view.text).toContain("main")
    expect(view.keyboard?.inline_keyboard).toHaveLength(1)
  })

  it("lists primary agents only", async () => {
    const view = await agentsView(app(), 1, "/home/user/src/tries/api")
    expect(view.text).toContain("build")
    expect(view.text).toContain("plan")
    expect(view.text).not.toContain("explore")
    expect(view.keyboard?.inline_keyboard).toHaveLength(2)
  })

  it("lists sessions with switch and delete buttons", async () => {
    const view = await sessionsView(app(), 1, "/home/user/src/tries/api")
    expect(view.text).toContain("Sesión actual")
    expect(view.keyboard?.inline_keyboard).toHaveLength(3)
    expect(view.keyboard?.inline_keyboard[0]?.[0]?.text).toContain("Nueva")
  })

  it("lists providers and models", async () => {
    const instance = app()
    const providers = await providersView(instance, 1, "/home/user/src/tries/api")
    expect(providers.keyboard?.inline_keyboard[0]?.[0]?.text).toContain("Anthropic")
    const models = await modelsView(instance, 1, "/home/user/src/tries/api", "anthropic")
    expect(models.text).toContain("Claude Sonnet")
    expect(models.keyboard?.inline_keyboard).toHaveLength(2)
  })

  it("lists commands", async () => {
    const view = await commandsView(app(), 1, "/home/user/src/tries/api")
    expect(view.text).toContain("/init")
    expect(view.keyboard?.inline_keyboard).toHaveLength(3)
  })

  it("builds the palette", () => {
    const view = paletteView(app(), 1)
    expect(view.text).toContain("Ctrl+P")
    expect(view.keyboard?.inline_keyboard.length).toBeGreaterThan(3)
  })

  it("shows status with session data", async () => {
    const view = await statusView(app(), 1)
    expect(view.text).toContain("main")
    expect(view.text).toContain("session-1".slice(0, 12))
    expect(view.text).toContain("0.0123")
    expect(view.text).toContain("10 in")
  })
})
