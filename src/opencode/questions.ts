import type { Api } from "grammy"
import type { InlineKeyboardMarkup } from "grammy/types"
import type { Logger } from "../logger.js"
import type { StateStore } from "../state.js"
import type { ButtonSpec, CallbackPayload, CallbackStore } from "../telegram/callbacks.js"
import { escapeHtml } from "../telegram/render.js"
import { oneLine, truncate } from "../util/text.js"
import type { OpencodeApi } from "./api.js"
import type { EventStream } from "./events.js"
import type { OcEvent, OcQuestionInfo, OcQuestionRequest } from "./types.js"

type Flavor = "legacy" | "v2"

type Pending = {
  requestId: string
  sessionId: string
  chatId: number
  directory: string
  flavor: Flavor
  questions: OcQuestionInfo[]
  answers: string[][]
  current: number
  messageId?: number
}

type QuestionProperties = {
  id?: string
  sessionID?: string
  requestID?: string
  questions?: OcQuestionInfo[]
}

export class QuestionBridge {
  private readonly byRequest = new Map<string, Pending>()
  private readonly awaitingText = new Map<number, { requestId: string; index: number }>()
  private readonly logger: Logger

  constructor(
    private readonly botApi: Api,
    private readonly opencode: OpencodeApi,
    events: EventStream,
    private readonly state: StateStore,
    private readonly callbacks: CallbackStore,
    logger: Logger,
  ) {
    this.logger = logger.child("questions")
    events.onEvent((event) => {
      void this.handle(event.payload, event.directory).catch((error) =>
        this.logger.error("question handler failed", error),
      )
    })
    events.onConnect(() => {
      void this.recoverAll().catch((error) => this.logger.error("question recovery failed", error))
    })
  }

  hasPendingSession(sessionID: string): boolean {
    for (const pending of this.byRequest.values()) {
      if (pending.sessionId === sessionID) return true
    }
    return false
  }

  hasPendingChat(chatId: number): boolean {
    for (const pending of this.byRequest.values()) {
      if (pending.chatId === chatId) return true
    }
    return false
  }

  async showPending(chatId: number): Promise<boolean> {
    const awaiting = this.awaitingText.get(chatId)
    if (awaiting) {
      const pending = this.byRequest.get(awaiting.requestId)
      if (pending && pending.chatId === chatId) {
        await this.renderCustom(pending, awaiting.index)
        return true
      }
    }
    const pending = [...this.byRequest.values()].filter((item) => item.chatId === chatId).at(-1)
    if (!pending) return false
    await this.renderPending(pending)
    return true
  }

  async captureText(chatId: number, text: string): Promise<boolean> {
    const awaiting = this.awaitingText.get(chatId)
    if (!awaiting) return false
    const value = text.trim()
    if (!value) return true
    this.awaitingText.delete(chatId)
    const pending = this.byRequest.get(awaiting.requestId)
    if (!pending || pending.chatId !== chatId) return true
    const question = pending.questions[awaiting.index]
    if (!question) return true
    if (question.multiple) {
      const answers = pending.answers[awaiting.index]
      if (answers && !answers.includes(value)) answers.push(value)
    } else {
      pending.answers[awaiting.index] = [value]
    }
    pending.current = awaiting.index
    await this.advance(pending)
    return true
  }

  async rejectForChat(chatId: number): Promise<number> {
    const pending = [...this.byRequest.values()].filter((item) => item.chatId === chatId)
    this.awaitingText.delete(chatId)
    let rejected = 0
    for (const item of pending) {
      if (await this.reject(item)) rejected += 1
    }
    return rejected
  }

  async resolve(chatId: number, payload: CallbackPayload): Promise<string> {
    const requestId = typeof payload.requestId === "string" ? payload.requestId : ""
    const pending = this.byRequest.get(requestId)
    if (!pending || pending.chatId !== chatId) return "Pregunta caducada"
    const action = typeof payload.action === "string" ? payload.action : ""

    if (action === "reject") {
      return (await this.reject(pending)) ? "Rechazada" : "La pregunta ya no existe"
    }
    if (action === "cancel") {
      this.awaitingText.delete(chatId)
      await this.renderPending(pending)
      return "Cancelado"
    }

    const index = typeof payload.index === "number" ? payload.index : -1
    if (!Number.isInteger(index) || index < 0 || index >= pending.questions.length) {
      return "Pregunta inválida"
    }
    if (index !== pending.current) {
      await this.renderPending(pending)
      return "Pregunta actualizada"
    }
    const question = pending.questions[index]
    if (!question) return "Pregunta inválida"

    if (action === "custom") {
      this.awaitingText.set(chatId, { requestId, index })
      await this.renderCustom(pending, index)
      return "Escribe tu respuesta"
    }
    if (action === "confirm") {
      if ((pending.answers[index]?.length ?? 0) === 0) return "Elige al menos una opción"
      await this.advance(pending)
      return "Anotado"
    }
    if (action !== "option") return "Acción inválida"

    const choice = typeof payload.choice === "number" ? payload.choice : -1
    const option = question.options[choice]
    if (!option) return "Opción inválida"
    const answers = pending.answers[index]
    if (!answers) return "Pregunta inválida"

    if (question.multiple) {
      const position = answers.indexOf(option.label)
      if (position >= 0) answers.splice(position, 1)
      else answers.push(option.label)
      await this.renderPending(pending)
      return position >= 0 ? "Desmarcado" : "Marcado"
    }

    pending.answers[index] = [option.label]
    await this.advance(pending)
    return "Anotado"
  }

