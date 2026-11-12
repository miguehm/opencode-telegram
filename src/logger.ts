import type { LogLevel } from "./config.js"

const priority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export type Logger = {
  debug(message: string, extra?: unknown): void
  info(message: string, extra?: unknown): void
  warn(message: string, extra?: unknown): void
  error(message: string, extra?: unknown): void
  child(prefix: string): Logger
}

function write(level: LogLevel, prefix: string, message: string, extra?: unknown): void {
  const stamp = new Date().toISOString()
  const label = prefix ? `${prefix} ` : ""
  const suffix =
    extra === undefined ? "" : ` ${typeof extra === "string" ? extra : safeStringify(extra)}`
  process.stderr.write(`${stamp} ${level.toUpperCase()} ${label}${message}${suffix}\n`)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function createLogger(level: LogLevel, prefix = ""): Logger {
  const threshold = priority[level]

  const make = (currentPrefix: string): Logger => ({
    debug(message, extra) {
      if (threshold <= priority.debug) write("debug", currentPrefix, message, extra)
    },
    info(message, extra) {
      if (threshold <= priority.info) write("info", currentPrefix, message, extra)
    },
    warn(message, extra) {
      if (threshold <= priority.warn) write("warn", currentPrefix, message, extra)
    },
    error(message, extra) {
      if (threshold <= priority.error) write("error", currentPrefix, message, extra)
    },
    child(childPrefix) {
      return make(`${currentPrefix}${childPrefix}:`)
    },
  })

  return make(prefix)
}
