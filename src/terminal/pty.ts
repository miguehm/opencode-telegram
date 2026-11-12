import fs from "node:fs"
import path from "node:path"
import type { Api } from "grammy"
import stripAnsi from "strip-ansi"
import WebSocket from "ws"
import type { Logger } from "../logger.js"
import type { OpencodeApi } from "../opencode/api.js"
import type { OcPty } from "../opencode/types.js"
import type { CallbackStore } from "../telegram/callbacks.js"
import { escapeHtml } from "../telegram/render.js"
import { tail } from "../util/text.js"

const MAX_BUFFER = 12_000
const MAX_VISIBLE = 3400

export function stripPtyMeta(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: opencode prefixes PTY frames with a NUL JSON header
  return value.replace(/\u0000\{[^}]*\}/g, "")
}

export function cleanTerminalOutput(value: string): string {
  return (
    stripAnsi(stripPtyMeta(value))
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strip remaining ANSI control bytes
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
  )
}

export function resolveShell(): string {
  const candidate = process.env.SHELL
  if (candidate && !candidate.endsWith("/bash") && fs.existsSync(candidate)) return candidate
  return "bash"
}

function projectName(dir: string): string {
  return path.basename(dir)
}

export class TerminalSession {
  private ws: WebSocket | undefined
  private pty: OcPty | undefined
  private buffer = ""
  private messageId: number | undefined
  private timer: NodeJS.Timeout | undefined
  private closing = false
  private exited = false
  private readonly logger: Logger

  constructor(
    private readonly botApi: Api,
    private readonly opencode: OpencodeApi,
    private readonly serverUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly callbacks: CallbackStore,
    private readonly chatId: number,
    readonly directory: string,
    logger: Logger,
  ) {
    this.logger = logger.child("pty")
  }

  async open(): Promise<void> {
    this.pty = await this.opencode.createPty(this.directory, {
      command: resolveShell(),
      args: [],
      title: `tg:${this.chatId}`,
    })
    const wsUrl = `${this.serverUrl.replace(/^http/, "ws")}/pty/${this.pty.id}/connect?directory=${encodeURIComponent(this.directory)}`
    const ws = new WebSocket(wsUrl, { headers: this.authHeaders })
    this.ws = ws

    ws.on("open", () => {
      this.buffer += `$ ${this.pty?.command ?? "shell"} · ${this.directory}\n`
      this.schedule()
    })
    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : Buffer.from(data as Buffer).toString("utf8")
      this.buffer += cleanTerminalOutput(text)
      if (this.buffer.length > MAX_BUFFER) this.buffer = tail(this.buffer, MAX_BUFFER)
      this.schedule()
    })
    ws.on("close", () => {
      this.exited = true
      this.buffer += "\n[terminal cerrada]"
      this.schedule()
    })
    ws.on("error", (error) => {
      this.logger.warn("pty socket error", error)
      this.buffer += `\n[error: ${error.message}]`
      this.schedule()
    })

    await this.render(true)
  }

  sendLine(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    for (const line of text.split("\n")) {
      this.ws.send(`${line}\r`)
    }
  }

  sendKey(name: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const keys: Record<string, string> = {
      "ctrl-c": "\u0003",
      "ctrl-d": "\u0004",
      "ctrl-z": "\u001a",
      tab: "\t",
      esc: "\u001b",
      enter: "\r",
      up: "\u001b[A",
      down: "\u001b[B",
      right: "\u001b[C",
      left: "\u001b[D",
    }
    const value = keys[name]
    if (value) this.ws.send(value)
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    if (this.pty) {
      try {
        await this.opencode.removePty(this.directory, this.pty.id)
      } catch (error) {
        this.logger.debug("pty remove failed", error)
      }
    }
    this.exited = true
    await this.render(true)
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.render(false)
    }, 1200)
    this.timer.unref()
  }

  private async render(force: boolean): Promise<void> {
    if (this.closing && !force && this.exited) return
    const visible = tail(this.buffer, MAX_VISIBLE)
    const status = this.exited
      ? "\n_[proceso terminado]_"
      : "\n_Envía texto para escribir · /exit para cerrar_"
    const text = `🖥️ **Terminal** · \`${escapeHtml(projectName(this.directory))}\`\n<pre>${escapeHtml(visible)}</pre>${status}`
    const keyboard = this.exited
      ? undefined
      : this.callbacks.keyboard(this.chatId, [
          [
            { text: "Ctrl+C", payload: { kind: "pty", action: "ctrl-c" } },
            { text: "Ctrl+D", payload: { kind: "pty", action: "ctrl-d" } },
            { text: "Salir", payload: { kind: "pty", action: "close" } },
          ],
        ])

    try {
      if (this.messageId === undefined) {
        const message = await this.botApi.sendMessage(this.chatId, text, {
          parse_mode: "HTML",
          ...(keyboard ? { reply_markup: keyboard } : {}),
        })
        this.messageId = message.message_id
      } else {
        await this.botApi.editMessageText(this.chatId, this.messageId, text, {
          parse_mode: "HTML",
          ...(keyboard ? { reply_markup: keyboard } : {}),
        })
      }
    } catch (error) {
      const description = (error as { description?: string }).description ?? ""
      if (!description.includes("message is not modified")) {
        this.logger.debug("terminal render failed", error)
      }
    }
  }
}

export class TerminalManager {
  private readonly sessions = new Map<number, TerminalSession>()

  constructor(
    private readonly botApi: Api,
    private readonly opencode: OpencodeApi,
    private readonly serverUrl: string,
    private readonly authHeaders: Record<string, string>,
    private readonly callbacks: CallbackStore,
    private readonly logger: Logger,
  ) {}

  get(chatId: number): TerminalSession | undefined {
    return this.sessions.get(chatId)
  }

  async open(chatId: number, directory: string): Promise<TerminalSession> {
    const existing = this.sessions.get(chatId)
    if (existing) {
      if (existing.directory === directory) return existing
      await existing.close()
      this.sessions.delete(chatId)
    }
    const session = new TerminalSession(
      this.botApi,
      this.opencode,
      this.serverUrl,
      this.authHeaders,
      this.callbacks,
      chatId,
      directory,
      this.logger,
    )
    await session.open()
    this.sessions.set(chatId, session)
    return session
  }

  async close(chatId: number): Promise<boolean> {
    const session = this.sessions.get(chatId)
    if (!session) return false
    this.sessions.delete(chatId)
    await session.close()
    return true
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(sessions.map((session) => session.close().catch(() => undefined)))
  }
}
