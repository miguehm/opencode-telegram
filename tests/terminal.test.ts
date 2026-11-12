import { describe, expect, it } from "vitest"
import { cleanTerminalOutput, stripPtyMeta } from "../src/terminal/pty.js"

describe("stripPtyMeta", () => {
  it("removes the opencode cursor header", () => {
    expect(stripPtyMeta('\u0000{"cursor":0}hello')).toBe("hello")
  })

  it("leaves normal output untouched", () => {
    expect(stripPtyMeta("hello")).toBe("hello")
  })
})

describe("cleanTerminalOutput", () => {
  it("strips ANSI escapes and carriage returns", () => {
    expect(cleanTerminalOutput("\u001b[31mred\u001b[0m\r\nnext")).toBe("red\nnext")
  })

  it("removes NUL headers", () => {
    expect(cleanTerminalOutput('\u0000{"cursor":12}$ ls\nfile')).toBe("$ ls\nfile")
  })

  it("drops remaining control bytes", () => {
    expect(cleanTerminalOutput("a\u0007b\u007fc")).toBe("abc")
  })
})
