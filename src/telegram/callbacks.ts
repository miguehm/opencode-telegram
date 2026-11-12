import { randomBytes } from "node:crypto"
import type { InlineKeyboardMarkup } from "grammy/types"

export type CallbackInput = {
  kind: string
  [key: string]: unknown
}

export type CallbackPayload = CallbackInput & {
  chatId: number
}

type Entry = {
  payload: CallbackPayload
  expires: number
}

export type ButtonSpec = {
  text: string
  payload: CallbackInput
}

export class CallbackStore {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly ttlMs = 15 * 60 * 1000) {}

  put(chatId: number, payload: CallbackInput): string {
    this.prune()
    const token = randomBytes(6).toString("base64url")
    this.entries.set(token, { payload: { ...payload, chatId }, expires: Date.now() + this.ttlMs })
    return token
  }

  take(chatId: number, token: string): CallbackPayload | undefined {
    const entry = this.entries.get(token)
    if (!entry) return undefined
    if (entry.expires < Date.now()) {
      this.entries.delete(token)
      return undefined
    }
    if (entry.payload.chatId !== chatId) return undefined
    this.entries.delete(token)
    return entry.payload
  }

  keyboard(chatId: number, rows: ButtonSpec[][]): InlineKeyboardMarkup {
    return {
      inline_keyboard: rows.map((row) =>
        row.map((button) => ({
          text: button.text,
          callback_data: `cb:${this.put(chatId, button.payload)}`,
        })),
      ),
    }
  }

  private prune(): void {
    const now = Date.now()
    for (const [token, entry] of this.entries) {
      if (entry.expires < now) this.entries.delete(token)
    }
  }
}
