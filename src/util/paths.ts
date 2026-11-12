import path from "node:path"

export function isInside(parent: string, child: string): boolean {
  const base = path.resolve(parent)
  const target = path.resolve(child)
  const relative = path.relative(base, target)
  if (relative === "") return true
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function assertInside(parent: string, child: string): string {
  const target = path.resolve(child)
  if (!isInside(parent, target)) {
    throw new Error(`Path escapes ${parent}: ${target}`)
  }
  return target
}

export function displayPath(dir: string): string {
  const home = process.env.HOME
  if (!home) return dir
  if (dir === home) return "~"
  if (dir.startsWith(`${home}${path.sep}`)) return `~${dir.slice(home.length)}`
  return dir
}

export function datePrefix(date = new Date()): string {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}
