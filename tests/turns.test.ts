import type { Api } from "grammy"
import { describe, expect, it } from "vitest"
import { TurnManager } from "../src/chat/turns.js"
import { createLogger } from "../src/logger.js"
import type { OpencodeApi } from "../src/opencode/api.js"
import type { EventStream } from "../src/opencode/events.js"
import type { OcGlobalEvent } from "../src/opencode/types.js"

type Listener = (event: OcGlobalEvent) => void

class FakeEvents {
  private readonly listeners = new Set<Listener>()

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: OcGlobalEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

function harness() {
  const sent: string[] = []
  const api = {
    sendChatAction: async () => true,
    sendMessage: async (_chatId: number, text: string) => {
      sent.push(text)
      return { message_id: sent.length, date: 0, chat: { id: 1, type: "private" }, text }
    },
    editMessageText: async (_chatId: number, _id: number, text: string) => {
      sent.push(text)
      return { message_id: _id, date: 0, chat: { id: 1, type: "private" }, text }
    },
  } as unknown as Api
  const opencode = {
    messages: async () => [],
    abortSession: async () => undefined,
  } as unknown as OpencodeApi
  const events = new FakeEvents()
  const turns = new TurnManager(
    api,
    opencode,
    events as unknown as EventStream,
    createLogger("error"),
  )
  return { sent, events, turns }
}

function event(type: string, properties: Record<string, unknown>): OcGlobalEvent {
  return { directory: "/tmp", payload: { type, properties } }
}

async function waitFor(predicate: () => boolean, timeout = 5000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error("timeout")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("TurnManager", () => {
  it("streams assistant text and finishes on session idle", async () => {
    const { sent, events, turns } = harness()
    turns.start(1, "/tmp", "session-1", false)
    expect(turns.isBusy(1)).toBe(true)

    events.emit(
      event("message.updated", {
        info: { id: "m1", role: "assistant", sessionID: "session-1" },
      }),
    )
    events.emit(
      event("message.part.updated", {
        part: {
          id: "p1",
          type: "text",
          text: "hello",
          sessionID: "session-1",
          messageID: "m1",
        },
      }),
    )
    events.emit(event("session.idle", { sessionID: "session-1" }))

    await waitFor(() => !turns.isBusy(1))
    expect(sent.at(-1)).toContain("hello")
  })

  it("buffers parts that arrive before the message", async () => {
    const { sent, events, turns } = harness()
    turns.start(1, "/tmp", "session-2", false)
    events.emit(
      event("message.part.updated", {
        part: {
          id: "p1",
          type: "text",
          text: "early",
          sessionID: "session-2",
          messageID: "m1",
        },
      }),
    )
    events.emit(
      event("message.updated", {
        info: { id: "m1", role: "assistant", sessionID: "session-2" },
      }),
    )
    events.emit(event("session.status", { sessionID: "session-2", status: { type: "idle" } }))

    await waitFor(() => !turns.isBusy(1))
    expect(sent.at(-1)).toContain("early")
  })

  it("accumulates deltas for parts without text", async () => {
    const { sent, events, turns } = harness()
    turns.start(1, "/tmp", "session-3", false)
    events.emit(
      event("message.updated", {
        info: { id: "m1", role: "assistant", sessionID: "session-3" },
      }),
    )
    events.emit(
      event("message.part.updated", {
        part: { id: "p1", type: "text", text: "he", sessionID: "session-3", messageID: "m1" },
      }),
    )
    events.emit(
      event("message.part.updated", {
        part: { id: "p1", type: "text", sessionID: "session-3", messageID: "m1" },
        delta: "llo",
      }),
    )
    events.emit(event("session.idle", { sessionID: "session-3" }))

    await waitFor(() => !turns.isBusy(1))
    expect(sent.at(-1)).toContain("hello")
  })

  it("reports failures and clears the busy state", async () => {
    const { sent, events, turns } = harness()
    turns.start(1, "/tmp", "session-4", false)
    events.emit(event("session.status", { sessionID: "session-4", status: { type: "busy" } }))
    await turns.fail(1, "⚠️ boom")
    expect(turns.isBusy(1)).toBe(false)
    expect(sent.at(-1)).toContain("boom")
  })

  it("aborts the server session", async () => {
    let aborted = ""
    const abortedMock = {
      sendChatAction: async () => true,
      sendMessage: async () => ({ message_id: 1, date: 0, chat: { id: 1, type: "private" } }),
      editMessageText: async () => true,
    } as unknown as Api
    const opencode = {
      messages: async () => [],
      abortSession: async (directory: string, id: string) => {
        aborted = `${directory}:${id}`
      },
    } as unknown as OpencodeApi
    const events = new FakeEvents()
    const manager = new TurnManager(
      abortedMock,
      opencode,
      events as unknown as EventStream,
      createLogger("error"),
    )
    manager.start(2, "/tmp", "session-5", false)
    expect(await manager.abort(2)).toBe(true)
    expect(aborted).toBe("/tmp:session-5")
  })
})
