import { describe, expect, it } from "vitest"
import { CallbackStore } from "../src/telegram/callbacks.js"

describe("CallbackStore", () => {
  it("stores and takes a payload once", () => {
    const store = new CallbackStore()
    const token = store.put(1, { kind: "project", dir: "/tmp/a" })
    expect(store.take(1, token)).toEqual({ kind: "project", dir: "/tmp/a", chatId: 1 })
    expect(store.take(1, token)).toBeUndefined()
  })

  it("rejects other chats", () => {
    const store = new CallbackStore()
    const token = store.put(1, { kind: "project" })
    expect(store.take(2, token)).toBeUndefined()
  })

  it("expires tokens", async () => {
    const store = new CallbackStore(5)
    const token = store.put(1, { kind: "project" })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(store.take(1, token)).toBeUndefined()
  })

  it("builds an inline keyboard with cb tokens", () => {
    const store = new CallbackStore()
    const keyboard = store.keyboard(1, [
      [
        { text: "A", payload: { kind: "agent", name: "plan" } },
        { text: "B", payload: { kind: "agent", name: "build" } },
      ],
    ])
    expect(keyboard.inline_keyboard).toHaveLength(1)
    expect(keyboard.inline_keyboard[0]).toHaveLength(2)
    for (const button of keyboard.inline_keyboard[0] ?? []) {
      expect("callback_data" in button && button.callback_data?.startsWith("cb:")).toBe(true)
    }
  })
})