  async recoverAll(): Promise<void> {
    for (const directory of this.state.directories()) {
      const before = [...this.byRequest.values()].filter(
        (pending) => pending.directory === directory,
      )
      let legacy: OcQuestionRequest[] = []
      let v2: OcQuestionRequest[] = []
      let legacyOk = true
      let v2Ok = true
      try {
        legacy = await this.opencode.listQuestions(directory)
      } catch (error) {
        legacyOk = false
        this.logger.debug("could not list pending questions", { directory, error })
      }
      try {
        v2 = await this.opencode.listQuestionsV2(directory)
      } catch (error) {
        v2Ok = false
        this.logger.debug("could not list pending v2 questions", { directory, error })
      }

      for (const request of legacy) await this.deliver(request, "legacy", directory)
      for (const request of v2) await this.deliver(request, "v2", directory)

      const knownLegacy = new Set(legacy.map((request) => request.id))
      const knownV2 = new Set(v2.map((request) => request.id))
      for (const pending of before) {
        if (this.byRequest.get(pending.requestId) !== pending) continue
        if (pending.flavor === "legacy" && !legacyOk) continue
        if (pending.flavor === "v2" && !v2Ok) continue
        const known = pending.flavor === "v2" ? knownV2 : knownLegacy
        if (known.has(pending.requestId)) continue
        this.cleanup(pending)
        await this.edit(pending, "⚠️ La pregunta ya no está disponible")
      }
    }
  }

  private async handle(event: OcEvent, directory?: string): Promise<void> {
    if (event.type === "question.asked" || event.type === "question.v2.asked") {
      const properties = event.properties as unknown as QuestionProperties
      if (!properties.id || !properties.sessionID || !properties.questions?.length) return
      const flavor: Flavor = event.type === "question.v2.asked" ? "v2" : "legacy"
      await this.deliver(
        {
          id: properties.id,
          sessionID: properties.sessionID,
          questions: properties.questions,
        },
        flavor,
        directory,
      )
      return
    }

    if (
      event.type === "question.replied" ||
      event.type === "question.rejected" ||
      event.type === "question.v2.replied" ||
      event.type === "question.v2.rejected"
    ) {
      const properties = event.properties as unknown as QuestionProperties
      if (!properties.requestID) return
      const pending = this.byRequest.get(properties.requestID)
      if (!pending) return
      this.cleanup(pending)
      const rejected = event.type.endsWith("rejected")
      await this.edit(pending, rejected ? "🚫 Pregunta rechazada" : "✅ Pregunta respondida")
    }
  }

  private async deliver(
    request: OcQuestionRequest,
    flavor: Flavor,
    directory?: string,
  ): Promise<void> {
    if (this.byRequest.has(request.id)) return
    const chatIdRaw = this.state.findChatBySession(request.sessionID)
    if (!chatIdRaw) {
      this.logger.debug("question for unknown session", { sessionID: request.sessionID })
      return
    }
    const chatId = Number(chatIdRaw)
    if (!Number.isFinite(chatId)) return
    const chat = this.state.get(chatId)
    const projectDir = chat.projectDir ?? directory
    if (!projectDir) {
      this.logger.debug("question without project directory", { sessionID: request.sessionID })
      return
    }
    const pending: Pending = {
      requestId: request.id,
      sessionId: request.sessionID,
      chatId,
      directory: projectDir,
      flavor,
      questions: request.questions,
      answers: request.questions.map(() => []),
      current: 0,
    }
    this.byRequest.set(request.id, pending)
    await this.renderPending(pending)
  }

