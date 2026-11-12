export type OcAgent = {
  name: string
  description?: string
  mode?: "subagent" | "primary" | "all"
  builtIn?: boolean
  native?: boolean
}

export type OcCommand = {
  name: string
  description?: string
  agent?: string
  model?: string
  template?: string
}

export type OcModel = {
  id: string
  name: string
}

export type OcProvider = {
  id: string
  name?: string
  models?: Record<string, OcModel>
}

export type OcProviders = {
  providers: OcProvider[]
  default?: Record<string, string>
}

export type OcSession = {
  id: string
  title: string
  directory: string
  parentID?: string
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache?: { read: number; write: number }
  }
  time?: { created: number; updated: number }
}

export type OcPart = {
  id: string
  sessionID: string
  messageID: string
  type: string
  text?: string
  synthetic?: boolean
  tool?: string
  state?: {
    status?: string
    title?: string
    output?: string
    error?: string
    input?: Record<string, unknown>
  }
  prompt?: string
  description?: string
  agent?: string
}

export type OcMessageInfo = {
  id: string
  role: "user" | "assistant"
  sessionID: string
  error?: { name?: string; data?: { message?: string } }
  cost?: number
  tokens?: OcSession["tokens"]
  time?: { created: number; completed?: number }
}

export type OcEvent = {
  type: string
  properties: Record<string, unknown>
}

export type OcGlobalEvent = {
  directory?: string
  project?: string
  payload: OcEvent
}

export type OcPermission = {
  id: string
  type: string
  sessionID: string
  messageID?: string
  title: string
  pattern?: string | string[]
  metadata?: Record<string, unknown>
}

export type OcPty = {
  id: string
  title: string
  command: string
  args: string[]
  cwd: string
  status: "running" | "exited"
  pid: number
}

export type OcTodo = {
  id?: string
  content: string
  status: string
  priority?: string
}
