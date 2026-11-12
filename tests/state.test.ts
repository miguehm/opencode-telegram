import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createLogger } from "../src/logger.js"
import { StateStore } from "../src/state.js"

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "oc-tg-state-"))
}

const logger = createLogger("error")

describe("StateStore", () => {
  it("creates defaults for unknown chats", async () => {
    const dir = await tempDir()
    const store = new StateStore(dir, logger)
    await store.load()
    const chat = store.get(1)
    expect(chat.agent).toBe("build")
    expect(chat.thinking).toBe(false)
    expect(chat.sessions).toEqual({})
  })

  it("persists updates and reloads them", async () => {
    const dir = await tempDir()
    const store = new StateStore(dir, logger)
    await store.load()
    store.update(7, (chat) => {
      chat.projectDir = "/tmp/project"
      chat.sessions["/tmp/project"] = "session-1"
      chat.agent = "plan"
      chat.model = { providerID: "anthropic", modelID: "claude" }
    })
    await store.flush()

    const reloaded = new StateStore(dir, logger)
    await reloaded.load()
    const chat = reloaded.get(7)
    expect(chat.projectDir).toBe("/tmp/project")
    expect(chat.sessions["/tmp/project"]).toBe("session-1")
    expect(chat.agent).toBe("plan")
    expect(chat.model).toEqual({ providerID: "anthropic", modelID: "claude" })
  })

  it("finds a chat by session id", async () => {
    const dir = await tempDir()
    const store = new StateStore(dir, logger)
    await store.load()
    store.update(9, (chat) => {
      chat.sessions["/tmp/a"] = "session-a"
    })
    expect(store.findChatBySession("session-a")).toBe("9")
    expect(store.findChatBySession("missing")).toBeUndefined()
  })

  it("recovers from corrupt state files", async () => {
    const dir = await tempDir()
    await fs.writeFile(path.join(dir, "state.json"), "{not json", "utf8")
    const store = new StateStore(dir, logger)
    await store.load()
    expect(store.get(1).agent).toBe("build")
  })
})
