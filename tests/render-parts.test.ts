import { describe, expect, it } from "vitest"
import { renderError, renderParts } from "../src/chat/render-parts.js"
import type { OcPart } from "../src/opencode/types.js"

function part(id: string, values: Partial<OcPart>): OcPart {
  return { id, sessionID: "s", messageID: "m", type: "text", ...values }
}

describe("renderParts", () => {
  it("renders text and skips synthetic or empty parts", () => {
    const parts = new Map<string, OcPart>([
      ["1", part("1", { text: "hello" })],
      ["2", part("2", { text: "synthetic", synthetic: true })],
      ["3", part("3", { text: "   " })],
    ])
    expect(renderParts(parts, { showThinking: false })).toBe("hello")
  })

  it("hides reasoning unless enabled", () => {
    const parts = new Map<string, OcPart>([["1", part("1", { type: "reasoning", text: "think" })]])
    expect(renderParts(parts, { showThinking: false })).toBe("")
    expect(renderParts(parts, { showThinking: true })).toContain("🧠 think")
  })

  it("renders tools with status icons", () => {
    const parts = new Map<string, OcPart>([
      [
        "1",
        part("1", {
          type: "tool",
          tool: "bash",
          state: { status: "completed", title: "ls" },
        }),
      ],
      [
        "2",
        part("2", {
          type: "tool",
          tool: "edit",
          state: { status: "error", title: "apply", error: "nope" },
        }),
      ],
    ])
    const text = renderParts(parts, { showThinking: false })
    expect(text).toContain("✅ **bash** ls")
    expect(text).toContain("❌ **edit** apply")
    expect(text).toContain("> nope")
  })

  it("renders subtasks, retries and compaction", () => {
    const parts = new Map<string, OcPart>([
      ["1", part("1", { type: "subtask", agent: "explore", description: "find" })],
      ["2", part("2", { type: "retry" })],
      ["3", part("3", { type: "compaction" })],
    ])
    const text = renderParts(parts, { showThinking: false })
    expect(text).toContain("↳ **explore**: find")
    expect(text).toContain("reintentando")
    expect(text).toContain("compactada")
  })
})

describe("renderError", () => {
  it("formats an error with a message", () => {
    expect(renderError({ name: "APIError", data: { message: "boom" } })).toBe(
      "⚠️ **APIError**: boom",
    )
  })

  it("handles unknown errors", () => {
    expect(renderError(undefined)).toContain("desconocido")
  })
})
