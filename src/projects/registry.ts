import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { Logger } from "../logger.js"
import { isInside } from "../util/paths.js"

const run = promisify(execFile)

export type GitInfo = {
  branch: string
  dirty: boolean
}

export type ProjectEntry = {
  name: string
  dir: string
  mtime: number
  git?: GitInfo
}

export function fuzzyScore(query: string, text: string): number {
  const needle = query.toLowerCase().trim()
  if (!needle) return 0
  const haystack = text.toLowerCase()
  if (haystack === needle) return 1000
  if (haystack.startsWith(needle)) return 900 - (haystack.length - needle.length)
  const index = haystack.indexOf(needle)
  if (index >= 0) return 800 - index - (haystack.length - needle.length)

  let position = 0
  let gaps = 0
  for (const char of needle) {
    const found = haystack.indexOf(char, position)
    if (found < 0) return -1
    gaps += found - position
    position = found + 1
  }
  return 500 - gaps
}

export function rankProjects(query: string, entries: ProjectEntry[]): ProjectEntry[] {
  if (!query.trim()) return entries
  return entries
    .map((entry) => ({ entry, score: fuzzyScore(query, entry.name) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || b.entry.mtime - a.entry.mtime)
    .map((item) => item.entry)
}

export class ProjectRegistry {
  private readonly gitCache = new Map<string, { at: number; info: GitInfo | undefined }>()
  private readonly logger: Logger

  constructor(
    private readonly tryPath: string,
    logger: Logger,
  ) {
    this.logger = logger.child("projects")
  }

  get root(): string {
    return this.tryPath
  }

  isProjectDir(dir: string): boolean {
    return isInside(this.tryPath, dir)
  }

  async list(): Promise<ProjectEntry[]> {
    let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>
    try {
      entries = await fs.readdir(this.tryPath, { withFileTypes: true })
    } catch (error) {
      this.logger.warn(`cannot read ${this.tryPath}`, error)
      return []
    }

    const projects: ProjectEntry[] = []
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue
      const dir = path.join(this.tryPath, entry.name)
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = (await fs.stat(dir)).isDirectory()
        } catch {
          isDir = false
        }
      }
      if (!isDir) continue

      let mtime = 0
      try {
        mtime = (await fs.stat(dir)).mtimeMs
      } catch {
        continue
      }
      const git = await this.gitInfo(dir)
      projects.push({ name: entry.name, dir, mtime, ...(git ? { git } : {}) })
    }

    return projects.sort((a, b) => b.mtime - a.mtime)
  }

  async find(query: string): Promise<ProjectEntry[]> {
    const projects = await this.list()
    return rankProjects(query, projects)
  }

  async resolve(query: string): Promise<ProjectEntry | undefined> {
    if (!query.trim()) return undefined
    const matches = await this.find(query)
    return matches[0]
  }

  async info(dir: string): Promise<GitInfo | undefined> {
    return this.gitInfo(dir)
  }

  private async gitInfo(dir: string): Promise<GitInfo | undefined> {
    const cached = this.gitCache.get(dir)
    if (cached && Date.now() - cached.at < 30_000) return cached.info

    let info: GitInfo | undefined
    try {
      const [branchResult, statusResult] = await Promise.all([
        run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000 }),
        run("git", ["-C", dir, "status", "--porcelain"], { timeout: 3000 }),
      ])
      info = {
        branch: branchResult.stdout.trim() || "HEAD",
        dirty: statusResult.stdout.trim().length > 0,
      }
    } catch {
      info = undefined
    }
    this.gitCache.set(dir, { at: Date.now(), info })
    return info
  }
}