  private build(pending: Pending): { html: string; keyboard: InlineKeyboardMarkup } {
    const question = pending.questions[pending.current]
    if (!question) {
      return { html: "⚠️ Pregunta inválida", keyboard: { inline_keyboard: [] } }
    }
    const selected = pending.answers[pending.current] ?? []
    const header = question.header ? ` · <b>${escapeHtml(truncate(question.header, 60))}</b>` : ""
    const lines = [
      `❓ <b>Pregunta ${pending.current + 1}/${pending.questions.length}</b>${header}`,
      "",
      escapeHtml(truncate(question.question, 1800)),
    ]
    if (question.options.length > 0) {
      lines.push("")
      for (const option of question.options) {
        const description = option.description
          ? ` — ${escapeHtml(truncate(option.description, 100))}`
          : ""
        lines.push(`• <b>${escapeHtml(truncate(option.label, 60))}</b>${description}`)
      }
    }
    if (question.multiple) lines.push("", "<i>Puedes elegir varias opciones.</i>")

    const rows: ButtonSpec[][] = []
    for (const [index, option] of question.options.entries()) {
      const mark = question.multiple && selected.includes(option.label) ? "✅ " : ""
      rows.push([
        {
          text: `${mark}${truncate(oneLine(option.label, 48), 48)}`,
          payload: {
            kind: "question",
            action: "option",
            requestId: pending.requestId,
            index: pending.current,
            choice: index,
          },
        },
      ])
    }
    if (question.multiple && selected.length > 0) {
      rows.push([
        {
          text: "✓ Listo",
          payload: {
            kind: "question",
            action: "confirm",
            requestId: pending.requestId,
            index: pending.current,
          },
        },
      ])
    }
    if (question.custom) {
      rows.push([
        {
          text: "✍️ Otro",
          payload: {
            kind: "question",
            action: "custom",
            requestId: pending.requestId,
            index: pending.current,
          },
        },
      ])
    }
    rows.push([
      {
        text: "🚫 Rechazar",
        payload: { kind: "question", action: "reject", requestId: pending.requestId },
      },
    ])

    return { html: lines.join("\n"), keyboard: this.callbacks.keyboard(pending.chatId, rows) }
  }

  private async renderPending(pending: Pending): Promise<void> {
    const { html, keyboard } = this.build(pending)
    if (pending.messageId && (await this.edit(pending, html, keyboard))) return
    await this.send(pending, html, keyboard)
  }

  private async renderCustom(pending: Pending, index: number): Promise<void> {
    const question = pending.questions[index]
    const lines = ["✍️ <b>Respuesta libre</b>"]
    if (question?.header) lines.push(`<b>${escapeHtml(truncate(question.header, 60))}</b>`)
    if (question) lines.push(escapeHtml(truncate(question.question, 1200)))
    lines.push("", "Envía tu respuesta como texto.")
    const html = lines.join("\n")
    const keyboard = this.callbacks.keyboard(pending.chatId, [
      [
        {
          text: "Cancelar",
          payload: {
            kind: "question",
            action: "cancel",
            requestId: pending.requestId,
            index,
          },
        },
      ],
    ])
    if (pending.messageId && (await this.edit(pending, html, keyboard))) return
    await this.send(pending, html, keyboard)
  }

  private async advance(pending: Pending): Promise<void> {
    const remaining = pending.questions.findIndex(
      (_question, index) => (pending.answers[index]?.length ?? 0) === 0,
    )
    if (remaining >= 0) {
      pending.current = remaining
      await this.renderPending(pending)
      return
    }
    const answers = pending.questions.map((_question, index) => pending.answers[index] ?? [])
    let accepted = false
    try {
      accepted =
        pending.flavor === "v2"
          ? await this.opencode.replyQuestionV2(pending.sessionId, pending.requestId, answers)
          : await this.opencode.replyQuestion(pending.directory, pending.requestId, answers)
    } catch (error) {
      this.logger.error("could not reply to question", error)
      this.cleanup(pending)
      await this.edit(pending, "⚠️ No se pudo enviar la respuesta.")
      return
    }
    this.cleanup(pending)
    await this.edit(
      pending,
      accepted ? "✅ Pregunta respondida" : "⚠️ La pregunta ya no está disponible",
    )
  }

  private async reject(pending: Pending): Promise<boolean> {
    let accepted = false
    try {
      accepted =
        pending.flavor === "v2"
          ? await this.opencode.rejectQuestionV2(pending.sessionId, pending.requestId)
          : await this.opencode.rejectQuestion(pending.directory, pending.requestId)
    } catch (error) {
      this.logger.error("could not reject question", error)
      return false
    }
    this.cleanup(pending)
    await this.edit(
      pending,
      accepted ? "🚫 Pregunta rechazada" : "⚠️ La pregunta ya no está disponible",
    )
    return accepted
  }

  private cleanup(pending: Pending): void {
    this.byRequest.delete(pending.requestId)
    const awaiting = this.awaitingText.get(pending.chatId)
    if (awaiting?.requestId === pending.requestId) this.awaitingText.delete(pending.chatId)
  }

  private async send(
    pending: Pending,
    html: string,
    keyboard: InlineKeyboardMarkup,
  ): Promise<void> {
    try {
      const message = await this.botApi.sendMessage(pending.chatId, html, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      })
      pending.messageId = message.message_id
    } catch (error) {
      this.logger.error("could not deliver question prompt", error)
    }
  }

  private async edit(
    pending: Pending,
    html: string,
    keyboard?: InlineKeyboardMarkup,
  ): Promise<boolean> {
    if (!pending.messageId) return false
    try {
      await this.botApi.editMessageText(pending.chatId, pending.messageId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard ?? { inline_keyboard: [] },
      })
      return true
    } catch (error) {
      const description = (error as { description?: string }).description ?? ""
      if (description.includes("message is not modified")) return true
      this.logger.warn("could not update question prompt", error)
      return false
    }
  }
}
