import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Api } from "grammy"
import { describe, expect, it } from "vitest"
import { createLogger } from "../src/logger.js"
import type { OpencodeApi } from "../src/opencode/api.js"
import type { EventStream } from "../src/opencode/events.js"
import { QuestionBridge } from "../src/opencode/questions.js"
import type { OcGlobalEvent, OcQuestionInfo, OcQuestionRequest } from "../src/opencode/types.js"
import { StateStore } from "../src/state.js"
import { CallbackStore } from "../src/telegram/callbacks.js"

type Listener = (event: OcGlobalEvent) => void

class FakeEvents {
  private readonly listeners = new Set<Listener>()
  private readonly connectListeners = new Set<() => void>()

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onConnect(listener: () => void): () => void {
    this.connectListeners.add(listener)
    return () => this.connectListeners.delete(listener)
  }

  emit(event: OcGlobalEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  connect(): void {
    for (const listener of this.connectListeners) listener()
  }
}

type Call = { method: string; payload: Record<string, unknown> }

async function waitFor(predicate: () => boolean, timeout = 5000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error("timeout")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function textOf(calls: Call[]): string[] {
  return calls
    .filter((call) => call.method === "sendMessage" || call.method === "editMessageText")
    .map((call) => String(call.payload.text ?? ""))
}

function event(type: string, properties: Record<string, unknown>): OcGlobalEvent {
  return { directory: "/tmp/project", payload: { type, properties } }
}

function question(
  id: string,
  options: Array<{ label: string; description?: string }> = [],
  extra: Partial<OcQuestionInfo> = {},
): OcQuestionInfo {
  return {
    question: `¿Pregunta ${id}?`,
    header: `Header ${id}`,
    options: options.map((option) => ({
      label: option.label,
      description: option.description ?? "",
    })),
    ...extra,
  }
}

async function harness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oc-tg-questions-"))
  const logger = createLogger("error")
  const state = new StateStore(path.join(root, "state"), logger)
  await state.load()
  state.update(1, (chat) => {
    chat.projectDir = "/tmp/project"
    chat.sessions["/tmp/project"] = "session-1"
  })

  const calls: Call[] = []
  let nextMessageId = 1
  const api = {
    sendMessage: async (_chatId: number, text: string, options: Record<string, unknown>) => {
      calls.push({ method: "sendMessage", payload: { text, ...options } })
      return { message_id: nextMessageId++, date: 0, chat: { id: 1, type: "private" }, text }
    },
    editMessageText: async (
      _chatId: number,
      _messageId: number,
      text: string,
      options: Record<string, unknown>,
    ) => {
      calls.push({ method: "editMessageText", payload: { text, ...options } })
      return true
    },
  } as unknown as Api

  const replies: string[][][] = []
  const v2Replies: string[][][] = []
  const rejections: string[] = []
  let listed: OcQuestionRequest[] = []
  let listedV2: OcQuestionRequest[] = []
  const opencode = {
    listQuestions: async () => listed,
    listQuestionsV2: async () => listedV2,
    replyQuestion: async (_directory: string, _id: string, answers: string[][]) => {
      replies.push(answers)
      return true
    },
    rejectQuestion: async (_directory: string, id: string) => {
      rejections.push(id)
      return true
    },
    replyQuestionV2: async (_sessionID: string, _id: string, answers: string[][]) => {
      v2Replies.push(answers)
      return true
    },
    rejectQuestionV2: async (_sessionID: string, id: string) => {
      rejections.push(id)
      return true
    },
  } as unknown as OpencodeApi

  const events = new FakeEvents()
  const callbacks = new CallbackStore()
  const bridge = new QuestionBridge(
    api,
    opencode,
    events as unknown as EventStream,
    state,
    callbacks,
    logger,
  )

  return {
    bridge,
    calls,
    replies,
    v2Replies,
    rejections,
    events,
    setListed(value: OcQuestionRequest[]) {
      listed = value
    },
    setListedV2(value: OcQuestionRequest[]) {
      listedV2 = value
    },
    textOf: () => textOf(calls),
  }
}

function payload(overrides: Record<string, unknown>) {
  return {
    kind: "question",
    requestId: "q1",
    chatId: 1,
    ...overrides,
  }
}

describe("QuestionBridge", () => {
  it("delivers a question prompt to the mapped chat", async () => {
    const h = await harness()
    h.events.emit(
      event("question.asked", {
        id: "q1",
        sessionID: "session-1",
        questions: [question("q1", [{ label: "Sí" }, { label: "No" }])],
      }),
    )

    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))
    const sent = h.calls.find((call) => call.method === "sendMessage")
    expect(sent?.payload.text).toContain("¿Pregunta q1?")
    expect(sent?.payload.reply_markup).toBeTruthy()
    expect(h.bridge.hasPendingSession("session-1")).toBe(true)
  })

  it("answers a single option and finishes the request", async () => {
    const h = await harness()
    h.events.emit(
      event("question.asked", {
        id: "q1",
        sessionID: "session-1",
        questions: [question("q1", [{ label: "Sí" }, { label: "No" }])],
      }),
    )
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))

