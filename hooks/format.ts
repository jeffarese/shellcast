// Pure helpers: output cleanup, progress detection and the glyph art the
// cards draw. Nothing here touches `$`, so tests import it directly.

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

const SPARKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

// CSI and OSC sequences, then any other control character but tab/newline/CR.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

/**
 * The last `count` visible lines of raw terminal output: escapes stripped,
 * each line resolved to what a terminal shows after its last carriage return
 * (so `npm`/`curl` progress bars collapse to their latest frame).
 */
export function tailLines(raw: string, count: number): string[] {
  const text = raw
    .slice(-16384)
    .replace(/\r\n/g, '\n')
    .replace(ANSI, '')
    .replace(CONTROL, '')
    .replace(/\t/g, '  ')
  const lines = text.split('\n').map(line => {
    const cut = line.lastIndexOf('\r')
    return (cut < 0 ? line : line.slice(cut + 1)).trimEnd()
  })
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-count)
}

/** Newline count, plus one for an unterminated last line. */
export function countLines(text: string): number {
  if (text.length === 0) return 0
  let count = 0
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++
  return text.endsWith('\n') ? count : count + 1
}

export type Progress = { ratio: number; label: string }

const PERCENT = /(?<![\d.])(\d{1,3}(?:\.\d+)?)\s?%/g
const FRACTION = /(?:^|[\s[(#])(\d{1,6})\s?\/\s?(\d{1,6})(?=[\s\]):,]|$)/g

/**
 * A progress reading from the newest output lines: a percentage (`45%`), or a
 * count (`[3/10]`, `Step 4/7`). Only the last two lines count, so a stale
 * number from earlier output never pins the bar.
 */
export function detectProgress(tail: readonly string[]): Progress | undefined {
  for (const line of tail.slice(-2).reverse()) {
    const percents = [...line.matchAll(PERCENT)]
    const percent = percents[percents.length - 1]
    if (percent !== undefined) {
      const value = Number(percent[1])
      if (value >= 0 && value <= 100) return { ratio: value / 100, label: `${Math.round(value)}%` }
    }
    const fractions = [...line.matchAll(FRACTION)]
    const fraction = fractions[fractions.length - 1]
    if (fraction !== undefined) {
      const done = Number(fraction[1])
      const total = Number(fraction[2])
      if (total >= 2 && done <= total) return { ratio: done / total, label: `${done}/${total}` }
    }
  }
  return undefined
}

/** A determinate bar `━━━━━╸────`, as its filled and empty halves. */
export function bar(ratio: number, width: number): { filled: string; empty: string } {
  const cells = Math.max(0, Math.min(1, ratio)) * width
  const full = Math.floor(cells)
  const half = cells - full >= 0.5 && full < width ? '╸' : ''
  return { filled: '━'.repeat(full) + half, empty: '─'.repeat(width - full - half.length) }
}

/** An indeterminate bar: a lit segment bouncing along a dim track. */
export function shimmer(tick: number, width: number): { before: string; lit: string; after: string } {
  const lit = Math.max(3, Math.round(width / 5))
  const span = Math.max(1, width - lit)
  const phase = tick % (span * 2)
  const at = phase < span ? phase : span * 2 - phase
  return { before: '─'.repeat(at), lit: '━'.repeat(lit), after: '─'.repeat(width - at - lit) }
}

/**
 * Bytes-per-second samples as a sparkline, scaled to their own peak. Each
 * point averages its neighbours, so output that lands between ticks reads as
 * a steady flow rather than a comb; quiet stretches sit on the baseline.
 */
export function sparkline(samples: readonly number[], width: number): string {
  const smooth = samples.map((_, i) => {
    const window = samples.slice(Math.max(0, i - 2), i + 1)
    return window.reduce((sum, value) => sum + value, 0) / window.length
  })
  const recent = smooth.slice(-width)
  const peak = Math.max(...recent, 1)
  return recent.map(value => SPARKS[Math.min(7, Math.floor((value / peak) * 7.999))]).join('')
}

export function duration(ms: number): string {
  if (ms < 0) return '0s'
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** The `Exit code 2` line of an errored Bash call's text, wherever it sits. */
export function exitCodeOf(text: string): number | undefined {
  const found = /\bExit code (\d+)\b/.exec(text)
  return found === null ? undefined : Number(found[1])
}

export type Notification = { taskId: string; status: string; exitCode?: number }

/** Every `<task-notification>` in a row's text: which task, how it ended. */
export function parseNotifications(text: string): Notification[] {
  const found: Notification[] = []
  for (const [block] of text.matchAll(/<task-notification>[\s\S]*?<\/task-notification>/g)) {
    const taskId = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(block)?.[1]
    const status = /<status>\s*([^<\s]+)\s*<\/status>/.exec(block)?.[1]
    if (taskId === undefined || status === undefined) continue
    const code = /exit code[:\s]+(-?\d+)/i.exec(block)?.[1]
    found.push({ taskId, status, ...(code === undefined ? {} : { exitCode: Number(code) }) })
  }
  return found
}

/** The folder name Claude Code files a project's temp data under. */
export function projectSlug(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}
