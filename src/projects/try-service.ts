import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { Logger } from "../logger.js"
import { assertInside } from "../util/paths.js"

const run = promisify(execFile)
const PWD_MARKER = "__TRY_PWD__"

export function validateTryName(name: string): string {
  const value = name.trim()
  if (!value) throw new Error("El nombre no puede estar vacío")
  if (value.startsWith("-")) throw new Error("El nombre no puede empezar con '-'")
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._ -]*$/u.test(value)) {
    throw new Error("Nombre inválido: usa letras, números, punto, guion o espacio")
  }
  if (value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error("El nombre no puede contener rutas")
  }
  return value
}

export function validateCloneUrl(url: string): string {
  const value = url.trim()
  if (!value) throw new Error("La URL no puede estar vacía")
  if (value.startsWith("-")) throw new Error("URL inválida")
  if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(value)) {
    throw new Error("URL inválida: usa https://, ssh://, git:// o git@")
  }
  return value
}

export function parseTryPwd(stdout: string): string | undefined {
  const match = stdout.match(new RegExp(`${PWD_MARKER}([^\\n\\r]*)\\s*$`))
  if (!match?.[1]) return undefined
  return match[1].trim()
}

export function cleanTryOutput(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith(PWD_MARKER))
    .slice(-20)
    .join("\n")
}

export type TryResult = {
  dir: string
  output: string
}

export class TryService {
  private readonly logger: Logger

  constructor(
    private readonly tryPath: string,
    private readonly binary: string,
    logger: Logger,
  ) {
    this.logger = logger.child("try")
  }

  get root(): string {
    return this.tryPath
  }

  async newTry(name: string): Promise<TryResult> {
    const validName = validateTryName(name)
    return this.create([".", validName], this.tryPath)
  }

  async clone(url: string, name?: string): Promise<TryResult> {
    const validUrl = validateCloneUrl(url)
    const args = ["clone", validUrl]
    if (name?.trim()) args.push(validateTryName(name))
    return this.create(args, this.tryPath)
  }

  async worktree(name: string, repoDir: string): Promise<TryResult> {
    const validName = validateTryName(name)
    return this.create(["worktree", validName], repoDir)
  }

  private async create(args: string[], cwd: string): Promise<TryResult> {
    const { stdout, stderr } = await this.runTry(args, cwd)
    const script = stdout.trim()
    if (!script) {
      throw new Error(`try no generó un script: ${cleanTryOutput(stderr) || "sin salida"}`)
    }

    const executed = await this.runScript(script)
    const target = parseTryPwd(executed.stdout)
    if (!target) {
      throw new Error(
        `No se pudo determinar el directorio creado\n${cleanTryOutput(executed.stderr) || cleanTryOutput(executed.stdout)}`,
      )
    }

    const dir = assertInside(this.tryPath, target)
    if (dir === path.resolve(this.tryPath)) {
      throw new Error("try no creó un directorio nuevo")
    }
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) throw new Error(`No es un directorio: ${dir}`)

    return {
      dir,
      output: cleanTryOutput([executed.stdout, executed.stderr].filter(Boolean).join("\n")),
    }
  }

  private async runTry(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
    this.logger.debug(`try ${args.join(" ")}`, { cwd })
    try {
      const result = await run(this.binary, args, {
        cwd,
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      })
      return { stdout: result.stdout, stderr: result.stderr }
    } catch (error) {
      const failure = error as { stderr?: string; stdout?: string; message?: string }
      throw new Error(
        `try falló: ${cleanTryOutput(failure.stderr || "") || cleanTryOutput(failure.stdout || "") || failure.message || "error desconocido"}`,
      )
    }
  }

  private async runScript(script: string): Promise<{ stdout: string; stderr: string }> {
    const code = `set -e\n${script}\nprintf '\\n${PWD_MARKER}%s\\n' "$PWD"`
    try {
      const result = await run("bash", ["-c", code], {
        timeout: 120_000,
        maxBuffer: 20 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
      })
      return { stdout: result.stdout, stderr: result.stderr }
    } catch (error) {
      const failure = error as { stderr?: string; stdout?: string; message?: string }
      throw new Error(
        `No se pudo crear el try: ${cleanTryOutput(failure.stderr || "") || cleanTryOutput(failure.stdout || "") || failure.message || "error desconocido"}`,
      )
    }
  }
}
