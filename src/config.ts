import os from "node:os"
import path from "node:path"
import { z } from "zod"

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_ALLOWED_USERS: z.string().min(1, "TELEGRAM_ALLOWED_USERS is required"),
  TRY_PATH: z.string().optional(),
  TRY_BIN: z.string().default("try"),
  OPENCODE_URL: z.string().url().optional(),
  OPENCODE_HOST: z.string().default("127.0.0.1"),
  OPENCODE_PORT: z.coerce.number().int().positive().max(65535).default(4096),
  OPENCODE_SERVER_PASSWORD: z.string().optional(),
  OPENCODE_SERVER_USERNAME: z.string().default("opencode"),
  STATE_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TERM_COLS: z.coerce.number().int().positive().default(120),
  TERM_ROWS: z.coerce.number().int().positive().default(40),
})

export type LogLevel = "debug" | "info" | "warn" | "error"

export type Config = {
  botToken: string
  allowedUsers: Set<number>
  tryPath: string
  tryBin: string
  opencodeUrl?: string
  opencodeHost: string
  opencodePort: number
  opencodeServerPassword?: string
  opencodeServerUsername: string
  stateDir: string
  logLevel: LogLevel
  termCols: number
  termRows: number
}

export function expandHome(value: string): string {
  if (value === "~") return os.homedir()
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2))
  return value
}

export function parseUserList(value: string): Set<number> {
  const users = value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))

  for (const user of users) {
    if (!Number.isSafeInteger(user) || user <= 0) {
      throw new Error(`Invalid Telegram user id: ${user}`)
    }
  }
  return new Set(users)
}

export function defaultStateDir(): string {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  return path.join(base, "opencode-telegram")
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n")
    throw new Error(`Invalid configuration:\n${details}`)
  }

  const value = parsed.data
  const tryPath = path.resolve(
    expandHome(value.TRY_PATH || path.join(os.homedir(), "src", "tries")),
  )
  const stateDir = path.resolve(expandHome(value.STATE_DIR || defaultStateDir()))

  return {
    botToken: value.TELEGRAM_BOT_TOKEN,
    allowedUsers: parseUserList(value.TELEGRAM_ALLOWED_USERS),
    tryPath,
    tryBin: value.TRY_BIN,
    ...(value.OPENCODE_URL ? { opencodeUrl: value.OPENCODE_URL } : {}),
    opencodeHost: value.OPENCODE_HOST,
    opencodePort: value.OPENCODE_PORT,
    ...(value.OPENCODE_SERVER_PASSWORD
      ? { opencodeServerPassword: value.OPENCODE_SERVER_PASSWORD }
      : {}),
    opencodeServerUsername: value.OPENCODE_SERVER_USERNAME,
    stateDir,
    logLevel: value.LOG_LEVEL,
    termCols: value.TERM_COLS,
    termRows: value.TERM_ROWS,
  }
}
