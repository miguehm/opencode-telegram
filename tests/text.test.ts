import { describe, expect, it } from "vitest"
import { formatBytes, oneLine, relativeAge, tail, truncate } from "../src/util/text.js"

describe("truncate", () => {
  it("keeps short values", () => {
    expect(truncate("hello", 10)).toBe("hello")
  })

  it("adds an ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello w…")
  })

  it("supports a custom suffix", () => {
    expect(truncate("hello world", 8, "...")).toBe("hello...")
  })
})

describe("tail", () => {
  it("returns the last characters", () => {
    expect(tail("abcdef", 3)).toBe("def")
    expect(tail("abc", 5)).toBe("abc")
  })
})

describe("oneLine", () => {
  it("collapses whitespace", () => {
    expect(oneLine("  hello\n\nworld\t!  ", 40)).toBe("hello world !")
  })
})

describe("relativeAge", () => {
  const now = 1_700_000_000_000
  it("formats seconds", () => {
    expect(relativeAge(now - 5_000, now)).toBe("5s")
  })
  it("formats minutes", () => {
    expect(relativeAge(now - 5 * 60_000, now)).toBe("5m")
  })
  it("formats hours", () => {
    expect(relativeAge(now - 5 * 3_600_000, now)).toBe("5h")
  })
  it("formats days", () => {
    expect(relativeAge(now - 5 * 86_400_000, now)).toBe("5d")
  })
  it("formats months", () => {
    expect(relativeAge(now - 75 * 86_400_000, now)).toBe("3mo")
  })
  it("formats years", () => {
    expect(relativeAge(now - 800 * 86_400_000, now)).toBe("2y")
  })
})

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(10)).toBe("10B")
  })
  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0KB")
  })
  it("formats megabytes", () => {
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0MB")
  })
})
