import type { Logger } from "../logger.js"
import type { OcGlobalEvent } from "./types.js"

type Listener = (event: OcGlobalEvent) => void

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class EventStream {
  private readonly listeners = new Set<Listener>()
  private controller: AbortController | undefined
  private readonly logger: Logger
  private running = false

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>,
    logger: Logger,
  ) {
    this.logger = logger.child("events")
  }

  onEvent(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.controller = new AbortController()
    void this.loop(this.controller.signal)
  }

  stop(): void {
    this.running = false
    this.controller?.abort()
    this.controller = undefined
  }

  private async loop(signal: AbortSignal): Promise<void> {
    let backoff = 1000
    while (this.running && !signal.aborted) {
      try {
        await this.consume(signal)
        backoff = 1000
      } catch (error) {
        if (signal.aborted || !this.running) return
        this.logger.warn("event stream disconnected, reconnecting", error)
      }
      if (!this.running) return
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 30_000)
    }
  }

  private async consume(signal: AbortSignal): Promise<void> {
    const response = await fetch(`${this.url}/global/event`, {
      headers: this.headers,
      signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`event stream failed with status ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n")

      let index = buffer.indexOf("\n\n")
      while (index >= 0) {
        const block = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        this.parse(block)
        index = buffer.indexOf("\n\n")
      }
    }
  }

  private parse(block: string): void {
    const dataLines: string[] = []
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (dataLines.length === 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(dataLines.join("\n"))
    } catch {
      return
    }
    if (!parsed || typeof parsed !== "object") return
    const candidate = parsed as { payload?: { type?: string } }
    if (!candidate.payload || typeof candidate.payload.type !== "string") return
    if (candidate.payload.type === "sync") return
    for (const listener of this.listeners) {
      try {
        listener(parsed as OcGlobalEvent)
      } catch (error) {
        this.logger.error("event listener failed", error)
      }
    }
  }
}
