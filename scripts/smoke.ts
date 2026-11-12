import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { loadConfig } from "../src/config.js"
import { createLogger } from "../src/logger.js"
import { OpencodeApi } from "../src/opencode/api.js"
import { OpencodeServer } from "../src/opencode/server.js"
import { ProjectRegistry } from "../src/projects/registry.js"

const run = promisify(execFile)

async function main(): Promise<void> {
  const config = loadConfig()
  const logger = createLogger("info", "smoke")
  const server = new OpencodeServer(config, logger)

  try {
    const tryVersion = await run(config.tryBin, ["--version"], { timeout: 5000 })
      .then((result) => (result.stdout || result.stderr).trim())
      .catch(() => "no disponible")
    logger.info(`try: ${tryVersion}`)

    const info = await server.start()
    logger.info(`opencode: ${info.url} (${info.managed ? "gestionado" : "externo"})`)

    const response = await fetch(`${info.url}/global/health`, {
      headers: server.headers(),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`health status ${response.status}`)
    const health = (await response.json()) as { healthy?: boolean; version?: string }
    logger.info(`health: healthy=${health.healthy} version=${health.version}`)

    const api = new OpencodeApi(info.url, server.headers())
    const projects = new ProjectRegistry(config.tryPath, logger)
    const entries = await projects.list()
    logger.info(`proyectos en ${config.tryPath}: ${entries.length}`)

    const dir = process.env.SMOKE_PROJECT || entries[0]?.dir
    if (!dir) {
      logger.warn("no hay proyectos para probar; crea uno con try")
      return
    }

    const agents = await api.agents(dir)
    const sessions = await api.listSessions(dir)
    const providers = await api.providers(dir)
    const commands = await api.commands(dir)
    const files = await api.fileList(dir, ".")
    logger.info(
      `proyecto ${dir}: ${agents.length} agentes, ${sessions.length} sesiones, ${providers.providers.length} proveedores, ${commands.length} comandos, ${files.length} archivos`,
    )
    logger.info(`agentes: ${agents.map((agent) => agent.name).join(", ")}`)

    const session = await api.createSession(dir, `smoke ${new Date().toISOString()}`)
    logger.info(`sesión temporal creada: ${session.id}`)
    await api.deleteSession(dir, session.id)
    logger.info("sesión temporal borrada")
  } finally {
    await server.stop()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
