import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { type Bot, type Context, InputFile } from "grammy"
import type { App } from "../app.js"
import { escapeHtml } from "../telegram/render.js"
import { assertInside } from "../util/paths.js"
import { truncate } from "../util/text.js"
import {
  chatIdOf,
  commandArg,
  currentSession,
  ensureSession,
  errorMessage,
  projectName,
  projectSummary,
  replyHtml,
  replyMarkdown,
  replyView,
} from "./shared.js"
import { projectsView } from "./views.js"

const run = promisify(execFile)

const LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  html: "html",
  css: "css",
  sql: "sql",
}

async function activateProject(app: App, chatId: number, dir: string): Promise<string> {
  if (!app.projects.isProjectDir(dir)) throw new Error("El proyecto está fuera de TRY_PATH")
  const stat = await fs.stat(dir).catch(() => undefined)
  if (!stat?.isDirectory()) throw new Error("El proyecto no existe")
  app.state.update(chatId, (chat) => {
    chat.projectDir = dir
  })
  const session = await ensureSession(app, chatId, dir)
  return projectSummary(dir, `Sesión: \`${session.id.slice(0, 12)}\``)
}

export function registerProjects(bot: Bot, app: App): void {
  bot.command("projects", async (ctx) => {
    const chatId = chatIdOf(ctx)
    await replyView(ctx, await projectsView(app, chatId, commandArg(ctx)))
  })

  bot.command("use", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const query = commandArg(ctx)
    if (!query) {
      await replyView(ctx, await projectsView(app, chatId))
      return
    }
    if (app.turns.isBusy(chatId)) {
      await replyMarkdown(
        ctx,
        "Hay una respuesta en curso. Usa `/abort` antes de cambiar de proyecto.",
      )
      return
    }
    try {
      const entry = await app.projects.resolve(query)
      if (!entry) {
        await replyMarkdown(ctx, `No encontré un proyecto para \`${query}\`.`)
        return
      }
      const summary = await activateProject(app, chatId, entry.dir)
      await replyMarkdown(ctx, summary)
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("try", async (ctx) => {
    const chatId = chatIdOf(ctx)
    if (app.turns.isBusy(chatId)) {
      await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` primero.")
      return
    }
    const arg = commandArg(ctx)
    if (!arg) {
      await replyMarkdown(
        ctx,
        [
          "**Crear try**",
          "`/try new <nombre>` — directorio vacío",
          "`/try clone <url> [nombre]` — clonar repo",
          "`/try worktree <nombre>` — worktree desde el proyecto actual",
        ].join("\n"),
      )
      return
    }

    const tokens = arg.split(/\s+/)
    const sub = tokens.shift()?.toLowerCase()
    try {
      let result: { dir: string; output: string }
      if (sub === "new") {
        const name = tokens.join(" ")
        if (!name) throw new Error("Falta el nombre del try")
        await replyMarkdown(ctx, `⏳ Creando try \`${name}\`…`)
        result = await app.tryService.newTry(name)
      } else if (sub === "clone") {
        const url = tokens.shift()
        if (!url) throw new Error("Falta la URL")
        const name = tokens.join(" ")
        await replyMarkdown(ctx, `⏳ Clonando \`${url}\`…`)
        result = await app.tryService.clone(url, name || undefined)
      } else if (sub === "worktree") {
        const name = tokens.join(" ")
        if (!name) throw new Error("Falta el nombre del worktree")
        const project = app.state.get(chatId).projectDir
        if (!project) throw new Error("Selecciona un proyecto primero")
        if (!(await app.projects.info(project))) {
          throw new Error("El proyecto actual no es un repositorio git")
        }
        await replyMarkdown(ctx, `⏳ Creando worktree \`${name}\`…`)
        result = await app.tryService.worktree(name, project)
      } else {
        throw new Error(`Subcomando desconocido: ${sub}`)
      }

      const summary = await activateProject(app, chatId, result.dir)
      await replyMarkdown(ctx, summary)
      if (result.output) {
        await replyHtml(ctx, `<pre>${escapeHtml(truncate(result.output, 800))}</pre>`)
      }
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("clone", async (ctx) => {
    const chatId = chatIdOf(ctx)
    if (app.turns.isBusy(chatId)) {
      await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` primero.")
      return
    }
    const arg = commandArg(ctx)
    const [url, ...rest] = arg.split(/\s+/)
    if (!url) {
      await replyMarkdown(ctx, "Uso: `/clone <url> [nombre]`")
      return
    }
    const name = rest.join(" ")
    try {
      await replyMarkdown(ctx, `⏳ Clonando \`${url}\`…`)
      const result = await app.tryService.clone(url, name || undefined)
      const summary = await activateProject(app, chatId, result.dir)
      await replyMarkdown(ctx, summary)
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("worktree", async (ctx) => {
    const chatId = chatIdOf(ctx)
    if (app.turns.isBusy(chatId)) {
      await replyMarkdown(ctx, "Hay una respuesta en curso. Usa `/abort` primero.")
      return
    }
    const name = commandArg(ctx)
    const project = app.state.get(chatId).projectDir
    if (!name) {
      await replyMarkdown(ctx, "Uso: `/worktree <nombre>`")
      return
    }
    if (!project) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    try {
      if (!(await app.projects.info(project))) {
        throw new Error("El proyecto actual no es un repositorio git")
      }
      await replyMarkdown(ctx, `⏳ Creando worktree \`${name}\`…`)
      const result = await app.tryService.worktree(name, project)
      const summary = await activateProject(app, chatId, result.dir)
      await replyMarkdown(ctx, summary)
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("ls", async (ctx) => {
    const project = app.state.get(chatIdOf(ctx)).projectDir
    if (!project) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    try {
      const target = commandArg(ctx) || "."
      const resolved = assertInside(project, path.resolve(project, target))
      const relative = path.relative(project, resolved) || "."
      const nodes = await app.opencode.fileList(project, relative)
      const sorted = [...nodes].sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      const lines = [`📂 \`${relative}\``, ""]
      for (const node of sorted.slice(0, 80)) {
        const icon = node.type === "directory" ? "📁" : "📄"
        const ignored = node.ignored ? " _(ignorado)_" : ""
        lines.push(`${icon} ${node.name}${ignored}`)
      }
      if (sorted.length > 80) lines.push(`… ${sorted.length - 80} más`)
      await replyMarkdown(ctx, lines.join("\n"))
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("find", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const project = app.state.get(chatId).projectDir
    const query = commandArg(ctx)
    if (!project) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    if (!query) {
      await replyMarkdown(ctx, "Uso: `/find <texto>`")
      return
    }
    try {
      const files = await app.opencode.findFiles(project, query)
      if (files.length === 0) {
        await replyMarkdown(ctx, "Sin resultados.")
        return
      }
      const lines = [`🔎 **${files.length} resultados**`, ""]
      for (const file of files.slice(0, 60)) lines.push(`\`${file}\``)
      await replyMarkdown(ctx, lines.join("\n"))
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("read", async (ctx) => {
    const chatId = chatIdOf(ctx)
    const project = app.state.get(chatId).projectDir
    const target = commandArg(ctx)
    if (!project) {
      await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
      return
    }
    if (!target) {
      await replyMarkdown(ctx, "Uso: `/read <ruta>`")
      return
    }
    try {
      const resolved = assertInside(project, path.resolve(project, target))
      const relative = path.relative(project, resolved)
      const file = await app.opencode.fileRead(project, relative)
      if (file.type !== "text") {
        await replyMarkdown(ctx, "El archivo no es de texto.")
        return
      }
      if (file.content.length > 3500) {
        const name = path.basename(resolved)
        await ctx.replyWithDocument(new InputFile(Buffer.from(file.content, "utf8"), name))
        return
      }
      const ext = path.extname(resolved).slice(1)
      const language = LANGUAGE[ext] ? ` class="language-${LANGUAGE[ext]}"` : ""
      await replyMarkdown(ctx, `📄 \`${relative}\``)
      await replyHtml(ctx, `<pre><code${language}>${escapeHtml(file.content)}</code></pre>`)
    } catch (error) {
      await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
    }
  })

  bot.command("diff", (ctx) => showDiff(ctx, app))
  bot.command("todo", (ctx) => showTodo(ctx, app))
}

export async function showDiff(ctx: Context, app: App): Promise<void> {
  const chatId = chatIdOf(ctx)
  const project = app.state.get(chatId).projectDir
  if (!project) {
    await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
    return
  }
  try {
    const [status, diff] = await Promise.all([
      run("git", ["-C", project, "status", "--porcelain"], { timeout: 10_000, maxBuffer: 5e6 }),
      run("git", ["-C", project, "diff", "--no-color"], { timeout: 10_000, maxBuffer: 20e6 }),
    ])
    const chunks = [`📝 <b>Cambios en</b> <code>${escapeHtml(projectName(project))}</code>`]
    if (status.stdout.trim()) {
      chunks.push(`<pre>${escapeHtml(truncate(status.stdout.trim(), 1500))}</pre>`)
    }
    if (diff.stdout.trim()) {
      if (diff.stdout.length > 3500) {
        await replyHtml(ctx, chunks.join("\n"))
        await ctx.replyWithDocument(new InputFile(Buffer.from(diff.stdout, "utf8"), "changes.diff"))
        return
      }
      chunks.push(`<pre>${escapeHtml(diff.stdout)}</pre>`)
    }
    if (!status.stdout.trim() && !diff.stdout.trim()) chunks.push("<i>Sin cambios.</i>")
    await replyHtml(ctx, chunks.join("\n"))
  } catch (error) {
    await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
  }
}

export async function showTodo(ctx: Context, app: App): Promise<void> {
  const chatId = chatIdOf(ctx)
  const project = app.state.get(chatId).projectDir
  if (!project) {
    await replyMarkdown(ctx, "Selecciona un proyecto primero con `/use`.")
    return
  }
  try {
    const session = await currentSession(app, chatId, project)
    if (!session) {
      await replyMarkdown(ctx, "No hay sesión activa. Usa `/new`.")
      return
    }
    const todos = await app.opencode.todos(project, session.id)
    if (todos.length === 0) {
      await replyMarkdown(ctx, "Sin tareas pendientes.")
      return
    }
    const icons: Record<string, string> = {
      completed: "✅",
      in_progress: "🔄",
      pending: "⬜",
      cancelled: "❌",
    }
    const lines = ["✅ **Tareas**", ""]
    for (const todo of todos) {
      lines.push(`${icons[todo.status] ?? "•"} ${todo.content}`)
    }
    await replyMarkdown(ctx, lines.join("\n"))
  } catch (error) {
    await replyMarkdown(ctx, `⚠️ ${errorMessage(error)}`)
  }
}

export { activateProject }
