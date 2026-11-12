import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { assertInside, datePrefix, displayPath, isInside } from "../src/util/paths.js"

describe("isInside", () => {
  it("accepts the parent itself", () => {
    expect(isInside("/tmp/base", "/tmp/base")).toBe(true)
  })

  it("accepts children", () => {
    expect(isInside("/tmp/base", "/tmp/base/a/b")).toBe(true)
  })

  it("rejects siblings and parents", () => {
    expect(isInside("/tmp/base", "/tmp/base2")).toBe(false)
    expect(isInside("/tmp/base", "/tmp")).toBe(false)
    expect(isInside("/tmp/base", "/tmp/base/..")).toBe(false)
  })

  it("accepts odd but valid child names", () => {
    expect(isInside("/tmp/base", "/tmp/base/..foo")).toBe(true)
    expect(isInside("/tmp/base", "/tmp/base/.hidden")).toBe(true)
  })
})

describe("assertInside", () => {
  it("returns the resolved path", () => {
    expect(assertInside("/tmp/base", "/tmp/base/a/../b")).toBe("/tmp/base/b")
  })

  it("throws when escaping", () => {
    expect(() => assertInside("/tmp/base", "/tmp/other")).toThrow(/escapes/)
  })
})

describe("displayPath", () => {
  const original = process.env.HOME
  afterEach(() => {
    if (original === undefined) delete process.env.HOME
    else process.env.HOME = original
  })

  it("replaces the home prefix", () => {
    process.env.HOME = "/home/user"
    expect(displayPath("/home/user/src")).toBe("~/src")
    expect(displayPath("/home/user")).toBe("~")
  })

  it("does not replace home in the middle", () => {
    process.env.HOME = "/home/user"
    expect(displayPath("/mnt/home/user")).toBe("/mnt/home/user")
  })

  it("handles a missing HOME", () => {
    delete process.env.HOME
    expect(displayPath("/tmp/x")).toBe("/tmp/x")
  })
})

describe("datePrefix", () => {
  it("formats a date", () => {
    expect(datePrefix(new Date(2026, 0, 5))).toBe("2026-01-05")
  })
})

describe("path joins stay inside", () => {
  it("handles relative traversal", () => {
    const base = "/tmp/base"
    expect(isInside(base, path.join(base, "a", "..", "b"))).toBe(true)
  })
})
