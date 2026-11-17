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
 *
 * Only the end of the output is cleaned: a few lines more than asked for,
 * widened while blank lines leave it short, and never past the last 16 KB.
 */
export function tailLines(raw: string, count: number): string[] {
  const floor = Math.max(0, raw.length - 16384)
  let want = count + 4
  for (;;) {
    let at = raw.length
    for (let seen = 0; seen < want && at > floor; seen++) at = raw.lastIndexOf('\n', at - 1)
    // `at` at or below the floor means the whole window was scanned. Testing
    // `at`, not the slice start, matters: a newline exactly at the floor once
    // left the start one past it, and this loop never ended.
    const isWhole = at <= floor
    const lines = visibleLines(raw.slice(isWhole ? floor : at + 1))
    if (lines.length >= count || isWhole) return lines.slice(-count)
    want *= 4
  }
}

function visibleLines(raw: string): string[] {
  const text = raw
    .replace(/\r\n/g, '\n')
    .replace(ANSI, '')
    .replace(CONTROL, '')
    .replace(/\t/g, '  ')
  const lines = text.split('\n').map(line => {
    const cut = line.lastIndexOf('\r')
    return (cut < 0 ? line : line.slice(cut + 1)).trimEnd()
  })
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Newline count, plus one for an unterminated last line. */
export function countLines(text: string): number {
  if (text.length === 0) return 0
  let count = 0
  for (let at = text.indexOf('\n'); at >= 0; at = text.indexOf('\n', at + 1)) count++
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

const RULE = /^[=\-_*#~]{3,}\s*|\s*[=\-_*#~]{3,}$/g

/** A line as a row shows it: banner rules and column padding removed. */
export function tidy(line: string): string {
  return line.replace(RULE, '').replace(/\s{2,}/g, ' ').trim()
}

const COUNTED = '(?:passed|passing|failed|failing|failures?|errors?|problems?|warnings?)'
const RESULT = new RegExp(`\\b\\d+\\s+(?:tests?\\s+)?${COUNTED}\\b`, 'i')
// Words that name a failure or a warning, as a log line or a compiler writes them.
const BAD = '(?:[a-z]*errors?|fail(?:ed|ure|ures|s)?|fatal|denied|not found)'
const WARN = '(?:warn(?:ing|ings|s)?|deprecat(?:ed|ion))'
// A count (`2 failed`), a denial (`no errors`), or one of those words: whole
// words only, never part of a path, a file name, a flag or a `key=value`.
const TOKENS = new RegExp(
  `(?<![\\w./-])(?:(\\d+)\\s+(${COUNTED})|(?:no|without|zero)\\s+(?:${BAD}|${WARN})|(${BAD})|(${WARN}))(?![\\w/=-]|\\.\\w)`,
  'gi',
)
// What a package runner adds after the command's own last word.
const BOILERPLATE = /^(?:npm (?:ERR!|error|notice)|ELIFECYCLE\b|error Command failed|info Visit |make(?:\[\d+\])?: \*\*\*|exit status \d+$|Ran all test suites|run `npm fund`|\d+ packages are looking for funding)/i
const GIST_WINDOW = 6

// A line with no letter or digit (`}`, `});`, `---`): it says nothing.
const BARE = /^[^\p{L}\p{N}]*$/u
// A line of JSON or of a printed dict or list: data, not a sentence.
const BLOB = /^[[{]\s*["'[{]/
// A line `grep -n` or a diff numbered (`293: text`, `src/a.ts:84: text`, `457-}`), but not a time or a date.
const NUMBERED = /^(?:[^\s:]+:)?\d+[:-](?!\d{2}\b)/

/**
 * What a command's output is, for choosing its gist: a `verdict` unless its
 * last line gives it away as content; `content` where the command says so (a
 * read, a search, a listing); an `error`, the output of a command that failed.
 */
export type Output = 'verdict' | 'content' | 'error'

/**
 * The one line that says how a finished command went: its newest result line
 * (`Tests 2 failed, 71 passed`, `✖ 2 problems`) among the last few, else its
 * last line that is not a runner's boilerplate.
 *
 * Nothing where the output is content rather than a verdict: a file that was
 * read, the matches of a search, a listing (`content`, from the command), or
 * a last line that is a numbered source line, a line of JSON or brackets
 * alone. The last line of those is only where they stopped, and the row shows
 * the command instead.
 *
 * A failure is never content: `./main.go:12:5: undefined: x` is numbered the
 * way a search's matches are, and it is why the command failed. Only lines of
 * brackets alone are passed over, for the line before them.
 */
export function gistOf(lines: readonly string[], output: Output = 'verdict'): string | undefined {
  let isContent = output === 'content'
  let last: string | undefined
  let plain: string | undefined
  let seen = 0
  for (let i = lines.length - 1; i >= 0 && seen < GIST_WINDOW; i--) {
    const line = tidy(lines[i]!)
    if (line === '' || (output === 'error' && BARE.test(line))) continue
    seen++
    if (RESULT.test(line)) return line
    if (output === 'verdict' && last === undefined && (BARE.test(line) || NUMBERED.test(line) || BLOB.test(line))) isContent = true
    last ??= line
    if (plain === undefined && !BOILERPLATE.test(line)) plain = line
  }
  return isContent ? undefined : plain ?? last
}

/** Where a session works, for writing paths the short way. */
export type Places = { cwd?: string; home?: string }

// Claude Code's own scratch folder for a session: <tmp>/claude-<uid>/<project>/<session>/.
const SESSION_TMP = /(?:\/private)?\/tmp\/claude-\d+\/[^/\s]+\/[0-9a-f]{8}-[0-9a-f-]{27}\//g

function swapPrefix(text: string, prefix: string, to: string): string {
  if (prefix.length < 2) return text
  let out = ''
  let at = 0
  for (;;) {
    const found = text.indexOf(prefix, at)
    if (found < 0) return out + text.slice(at)
    // Only where a path starts: not in the middle of a longer one.
    const isStart = found === 0 || /[\s"'`=(:,[<>]/.test(text[found - 1]!)
    out += text.slice(at, found) + (isStart ? to : prefix)
    at = found + prefix.length
  }
}

/**
 * A row's text with its paths the short way: under the working folder as
 * relative, under home as `~/`, the session's scratch folder as `…/`.
 * Display only; details keep the command as it ran.
 */
export function shortPaths(text: string, places: Places | undefined): string {
  let out = text.replace(SESSION_TMP, '…/')
  if (places?.cwd !== undefined) out = swapPrefix(out, `${places.cwd.replace(/\/+$/, '')}/`, '')
  if (places?.home !== undefined) out = swapPrefix(out, `${places.home.replace(/\/+$/, '')}/`, '~/')
  return out
}

/** The newest line that shows anything, for a row that follows live output. */
export function lastLine(lines: readonly string[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = tidy(lines[i]!)
    if (line !== '') return line
  }
  return undefined
}

export type Tone = 'success' | 'error' | 'warning'

/**
 * A result line cut where it says how things went, each part toned.
 *
 * Counts above zero: `2 failed` as an error, `71 passed` as a success,
 * `3 warnings` as a warning. Warning words (`warning`, `deprecated`), so a
 * command that ended well but complained is not missed. Failure words
 * (`error`, `failed`, `fatal`, `denied`, `not found`) on a failed command's
 * line; on one that ended well only where they label the line (`error:`,
 * `ERROR`), for there `added error handling` is no error.
 *
 * Never a denial (`no errors`, `0 warnings`), nor a word inside a path, a
 * file name, a flag or a `key=value`.
 */
export function toneParts(text: string, isFailure = false): { text: string; tone?: Tone }[] {
  const parts: { text: string; tone?: Tone }[] = []
  let at = 0
  for (const found of text.matchAll(TOKENS)) {
    let tone: Tone | undefined
    if (found[2] !== undefined) {
      const word = found[2].toLowerCase()
      if (Number(found[1]) > 0) tone = word.startsWith('pass') ? 'success' : word.startsWith('warn') ? 'warning' : 'error'
    } else if (found[3] !== undefined) {
      const isLabel = text[found.index + found[0].length] === ':' || found[0] === found[0].toUpperCase()
      if (isFailure || isLabel) tone = 'error'
    } else if (found[4] !== undefined) {
      tone = 'warning'
    }
    if (tone === undefined) continue
    if (found.index > at) parts.push({ text: text.slice(at, found.index) })
    parts.push({ text: found[0], tone })
    at = found.index + found[0].length
  }
  if (at < text.length || parts.length === 0) parts.push({ text: text.slice(at) })
  return parts
}

const EXITS: Record<number, string> = {
  124: 'timed out',
  130: 'interrupted',
  137: 'killed',
  139: 'segfault',
  143: 'terminated',
}

/**
 * What an exit code a signal or `timeout` leaves means: output seldom says.
 * (126 and 127 are left out: the shell prints their reason itself.)
 */
export function exitMeaning(code: number): string | undefined {
  return EXITS[code]
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
