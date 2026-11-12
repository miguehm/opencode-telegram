export function truncate(value: string, max: number, suffix = "…"): string {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - suffix.length))}${suffix}`
}

export function tail(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(value.length - max)
}

export function oneLine(value: string, max = 120): string {
  const collapsed = value.replace(/\s+/g, " ").trim()
  return truncate(collapsed, max)
}

export function relativeAge(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.round(months / 12)}y`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`
}
