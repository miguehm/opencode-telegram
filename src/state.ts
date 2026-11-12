import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { Logger } from "./logger.js"

const modelSchema = z.object({
  providerID: z.string(),
  modelID: z.string(),
})

const chatSchema = z.object({
  projectDir: z.string().optional(),
  sessions: z.record(z.string(), z.string()).default({}),
  agent: z.string().default("build"),
  model: modelSchema.optional(),
  thinking: z.boolean().default(false),
})

const dataSchema = z.object({
  version: z.literal(1),
  chats: z.record(z.string(), chatSchema).default({}),
})

export type ModelRef = z.infer<typeof modelSchema>
export type ChatState = z.infer<typeof chatSchema>
type StateData = z.infer<typeof dataSchema>

function emptyChat(): ChatState {
  return { sessions: {}, agent: "build", thinking: false }
}

export class StateStore {
  private data: StateData = { version: 1, chats: {} }
  private readonly file: string
  private timer: NodeJS.Timeout | undefined
  private writing: Promise<void> = Promise.resolve()
  private readonly logger: Logger

  constructor(
    private readonly dir: string,
    logger: Logger,
  ) {
    this.file = path.join(dir, "state.json")
    this.logger = logger.child("state")
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    try {
      const raw = await fs.readFile(this.file, "utf8")
      const parsed = dataSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "))
      }
      this.data = parsed.data
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT") {
        this.logger.warn("could not load state, starting fresh", error)
      }
    }
  }

  get(chatId: number | string): ChatState {
    const key = String(chatId)
    const existing = this.data.chats[key]
    if (existing) return existing
    const created = emptyChat()
    this.data.chats[key] = created
    this.scheduleSave()
    return created
  }

  update(chatId: number | string, mutator: (chat: ChatState) => void): ChatState {
    const chat = this.get(chatId)
    mutator(chat)
    this.scheduleSave()
    return chat
  }

  findChatBySession(sessionId: string): string | undefined {
    for (const [chatId, chat] of Object.entries(this.data.chats)) {
      for (const session of Object.values(chat.sessions)) {
        if (session === sessionId) return chatId
      }
    }
    return undefined
  }

  private scheduleSave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, 300)
    this.timer.unref()
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const payload = `${JSON.stringify(this.data, null, 2)}\n`
    const temp = `${this.file}.tmp`
    this.writing = this.writing.then(async () => {
      await fs.mkdir(this.dir, { recursive: true })
      await fs.writeFile(temp, payload, "utf8")
      await fs.rename(temp, this.file)
    })
    try {
      await this.writing
    } catch (error) {
      this.logger.error("failed to persist state", error)
    }
  }
}
