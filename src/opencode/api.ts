import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk"
import type {
  OcAgent,
  OcCommand,
  OcMessageInfo,
  OcModel,
  OcPart,
  OcProvider,
  OcProviders,
  OcPty,
  OcQuestionRequest,
  OcSession,
  OcTodo,
} from "./types.js"

export type PromptBody = {
  text: string
  agent: string
  model?: { providerID: string; modelID: string }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "NotFoundError"
}

export class OpencodeApi {
  private readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly cache = new Map<string, OpencodeClient>()

  constructor(baseUrl: string, headers: Record<string, string> = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.headers = headers
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit = {},
    directory?: string,
    query?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (directory) url.searchParams.set("directory", directory)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    const headers: Record<string, string> = { ...this.headers }
    if (init.body !== undefined) headers["content-type"] = "application/json"
    const response = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    })
    if (response.status === 404) {
      const error = new Error(`opencode request not found: ${path}`)
      error.name = "NotFoundError"
      throw error
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      const suffix = body ? `: ${body.slice(0, 300)}` : ""
      throw new Error(`opencode request failed (${response.status}) ${path}${suffix}`)
    }
    if (response.status === 204) return undefined as T
    const text = await response.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }

  client(directory?: string): OpencodeClient {
    const key = directory ?? ""
    const cached = this.cache.get(key)
    if (cached) return cached
    const client = createOpencodeClient({
      baseUrl: this.baseUrl,
      headers: this.headers,
      responseStyle: "data",
      ...(directory ? { directory } : {}),
    })
    this.cache.set(key, client)
    return client
  }

  async agents(directory: string): Promise<OcAgent[]> {
    const raw = await this.client(directory).app.agents({ throwOnError: true })
    return (raw as unknown as OcAgent[]).map((agent) => ({
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
      ...(agent.mode ? { mode: agent.mode } : {}),
      ...(agent.builtIn !== undefined ? { builtIn: agent.builtIn } : {}),
      ...(agent.native !== undefined ? { builtIn: agent.native } : {}),
    }))
  }

  async commands(directory: string): Promise<OcCommand[]> {
    const raw = await this.client(directory).command.list({ throwOnError: true })
    return raw as unknown as OcCommand[]
  }

  async providers(directory: string): Promise<OcProviders> {
    const raw = await this.client(directory).config.providers({ throwOnError: true })
    const providers = raw as unknown as {
      providers: OcProvider[]
      default?: Record<string, string>
    }
    return {
      providers: providers.providers ?? [],
      ...(providers.default ? { default: providers.default } : {}),
    }
  }

  async listSessions(directory: string): Promise<OcSession[]> {
    const raw = await this.client(directory).session.list({ throwOnError: true })
    return raw as unknown as OcSession[]
  }

  async getSession(directory: string, id: string): Promise<OcSession> {
    const raw = await this.client(directory).session.get({
      path: { id },
      throwOnError: true,
    })
    return raw as unknown as OcSession
  }

  async createSession(directory: string, title: string): Promise<OcSession> {
    const raw = await this.client(directory).session.create({
      body: { title },
      throwOnError: true,
    })
    return raw as unknown as OcSession
  }

  async deleteSession(directory: string, id: string): Promise<void> {
    await this.client(directory).session.delete({ path: { id }, throwOnError: true })
  }

  async renameSession(directory: string, id: string, title: string): Promise<void> {
    await this.client(directory).session.update({
      path: { id },
      body: { title },
      throwOnError: true,
    })
  }

  async abortSession(directory: string, id: string): Promise<void> {
    await this.client(directory).session.abort({ path: { id }, throwOnError: true })
  }

  async summarizeSession(directory: string, id: string): Promise<void> {
    await this.client(directory).session.summarize({ path: { id }, throwOnError: true })
  }

  async promptAsync(directory: string, id: string, body: PromptBody): Promise<void> {
    await this.client(directory).session.promptAsync({
      path: { id },
      body: {
        agent: body.agent,
        ...(body.model ? { model: body.model } : {}),
        parts: [{ type: "text", text: body.text }],
      },
      throwOnError: true,
    })
  }

  async runCommand(
    directory: string,
    id: string,
    command: string,
    args: string,
    agent?: string,
  ): Promise<void> {
    await this.client(directory).session.command({
      path: { id },
      body: { command, arguments: args, ...(agent ? { agent } : {}) },
      throwOnError: true,
    })
  }

  async runShell(directory: string, id: string, command: string, agent: string): Promise<void> {
    await this.client(directory).session.shell({
      path: { id },
      body: { command, agent },
      throwOnError: true,
    })
  }

  async messages(
    directory: string,
    id: string,
    limit = 1,
  ): Promise<Array<{ info: OcMessageInfo; parts: OcPart[] }>> {
    const raw = await this.client(directory).session.messages({
      path: { id },
      query: { limit },
      throwOnError: true,
    })
    return raw as unknown as Array<{ info: OcMessageInfo; parts: OcPart[] }>
  }

  async diff(
    directory: string,
    id: string,
  ): Promise<
    Array<{ file: string; before: string; after: string; additions: number; deletions: number }>
  > {
    const raw = await this.client(directory).session.diff({
      path: { id },
      throwOnError: true,
    })
    return raw as unknown as Array<{
      file: string
      before: string
      after: string
      additions: number
      deletions: number
    }>
  }

  async todos(directory: string, id: string): Promise<OcTodo[]> {
    const raw = await this.client(directory).session.todo({
      path: { id },
      throwOnError: true,
    })
    return raw as unknown as OcTodo[]
  }

  async fileList(
    directory: string,
    target: string,
  ): Promise<Array<{ name: string; path: string; type: string; ignored?: boolean }>> {
    const raw = await this.client(directory).file.list({
      query: { path: target },
      throwOnError: true,
    })
    return raw as unknown as Array<{ name: string; path: string; type: string; ignored?: boolean }>
  }

  async fileRead(directory: string, target: string): Promise<{ type: string; content: string }> {
    const raw = await this.client(directory).file.read({
      query: { path: target },
      throwOnError: true,
    })
    return raw as unknown as { type: string; content: string }
  }

  async findFiles(directory: string, query: string): Promise<string[]> {
    const raw = await this.client(directory).find.files({
      query: { query, dirs: "false" },
      throwOnError: true,
    })
    return raw as unknown as string[]
  }

  async replyPermission(
    directory: string,
    sessionID: string,
    permissionID: string,
    response: "once" | "always" | "reject",
  ): Promise<void> {
    await this.client(directory).postSessionIdPermissionsPermissionId({
      path: { id: sessionID, permissionID },
      body: { response },
      throwOnError: true,
    })
  }

  async listQuestions(directory: string): Promise<OcQuestionRequest[]> {
    try {
      const raw = await this.fetchJson<OcQuestionRequest[]>("/question", {}, directory)
      return raw ?? []
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  }

  async listQuestionsV2(directory: string): Promise<OcQuestionRequest[]> {
    try {
      const raw = await this.fetchJson<{ data?: OcQuestionRequest[] }>(
        "/api/question/request",
        {},
        undefined,
        { "location[directory]": directory },
      )
      return raw?.data ?? []
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  }

  async replyQuestion(directory: string, requestID: string, answers: string[][]): Promise<boolean> {
    try {
      const accepted = await this.fetchJson<boolean>(
        `/question/${encodeURIComponent(requestID)}/reply`,
        { method: "POST", body: JSON.stringify({ answers }) },
        directory,
      )
      return accepted !== false
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  async rejectQuestion(directory: string, requestID: string): Promise<boolean> {
    try {
      const accepted = await this.fetchJson<boolean>(
        `/question/${encodeURIComponent(requestID)}/reject`,
        { method: "POST" },
        directory,
      )
      return accepted !== false
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  async replyQuestionV2(
    sessionID: string,
    requestID: string,
    answers: string[][],
  ): Promise<boolean> {
    try {
      await this.fetchJson(
        `/api/session/${encodeURIComponent(sessionID)}/question/${encodeURIComponent(requestID)}/reply`,
        { method: "POST", body: JSON.stringify({ answers }) },
      )
      return true
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  async rejectQuestionV2(sessionID: string, requestID: string): Promise<boolean> {
    try {
      await this.fetchJson(
        `/api/session/${encodeURIComponent(sessionID)}/question/${encodeURIComponent(requestID)}/reject`,
        { method: "POST" },
      )
      return true
    } catch (error) {
      if (isNotFound(error)) return false
      throw error
    }
  }

  async createPty(
    directory: string,
    body: { command: string; args?: string[]; title?: string },
  ): Promise<OcPty> {
    const raw = await this.client(directory).pty.create({
      body: {
        command: body.command,
        args: body.args ?? [],
        ...(body.title ? { title: body.title } : {}),
      },
      throwOnError: true,
    })
    return raw as unknown as OcPty
  }

  async removePty(directory: string, id: string): Promise<void> {
    await this.client(directory).pty.remove({ path: { id }, throwOnError: true })
  }

  models(providers: OcProviders): Array<{ providerID: string; model: OcModel }> {
    const result: Array<{ providerID: string; model: OcModel }> = []
    for (const provider of providers.providers) {
      for (const model of Object.values(provider.models ?? {})) {
        result.push({ providerID: provider.id, model })
      }
    }
    return result
  }
}
