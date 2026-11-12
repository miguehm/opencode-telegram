import { describe, expect, it } from "vitest"
import { fuzzyScore, type ProjectEntry, rankProjects } from "../src/projects/registry.js"

describe("fuzzyScore", () => {
  it("scores exact matches highest", () => {
    expect(fuzzyScore("api", "api")).toBe(1000)
  })

  it("prefers prefix matches", () => {
    expect(fuzzyScore("api", "api-server")).toBeGreaterThan(fuzzyScore("api", "my-api-server"))
  })

  it("supports subsequence matches", () => {
    expect(fuzzyScore("apiv2", "api-server-v2")).toBeGreaterThan(0)
  })

  it("rejects non matches", () => {
    expect(fuzzyScore("zzz", "api")).toBe(-1)
  })
})

describe("rankProjects", () => {
  const entries: ProjectEntry[] = [
    { name: "web-app", dir: "/tmp/web-app", mtime: 1 },
    { name: "api", dir: "/tmp/api", mtime: 2 },
    { name: "api-server", dir: "/tmp/api-server", mtime: 3 },
  ]

  it("returns everything without a query", () => {
    expect(rankProjects("", entries)).toHaveLength(3)
  })

  it("ranks better matches first", () => {
    const result = rankProjects("api", entries)
    expect(result.map((entry) => entry.name)).toEqual(["api", "api-server"])
  })

  it("filters non matches", () => {
    expect(rankProjects("zzz", entries)).toEqual([])
  })
})
