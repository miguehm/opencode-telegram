import type { Api } from "grammy"
import type { Logger } from "../logger.js"
import type { OpencodeApi } from "../opencode/api.js"
import type { EventStream } from "../opencode/events.js"
import type { OcEvent, OcMessageInfo, OcPart } from "../opencode/types.js"
import { StreamResponder } from "../telegram/stream.js"
import { renderError, renderParts } from "./render-parts.js"

type Turn = {
  chatId: number
  directory: string
  sessionId: string
  responder: StreamResponder
  parts: Map<string, OcPart>
  pending: Map<string, OcPart[]>
  assistantMessages: Set<string>
  showThinking: boolean
  typingTimer: NodeJS.Timeout | undefined
  errorMarkdown: string
  startedAt: number
  ended: boolean
}

export class TurnManager {
  private readonly bySession = new Map<string, Turn>()
  private readonly byChat = new Map<number, Turn>()

  constructor(
    private readonly botApi: Api,
    private readonly opencode: OpencodeApi,
    events: EventStream,
    private readonly logger: Logger,
  ) {
    events.onEvent((event) => this.handle(event))
  }

  isBusy(chatId: number): boolean {
    return this.byChat.has(chatId)
  }

  start(chatId: number, directory: string, sessionId: string, showThinking: boolean): void {
    if (this.byChat.has(chatId)) {
      throw new Error("Ya hay una respuesta en curso. Usa /abort para detenerla.")
    }
    const turn: Turn = {
      chatId,
      directory,
      sessionId,
      responder: new StreamResponder(this.botApi, chatId, this.logger.child("stream")),
      parts: new Map(),
      pending: new Map(),
      assistantMessages: new Set(),
      showThinking,
      typingTimer: undefined,
      errorMarkdown: "",
      startedAt: Date.now(),
      ended: false,
    }
    this.bySession.set(sessionId, turn)
    this.byChat.set(chatId, turn)
    this.startTyping(turn)
    turn.responder.set("…")
  }

  async abort(chatId: number): Promise<boolean> {
    const turn = this.byChat.get(chatId)
    if (!turn) return false
    try {
      await this.opencode.abortSession(turn.directory, turn.sessionId)
    } catch (error) {
      this.logger.warn("failed to abort session", { error, chatId })
    }
    const timer = setTimeout(() => {
      if (!turn.ended) void this.finish(turn)
    }, 2500)
    timer.unref()
    return true
  }

  async fail(chatId: number, message: string): Promise<boolean> {
    const turn = this.byChat.get(chatId)
    if (!turn || turn.ended) return false
    turn.errorMarkdown = message
    await this.finish(turn, false)
    return true
  }

  private startTyping(turn: Turn): void {
    if (turn.typingTimer) return
    void this.botApi.sendChatAction(turn.chatId, "typing").catch(() => undefined)
    turn.typingTimer = setInterval(() => {
      void this.botApi.sendChatAction(turn.chatId, "typing").catch(() => undefined)
    }, 5000)
    turn.typingTimer.unref()
  }

  private stopTyping(turn: Turn): void {
    if (turn.typingTimer) {
      clearInterval(turn.typingTimer)
      turn.typingTimer = undefined
    }
  }

  private handle(event: { payload: OcEvent }): void {
    const payload = event.payload
    const properties = payload.properties as Record<string, unknown>
    const eventInfo = properties.info as { sessionID?: string } | undefined
    const eventPart = properties.part as { sessionID?: string } | undefined
    const sessionID =
      (typeof properties.sessionID === "string" ? properties.sessionID : undefined) ??
      eventInfo?.sessionID ??
      eventPart?.sessionID
    if (!sessionID) return
    const turn = this.bySession.get(sessionID)
    if (!turn) return

    switch (payload.type) {
      case "message.updated": {
        const info = properties.info as OcMessageInfo | undefined
        if (!info) return
        if (info.role === "assistant") {
          turn.assistantMessages.add(info.id)
          const buffered = turn.pending.get(info.id)
          if (buffered) {
            for (const part of buffered) turn.parts.set(part.id, part)
            turn.pending.delete(info.id)
          }
          if (info.error) turn.errorMarkdown = renderError(info.error)
          this.update(turn)
        }
        return
      }
      case "message.part.updated": {
        const part = properties.part as OcPart | undefined
        if (!part?.id) return
        if (!turn.assistantMessages.has(part.messageID)) {
          const list = turn.pending.get(part.messageID) ?? []
          const index = list.findIndex((item) => item.id === part.id)
          if (index >= 0) list[index] = part
          else list.push(part)
          turn.pending.set(part.messageID, list)
          return
        }
        const previous = turn.parts.get(part.id)
        if (!part.text && previous?.type === "text" && typeof properties.delta === "string") {
          part.text = previous.text + properties.delta
        }
        turn.parts.set(part.id, part)
        this.update(turn)
        return
      }
      case "session.status": {
        const status = properties.status as { type?: string } | undefined
        if (status?.type === "busy" || status?.type === "retry") this.startTyping(turn)
        if (status?.type === "idle") void this.finish(turn)
        return
      }
      case "session.idle": {
        void this.finish(turn)
        return
      }
      case "session.error": {
        turn.errorMarkdown = renderError(properties.error)
        this.update(turn)
        const timer = setTimeout(() => {
          if (!turn.ended) void this.finish(turn)
        }, 1500)
        timer.unref()
        return
      }
      default:
        return
    }
  }

  private update(turn: Turn): void {
    if (turn.ended) return
    const markdown = [
      renderParts(turn.parts, { showThinking: turn.showThinking }),
      turn.errorMarkdown,
    ]
      .filter(Boolean)
      .join("\n\n")
    turn.responder.set(markdown || "…")
  }

  private async finish(turn: Turn, fetchFallback = true): Promise<void> {
    if (turn.ended) return
    turn.ended = true
    this.stopTyping(turn)

    for (const list of turn.pending.values()) {
      for (const part of list) turn.parts.set(part.id, part)
    }
    turn.pending.clear()

    if (fetchFallback && turn.parts.size === 0) {
      try {
        const messages = await this.opencode.messages(turn.directory, turn.sessionId, 1)
        const last = messages.at(-1)
        if (last?.info.role === "assistant" && (last.info.time?.created ?? 0) >= turn.startedAt) {
          for (const part of last.parts) turn.parts.set(part.id, part)
          if (last.info.error) turn.errorMarkdown = renderError(last.info.error)
        }
      } catch (error) {
        this.logger.debug("fallback message fetch failed", error)
      }
    }

    const markdown =
      [renderParts(turn.parts, { showThinking: turn.showThinking }), turn.errorMarkdown]
        .filter(Boolean)
        .join("\n\n") || "_(sin respuesta)_"
    turn.responder.set(markdown)
    await turn.responder.finish()

    this.bySession.delete(turn.sessionId)
    if (this.byChat.get(turn.chatId) === turn) this.byChat.delete(turn.chatId)
  }
}
