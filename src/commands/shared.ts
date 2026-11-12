import path from "node:path"
import type { Api, Context } from "grammy"
import type { App } from "../app.js"
import type { OcSession } from "../opencode/types.js"
import type { ChatState } from "../state.js"
import { markdownToHtml, plainFromHtml, renderChunks } from "../telegram/render.js"
import { displayPath } from "../util/paths.js"
import type { View } from "./views.js"

export function chatIdOf(ctx: Context): number {
  const id = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id
  if (!id) throw new Error("No se pudo determinar el chat")
  return id
}

export function commandArg(ctx: Context): string {
  return typeof ctx.match === "string" ? ctx.match.trim() : ""
}

export function projectName(dir: string): string {
  return path.basename(dir)
}

export function errorMessage(error: unknown): string {
  const value = error as { message?: string; data?: { message?: string } }
  return value.data?.message || value.message || String(error)
}

export async function replyMarkdown(ctx: Context, markdown: string): Promise<void> {
  const chunks = renderChunks(markdown)
  if (chunks.length === 0) {
    await ctx.reply("_vacío_", { parse_mode: "HTML" })
    return
  }
  for (const chunk of chunks) {
    await ctx.reply(chunk, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
  }
}

export async function replyHtml(ctx: Context, html: string): Promise<void> {
  try {
    await ctx.reply(html, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
  } catch {
    await ctx.reply(plainFromHtml(html), { link_preview_options: { is_disabled: true } })
  }
}

export async function sendMarkdown(api: Api, chatId: number, markdown: string): Promise<void> {
  const chunks = renderChunks(markdown)
  for (const chunk of chunks) {
    await api.sendMessage(chatId, chunk, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    })
  }
}

export async function sendPlain(api: Api, chatId: number, text: string): Promise<void> {
  await api.sendMessage(chatId, text, { link_preview_options: { is_disabled: true } })
}

export async function requireProject(
  app: App,
  ctx: Context,
): Promise<{ chat: ChatState; dir: string } | undefined> {
  const chatId = chatIdOf(ctx)
  const chat = app.state.get(chatId)
  if (!chat.projectDir) {
    await replyMarkdown(ctx, "Selecciona un proyecto primero con `/projects` o `/use <nombre>`.")
    return undefined
  }
  return { chat, dir: chat.projectDir }
}

export async function ensureSession(app: App, chatId: number, dir: string): Promise<OcSession> {
  const chat = app.state.get(chatId)
  const existing = chat.sessions[dir]
  if (existing) {
    try {
      return await app.opencode.getSession(dir, existing)
    } catch {
      app.state.update(chatId, (state) => {
        delete state.sessions[dir]
      })
    }
  }

  const title = `${projectName(dir)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`
  const session = await app.opencode.createSession(dir, title)
  app.state.update(chatId, (state) => {
    state.sessions[dir] = session.id
    state.projectDir = dir
  })
  return session
}

export async function currentSession(
  app: App,
  chatId: number,
  dir: string,
): Promise<OcSession | undefined> {
  const chat = app.state.get(chatId)
  const id = chat.sessions[dir]
  if (!id) return undefined
  try {
    return await app.opencode.getSession(dir, id)
  } catch {
    return undefined
  }
}

export async function replyView(ctx: Context, view: View): Promise<void> {
  await ctx.reply(markdownToHtml(view.text), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(view.keyboard ? { reply_markup: view.keyboard } : {}),
  })
}

export async function editView(ctx: Context, view: View): Promise<void> {
  try {
    await ctx.editMessageText(markdownToHtml(view.text), {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: view.keyboard ?? { inline_keyboard: [] },
    })
  } catch (error) {
    const description = (error as { description?: string }).description ?? ""
    if (description.includes("message is not modified")) return
    throw error
  }
}

export function projectSummary(dir: string, extra?: string): string {
  const lines = [`📁 Proyecto activo: \`${displayPath(dir)}\``]
  if (extra) lines.push(extra)
  lines.push("", "Usa `/p` para el menú o `/status` para ver el estado.")
  return lines.join("\n")
}
