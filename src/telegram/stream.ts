import type { Api } from "grammy"
import type { Logger } from "../logger.js"
import { plainFromHtml, renderChunks } from "./render.js"

type MessageRef = {
  id: number
  html: string
}

export class StreamResponder {
  private markdown = ""
  private readonly messages: MessageRef[] = []
  private timer: NodeJS.Timeout | undefined
  private busy = false
  private dirty = false

  constructor(
    private readonly api: Api,
    private readonly chatId: number,
    private readonly logger: Logger,
    private readonly throttleMs = 1000,
  ) {}

  set(markdown: string): void {
    this.markdown = markdown
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, this.throttleMs)
  }

  private async flush(): Promise<void> {
    if (this.busy) {
      this.dirty = true
      return
    }
    this.busy = true
    try {
      do {
        this.dirty = false
        await this.renderOnce()
      } while (this.dirty)
    } catch (error) {
      this.logger.error("stream flush failed", error)
    } finally {
      this.busy = false
    }
  }

  private async renderOnce(): Promise<void> {
    const htmlChunks = renderChunks(this.markdown)
    for (let index = 0; index < htmlChunks.length; index += 1) {
      const html = htmlChunks[index]
      if (html === undefined) continue
      const existing = this.messages[index]
      if (!existing) {
        const sent = await this.send(html)
        this.messages.push({ id: sent, html })
        continue
      }
      if (existing.html === html) continue
      await this.edit(existing.id, html)
      existing.html = html
    }
  }

  private async send(html: string): Promise<number> {
    try {
      const message = await this.api.sendMessage(this.chatId, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      })
      return message.message_id
    } catch (error) {
      this.logger.warn("HTML send failed, retrying as plain text", error)
      const message = await this.api.sendMessage(this.chatId, plainFromHtml(html), {
        link_preview_options: { is_disabled: true },
      })
      return message.message_id
    }
  }

  private async edit(id: number, html: string): Promise<void> {
    try {
      await this.api.editMessageText(this.chatId, id, html, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      })
    } catch (error) {
      const description = (error as { description?: string }).description ?? ""
      if (description.includes("message is not modified")) return
      if (description.includes("message to edit not found")) {
        const sent = await this.send(html)
        const ref = this.messages.find((item) => item.id === id)
        if (ref) ref.id = sent
        return
      }
      this.logger.warn("HTML edit failed, retrying as plain text", error)
      try {
        await this.api.editMessageText(this.chatId, id, plainFromHtml(html), {
          link_preview_options: { is_disabled: true },
        })
      } catch (retryError) {
        const retryDescription = (retryError as { description?: string }).description ?? ""
        if (!retryDescription.includes("message is not modified")) {
          this.logger.error("plain edit failed", retryError)
        }
      }
    }
  }

  async finish(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    while (this.busy) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    await this.flush()
  }
}
