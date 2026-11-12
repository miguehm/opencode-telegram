import { createServer, type Server } from "node:http"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { OpencodeApi } from "../src/opencode/api.js"

type Recorded = { method: string; path: string; query: URLSearchParams; body: string }

let server: Server
let api: OpencodeApi
let requests: Recorded[] = []
let status = 200
let payload: unknown = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      requests.push({
        method: req.method ?? "",
        path: url.pathname,
        query: url.searchParams,
        body: Buffer.concat(chunks).toString(),
      })
      res.writeHead(status, { "content-type": "application/json" })
      res.end(status === 204 ? undefined : JSON.stringify(payload))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (typeof address !== "object" || !address) throw new Error("no address")
  api = new OpencodeApi(`http://127.0.0.1:${address.port}/`)
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

beforeEach(() => {
  requests = []
  status = 200
  payload = []
})

describe("question endpoints", () => {
  it("lists legacy questions for a directory", async () => {
    payload = [{ id: "que_1", sessionID: "ses_1", questions: [] }]
    const questions = await api.listQuestions("/repo")
    expect(questions).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "GET", path: "/question" })
    expect(requests[0]?.query.get("directory")).toBe("/repo")
  })

  it("treats a missing legacy endpoint as no questions", async () => {
    status = 404
    expect(await api.listQuestions("/repo")).toEqual([])
  })

  it("lists protocol v2 questions", async () => {
    payload = { location: { directory: "/repo" }, data: [{ id: "que_2" }] }
    const questions = await api.listQuestionsV2("/repo")
    expect(questions).toHaveLength(1)
    expect(requests[0]).toMatchObject({ method: "GET", path: "/api/question/request" })
    expect(requests[0]?.query.get("location[directory]")).toBe("/repo")
  })

  it("answers a legacy question", async () => {
    payload = true
    expect(await api.replyQuestion("/repo", "que 1", [["A", "B"]])).toBe(true)
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/question/que%201/reply",
    })
    expect(requests[0]?.query.get("directory")).toBe("/repo")
    expect(JSON.parse(requests[0]?.body ?? "")).toEqual({ answers: [["A", "B"]] })
  })

  it("reports an unaccepted legacy answer", async () => {
    payload = false
    expect(await api.replyQuestion("/repo", "que_1", [["A"]])).toBe(false)
  })

  it("rejects a missing legacy question", async () => {
    status = 404
    expect(await api.rejectQuestion("/repo", "que_1")).toBe(false)
  })

  it("answers a protocol v2 question", async () => {
    expect(await api.replyQuestionV2("ses_1", "que_1", [["A"]])).toBe(true)
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/api/session/ses_1/question/que_1/reply",
    })
  })

  it("rejects a protocol v2 question", async () => {
    expect(await api.rejectQuestionV2("ses_1", "que_1")).toBe(true)
    expect(requests[0]).toMatchObject({
      method: "POST",
      path: "/api/session/ses_1/question/que_1/reject",
    })
  })
})
