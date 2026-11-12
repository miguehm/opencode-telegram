import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { expandHome, loadConfig, parseUserList } from "../src/config.js"

describe("parseUserList", () => {
  it("parses comma and space separated ids", () => {
    expect([...parseUserList("1, 2 3")]).toEqual([1, 2, 3])
  })

  it("rejects invalid ids", () => {
    expect(() => parseUserList("abc")).toThrow()
    expect(() => parseUserList("1, -2")).toThrow()
    expect(() => parseUserList("1.5")).toThrow()
  })
})

describe("expandHome", () => {
  it("expands a leading tilde", () => {
    expect(expandHome("~")).toBe(os.homedir())
    expect(expandHome("~/src")).toBe(path.join(os.homedir(), "src"))
  })

  it("leaves other paths alone", () => {
    expect(expandHome("/tmp/x")).toBe("/tmp/x")
  })
})

describe("loadConfig", () => {
  const base = {
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_ALLOWED_USERS: "42",
  }

  it("applies defaults", () => {
    const config = loadConfig(base)
    expect(config.botToken).toBe("token")
    expect(config.allowedUsers.has(42)).toBe(true)
    expect(config.tryPath).toBe(path.join(os.homedir(), "src", "tries"))
    expect(config.tryBin).toBe("try")
    expect(config.opencodePort).toBe(4096)
    expect(config.logLevel).toBe("info")
  })

  it("reads explicit values", () => {
    const config = loadConfig({
      ...base,
      TRY_PATH: "/tmp/projects",
      OPENCODE_URL: "http://127.0.0.1:5000",
      OPENCODE_PORT: "5001",
      LOG_LEVEL: "debug",
      TERM_COLS: "80",
      TERM_ROWS: "24",
    })
    expect(config.tryPath).toBe("/tmp/projects")
    expect(config.opencodeUrl).toBe("http://127.0.0.1:5000")
    expect(config.opencodePort).toBe(5001)
    expect(config.logLevel).toBe("debug")
    expect(config.termCols).toBe(80)
    expect(config.termRows).toBe(24)
  })

  it("requires a token and an allowlist", () => {
    expect(() => loadConfig({})).toThrow(/TELEGRAM_BOT_TOKEN/)
    expect(() => loadConfig({ TELEGRAM_BOT_TOKEN: "x" })).toThrow(/TELEGRAM_ALLOWED_USERS/)
  })
})
