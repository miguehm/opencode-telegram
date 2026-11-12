import { describe, expect, it } from "vitest"
import {
  escapeHtml,
  markdownToHtml,
  plainFromHtml,
  renderChunks,
  splitMarkdown,
} from "../src/telegram/render.js"

describe("escapeHtml", () => {
  it("escapes tag and entity characters", () => {
    expect(escapeHtml("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;")
  })
})

describe("markdownToHtml", () => {
  it("renders bold, inline code and links", () => {
    const html = markdownToHtml("**hi** `x < y` [docs](https://example.com)")
    expect(html).toContain("<b>hi</b>")
    expect(html).toContain("<code>x &lt; y</code>")
    expect(html).toContain('<a href="https://example.com">docs</a>')
  })

  it("renders fenced code without inline formatting", () => {
    const html = markdownToHtml("```ts\nconst x = 1 < 2\n**not bold**\n```")
    expect(html).toContain('<pre><code class="language-ts">')
    expect(html).toContain("const x = 1 &lt; 2")
    expect(html).toContain("**not bold**")
    expect(html).not.toContain("<b>not bold</b>")
  })

  it("escapes raw html", () => {
    expect(markdownToHtml("<script>alert(1)</script>")).toContain("&lt;script&gt;")
  })

  it("renders headings and quotes", () => {
    expect(markdownToHtml("# Title")).toContain("<b>Title</b>")
    expect(markdownToHtml("> quote")).toContain("▎ quote")
  })

  it("renders underscores as italics without touching snake_case", () => {
    expect(markdownToHtml("_hola_ mundo")).toContain("<i>hola</i>")
    expect(markdownToHtml("foo_bar_baz")).toBe("foo_bar_baz")
  })
})

describe("plainFromHtml", () => {
  it("strips tags and unescapes entities", () => {
    expect(plainFromHtml("<b>a &amp; b</b><br>c")).toBe("a & b\nc")
  })
})

describe("splitMarkdown", () => {
  it("returns empty for blank input", () => {
    expect(splitMarkdown("   ")).toEqual([])
  })

  it("keeps short input intact", () => {
    expect(splitMarkdown("hello", 100)).toEqual(["hello"])
  })

  it("splits long input under the limit", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${index} ${"x".repeat(20)}`)
    const chunks = splitMarkdown(lines.join("\n"), 200)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(210)
  })

  it("reopens fences in later chunks", () => {
    const code = ["```ts", ...Array.from({ length: 30 }, () => "const x = 1"), "```"].join("\n")
    const chunks = splitMarkdown(code, 120)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const fences = chunk.split("\n").filter((line) => line.startsWith("```")).length
      expect(fences % 2).toBe(0)
    }
  })
})

describe("renderChunks", () => {
  it("converts each chunk to html", () => {
    const chunks = renderChunks("**a**\n\n**b**", 5)
    expect(chunks.every((chunk) => chunk.includes("<b>"))).toBe(true)
  })
})
