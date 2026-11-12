import { type ChildProcessByStdio, spawn } from "node:child_process"
import type { Readable } from "node:stream"
import type { Config } from "../config.js"
import type { Logger } from "../logger.js"

export type ServerInfo = {
  url: string
  managed: boolean
}

function authHeaders(config: Config): Record<string, string> {
  if (!config.opencodeServerPassword) return {}
  const token = Buffer.from(
    `${config.opencodeServerUsername}:${config.opencodeServerPassword}`,
  ).toString("base64")
  return { authorization: `Basic ${token}` }
}

export class OpencodeServer {
  private child: ChildProcessByStdio<null, Readable, Readable> | undefined
  private info: ServerInfo | undefined
  private output: string[] = []
  private readonly logger: Logger

  constructor(
    private readonly config: Config,
    logger: Logger,
  ) {
    this.logger = logger.child("opencode")
  }

  get current(): ServerInfo {
    if (!this.info) throw new Error("opencode server is not started")
    return this.info
  }

  headers(): Record<string, string> {
    return authHeaders(this.config)
  }

  async start(): Promise<ServerInfo> {
    if (this.config.opencodeUrl) {
      const url = this.config.opencodeUrl.replace(/\/+$/, "")
      await this.waitHealthy(url)
      this.info = { url, managed: false }
      this.logger.info(`using existing server ${url}`)
      return this.info
    }

    const args = [
      "serve",
      `--hostname=${this.config.opencodeHost}`,
      `--port=${String(this.config.opencodePort)}`,
    ]
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (this.config.opencodeServerPassword) {
      env.OPENCODE_SERVER_PASSWORD = this.config.opencodeServerPassword
      env.OPENCODE_SERVER_USERNAME = this.config.opencodeServerUsername
    }

    const child = spawn("opencode", args, { env, stdio: ["ignore", "pipe", "pipe"] })
    this.child = child

    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for opencode serve\n${this.recentOutput()}`))
      }, 20_000)

      const onData = (chunk: Buffer): void => {
        const text = chunk.toString()
        this.record(text)
        const match = text.match(/opencode server listening on (https?:\/\/\S+)/)
        if (match?.[1]) {
          clearTimeout(timer)
          resolve(match[1])
        }
      }

      child.stdout.on("data", onData)
      child.stderr.on("data", (chunk: Buffer) => {
        this.record(chunk.toString())
      })
      child.on("exit", (code) => {
        clearTimeout(timer)
        reject(new Error(`opencode serve exited with code ${code}\n${this.recentOutput()}`))
      })
      child.on("error", (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })

    await this.waitHealthy(url)
    this.info = { url, managed: true }
    this.logger.info(`started managed server ${url}`)
    return this.info
  }

  async waitHealthy(url: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(`${url}/global/health`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) return
      } catch {
        // retry
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`opencode server at ${url} did not become healthy`)
  }

  private record(text: string): void {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      this.output.push(line)
      if (this.output.length > 100) this.output.shift()
      this.logger.debug(line)
    }
  }

  private recentOutput(): string {
    return this.output.slice(-20).join("\n")
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
        resolve()
      }, 5000)
      child.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill("SIGTERM")
    })
  }
}
