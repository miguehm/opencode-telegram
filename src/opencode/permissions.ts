import type { Api } from "grammy"
import type { Logger } from "../logger.js"
import type { StateStore } from "../state.js"
import type { CallbackPayload, CallbackStore } from "../telegram/callbacks.js"
import { escapeHtml } from "../telegram/render.js"
import { truncate } from "../util/text.js"
import type { OpencodeApi } from "./api.js"
import type { EventStream } from "./events.js"
import type { OcEvent, OcPermission } from "./types.js"

type SentPermission = {
  chatId: number
  messageId: number
}

export class PermissionBridge {
  private readonly sent = new Map<string, SentPermission>()
  private readonly logger: Logger

  constructor(
    private readonly botApi: Api,
    private readonly opencode: OpencodeApi,
    events: EventStream,
    private readonly state: StateStore,
    private readonly callbacks: CallbackStore,
    logger: Logger,
  ) {
    this.logger = logger.child("permissions")
    events.onEvent((event) => void this.handle(event.payload, event.directory))
  }

  private async handle(event: OcEvent, directory?: string): Promise<void> {
    if (event.type !== "permission.updated") return
    const permission = event.properties as unknown as OcPermission
    if (!permission?.id || !permission.sessionID) return

    const chatIdRaw = this.state.findChatBySession(permission.sessionID)
    if (!chatIdRaw) return
    const chatId = Number(chatIdRaw)
    if (!Number.isFinite(chatId)) return

    const chat = this.state.get(chatId)
    const projectDir = chat.projectDir ?? directory
    if (!projectDir) return

    const metadata = permission.metadata ? JSON.stringify(permission.metadata, null, 2) : ""
    const pattern = permission.pattern
      ? Array.isArray(permission.pattern)
        ? permission.pattern.join(", ")
        : permission.pattern
      : ""
    const details = [
      "🔐 <b>Permiso requerido</b>",
      escapeHtml(permission.title || "Permiso"),
      pattern ? `Patrón: ${escapeHtml(pattern)}` : "",
      metadata ? `<pre>${escapeHtml(truncate(metadata, 900))}</pre>` : "",
    ]
      .filter(Boolean)
      .join("\n")

    const keyboard = this.callbacks.keyboard(chatId, [
      [
        {
          text: "Permitir",
          payload: {
            kind: "perm",
            permissionId: permission.id,
            sessionID: permission.sessionID,
            response: "once",
            directory: projectDir,
          },
        },
        {
          text: "Siempre",
          payload: {
            kind: "perm",
            permissionId: permission.id,
            sessionID: permission.sessionID,
            response: "always",
            directory: projectDir,
          },
        },
      ],
      [
        {
          text: "Rechazar",
          payload: {
            kind: "perm",
            permissionId: permission.id,
            sessionID: permission.sessionID,
            response: "reject",
            directory: projectDir,
          },
        },
      ],
    ])

    try {
      const message = await this.botApi.sendMessage(chatId, details, {
        parse_mode: "HTML",
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      })
      this.sent.set(permission.id, { chatId, messageId: message.message_id })
    } catch (error) {
      this.logger.error("could not deliver permission prompt", error)
    }
  }

  async resolve(chatId: number, payload: CallbackPayload): Promise<string> {
    const permissionId = typeof payload.permissionId === "string" ? payload.permissionId : ""
    const sessionID = typeof payload.sessionID === "string" ? payload.sessionID : ""
    const directory = typeof payload.directory === "string" ? payload.directory : ""
    const response = payload.response
    if (!permissionId || !sessionID || !directory) return "Solicitud inválida"
    if (response !== "once" && response !== "always" && response !== "reject") {
      return "Respuesta inválida"
    }

    await this.opencode.replyPermission(directory, sessionID, permissionId, response)
    const sent = this.sent.get(permissionId)
    if (sent && sent.chatId === chatId) {
      this.sent.delete(permissionId)
      try {
        await this.botApi.editMessageText(chatId, sent.messageId, "✅ Permiso respondido", {
          reply_markup: { inline_keyboard: [] },
        })
      } catch {
        // ignore
      }
    }
    return response === "reject" ? "Rechazado" : "Permitido"
  }
}
