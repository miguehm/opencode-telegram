import type { OcPart } from "../opencode/types.js"
import { oneLine, truncate } from "../util/text.js"

export type RenderOptions = {
  showThinking: boolean
}

function renderTool(part: OcPart): string | undefined {
  const tool = part.tool || "tool"
  const state = part.state ?? {}
  const status = state.status ?? "pending"
  const icon = status === "completed" ? "✅" : status === "error" ? "❌" : "⏳"
  const title = oneLine(state.title || status, 100)
  const lines = [`${icon} **${tool}** ${title}`]
  if (status === "error" && state.error) {
    lines.push(`> ${oneLine(state.error, 500)}`)
  }
  return lines.join("\n")
}

export function renderParts(parts: Map<string, OcPart>, options: RenderOptions): string {
  const blocks: string[] = []
  for (const part of parts.values()) {
    switch (part.type) {
      case "text": {
        if (part.synthetic || !part.text?.trim()) continue
        blocks.push(part.text)
        break
      }
      case "reasoning": {
        if (!options.showThinking || !part.text?.trim()) continue
        blocks.push(`> 🧠 ${truncate(part.text, 1200)}`)
        break
      }
      case "tool": {
        const rendered = renderTool(part)
        if (rendered) blocks.push(rendered)
        break
      }
      case "subtask": {
        blocks.push(`↳ **${part.agent ?? "subtask"}**: ${part.description ?? ""}`)
        break
      }
      case "retry": {
        blocks.push("⏳ reintentando…")
        break
      }
      case "compaction": {
        blocks.push("🗜️ sesión compactada")
        break
      }
      default:
        break
    }
  }
  return blocks.join("\n\n").trim()
}

export function renderError(error: unknown): string {
  if (!error) return "⚠️ error desconocido"
  const value = error as { name?: string; data?: { message?: string } }
  const message = value.data?.message || "error desconocido"
  return `⚠️ **${value.name ?? "Error"}**: ${message}`
}
