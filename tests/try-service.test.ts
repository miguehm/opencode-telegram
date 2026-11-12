import { describe, expect, it } from "vitest"
import {
  cleanTryOutput,
  parseTryPwd,
  validateCloneUrl,
  validateTryName,
} from "../src/projects/try-service.js"

describe("validateTryName", () => {
  it("accepts simple names", () => {
    expect(validateTryName("my-project")).toBe("my-project")
    expect(validateTryName(" proyecto 1 ")).toBe("proyecto 1")
  })

  it("rejects empty names", () => {
    expect(() => validateTryName(" ")).toThrow()
  })

  it("rejects names starting with a dash", () => {
    expect(() => validateTryName("-rf")).toThrow()
  })

  it("rejects path traversal", () => {
    expect(() => validateTryName("../evil")).toThrow()
    expect(() => validateTryName("a/b")).toThrow()
    expect(() => validateTryName("a\\b")).toThrow()
  })
})

describe("validateCloneUrl", () => {
  it("accepts common git urls", () => {
    expect(validateCloneUrl("https://github.com/a/b.git")).toBe("https://github.com/a/b.git")
    expect(validateCloneUrl("git@github.com:a/b.git")).toBe("git@github.com:a/b.git")
    expect(validateCloneUrl("ssh://git@host/a/b")).toBe("ssh://git@host/a/b")
  })

  it("rejects other protocols and flags", () => {
    expect(() => validateCloneUrl("file:///etc/passwd")).toThrow()
    expect(() => validateCloneUrl("--upload-pack=evil")).toThrow()
  })
})

describe("parseTryPwd", () => {
  it("extracts the final path", () => {
    expect(parseTryPwd("mkdir /tmp/x\n__TRY_PWD__/tmp/x\n")).toBe("/tmp/x")
  })

  it("returns undefined without a marker", () => {
    expect(parseTryPwd("nothing here")).toBeUndefined()
  })
})

describe("cleanTryOutput", () => {
  it("removes comments, blank lines and the marker", () => {
    const output = ["# comment", "", "cd /tmp/x", "__TRY_PWD__/tmp/x", "done"].join("\n")
    expect(cleanTryOutput(output)).toBe("cd /tmp/x\ndone")
  })

  it("keeps the last twenty lines", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`)
    const cleaned = cleanTryOutput(lines.join("\n")).split("\n")
    expect(cleaned).toHaveLength(20)
    expect(cleaned[0]).toBe("line 10")
  })
})