    const result = await h.bridge.resolve(1, payload({ action: "option", index: 0, choice: 1 }))
    expect(result).toBe("Anotado")
    expect(h.replies).toEqual([[["No"]]])
    expect(h.bridge.hasPendingSession("session-1")).toBe(false)
    expect(h.textOf().at(-1)).toContain("respondida")
  })

  it("collects multiple selections before replying", async () => {
    const h = await harness()
    h.events.emit(
      event("question.asked", {
        id: "q1",
        sessionID: "session-1",
        questions: [question("q1", [{ label: "A" }, { label: "B" }], { multiple: true })],
      }),
    )
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))

    expect(await h.bridge.resolve(1, payload({ action: "option", index: 0, choice: 0 }))).toBe(
      "Marcado",
    )
    expect(await h.bridge.resolve(1, payload({ action: "option", index: 0, choice: 1 }))).toBe(
      "Marcado",
    )
    expect(h.replies).toEqual([])

    expect(await h.bridge.resolve(1, payload({ action: "confirm", index: 0 }))).toBe("Anotado")
    expect(h.replies).toEqual([[["A", "B"]]])
  })

  it("captures a custom text answer", async () => {
    const h = await harness()
    h.events.emit(
      event("question.asked", {
        id: "q1",
        sessionID: "session-1",
        questions: [question("q1", [], { custom: true })],
      }),
    )
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))

    expect(await h.bridge.resolve(1, payload({ action: "custom", index: 0 }))).toBe(
      "Escribe tu respuesta",
    )
    expect(await h.bridge.captureText(1, "mi respuesta")).toBe(true)
    expect(h.replies).toEqual([[["mi respuesta"]]])
  })

  it("rejects a question request", async () => {
    const h = await harness()
    h.events.emit(
      event("question.asked", {
        id: "q1",
        sessionID: "session-1",
        questions: [question("q1", [{ label: "Sí" }])],
      }),
    )
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))

    expect(await h.bridge.resolve(1, payload({ action: "reject" }))).toBe("Rechazada")
    expect(h.rejections).toEqual(["q1"])
    expect(h.bridge.hasPendingSession("session-1")).toBe(false)
    expect(h.textOf().at(-1)).toContain("rechazada")
  })

  it("cleans up when the question is answered elsewhere", async () => {
    const h = await harness()
    h.events.emit(
      event("question.asked", {
        id: "q1",
        sessionID: "session-1",
        questions: [question("q1", [{ label: "Sí" }])],
      }),
    )
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))

    h.events.emit(
      event("question.replied", {
        requestID: "q1",
        sessionID: "session-1",
        answers: [["Sí"]],
      }),
    )
    await waitFor(() => !h.bridge.hasPendingSession("session-1"))
    expect(h.textOf().at(-1)).toContain("respondida")
  })

  it("ignores questions for unknown sessions", async () => {
    const h = await harness()
    h.events.emit(
      event("question.asked", {
        id: "q1",
        sessionID: "missing",
        questions: [question("q1", [{ label: "Sí" }])],
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(h.calls).toEqual([])
  })

  it("recovers pending questions when the event stream connects", async () => {
    const h = await harness()
    h.setListed([
      {
        id: "q1",
        sessionID: "session-1",
        questions: [question("q1", [{ label: "Sí" }])],
      },
    ])
    h.events.connect()
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))
    expect(h.textOf()[0]).toContain("¿Pregunta q1?")
  })

  it("advances through multiple questions", async () => {
    const h = await harness()
    h.events.emit(
      event("question.asked", {
        id: "q1",
        sessionID: "session-1",
        questions: [question("q1", [{ label: "A" }]), question("q2", [{ label: "B" }])],
      }),
    )
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))

    await h.bridge.resolve(1, payload({ action: "option", index: 0, choice: 0 }))
    expect(h.textOf().at(-1)).toContain("Pregunta 2/2")
    expect(h.replies).toEqual([])

    await h.bridge.resolve(1, payload({ action: "option", index: 1, choice: 0 }))
    expect(h.replies).toEqual([[["A"], ["B"]]])
  })

  it("handles v2 question events", async () => {
    const h = await harness()
    h.events.emit(
      event("question.v2.asked", {
        id: "q2",
        sessionID: "session-1",
        questions: [question("q2", [{ label: "Sí" }])],
      }),
    )
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))

    await h.bridge.resolve(1, payload({ requestId: "q2", action: "option", index: 0, choice: 0 }))
    expect(h.v2Replies).toEqual([[["Sí"]]])
  })

  it("recovers pending v2 questions when the event stream connects", async () => {
    const h = await harness()
    h.setListedV2([
      {
        id: "q2",
        sessionID: "session-1",
        questions: [question("q2", [{ label: "Sí" }])],
      },
    ])
    h.events.connect()
    await waitFor(() => h.calls.some((call) => call.method === "sendMessage"))
    expect(h.textOf()[0]).toContain("¿Pregunta q2?")
  })
})
