export const MAX_MESSAGE = 3800
const PLACEHOLDER = "\u0000BLOCK"

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function renderInline(value: string): string {
  let result = value
  result = result.replace(/`([^`\n]+)`/g, "<code>$1</code>")
  result = result.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
  result = result.replace(/__([^_\n]+)__/g, "<b>$1</b>")
  result = result.replace(/(^|[^\w])_([^_\n]+)_(?![\w])/g, "$1<i>$2</i>")
  result = result.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<i>$2</i>")
  result = result.replace(/~~([^~\n]+)~~/g, "<s>$1</s>")
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
  result = result.replace(/^&gt;\s?(.*)$/gm, "▎ $1")
  return result
}

export function markdownToHtml(markdown: string): string {
  const blocks: string[] = []
  const withPlaceholders = markdown.replace(
    /```([\w-]*)\n([\s\S]*?)```/g,
    (_match, lang: string, code: string) => {
      const index = blocks.length
      const language = lang ? ` class="language-${escapeHtml(lang)}"` : ""
      blocks.push(`<pre><code${language}>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`)
      return `${PLACEHOLDER}${index}\u0000`
    },
  )

  const escaped = escapeHtml(withPlaceholders)
  const formatted = renderInline(escaped)
  return formatted.replace(
    new RegExp(`${PLACEHOLDER}(\\d+)\\u0000`, "g"),
    (_match, index: string) => blocks[Number(index)] ?? "",
  )
}

export function plainFromHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(pre|p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function splitMarkdown(markdown: string, limit = 3200): string[] {
  const normalized = markdown.replace(/\r\n/g, "\n").trim()
  if (!normalized) return []
  if (normalized.length <= limit) return [normalized]

  const chunks: string[] = []
  let current: string[] = []
  let currentLength = 0
  let fence: string | undefined

  const flush = (): void => {
    if (current.length === 0) return
    if (fence) current.push("```")
    chunks.push(current.join("\n").trim())
    current = []
    currentLength = 0
    if (fence) {
      current.push(fence)
      currentLength = fence.length + 1
    }
  }

  const appendLine = (line: string): void => {
    const size = line.length + 1
    if (currentLength + size > limit && current.length > 0) flush()

    if (line.length + 1 > limit) {
      let rest = line
      while (rest.length > limit) {
        const piece = rest.slice(0, limit)
        current.push(piece)
        flush()
        rest = rest.slice(limit)
      }
      if (rest) {
        current.push(rest)
        currentLength += rest.length + 1
      }
      return
    }

    current.push(line)
    currentLength += size
  }

  for (const line of normalized.split("\n")) {
    const isFence = /^```/.test(line)
    appendLine(line)
    if (isFence) {
      fence = fence ? undefined : line.trim()
    }
  }

  if (current.length > 0) {
    if (fence) current.push("```")
    chunks.push(current.join("\n").trim())
  }

  return chunks.filter(Boolean)
}

export function renderChunks(markdown: string, limit = 3200): string[] {
  return splitMarkdown(markdown, limit).map((chunk) => markdownToHtml(chunk))
}

export function codeBlock(value: string): string {
  return `<pre>${escapeHtml(value)}</pre>`
}
