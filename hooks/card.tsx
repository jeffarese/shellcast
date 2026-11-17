// The inline card that takes the place of a Bash call's transcript row.

import type { Elements, RenderElement, RenderNode } from 'claude-code'

import type { ShellRun } from '../types'
import {
  SPINNER,
  bar,
  countLines,
  detectProgress,
  duration,
  exitCodeOf,
  exitMeaning,
  gistOf,
  lastLine,
  shimmer,
  shortPaths,
  size,
  sparkline,
  tailLines,
  toneParts,
} from './format'
import type { Places, Progress } from './format'
import { READ_WHOLE_BYTES, streamPath } from './live'
import { commandIcon, commandLabel, endsInContent } from './icons'
import type { IconMode } from './icons'

type Els = Elements['terminal']

export type BashInput = {
  command?: string
  description?: string
  timeout?: number
  run_in_background?: boolean
  dangerouslyDisableSandbox?: boolean
}

export type BashOutput = {
  stdout?: string
  stderr?: string
  interrupted?: boolean
  isImage?: boolean
  backgroundTaskId?: string
  backgroundedByUser?: boolean
  timedOutAfterMs?: number
  dangerouslyDisableSandbox?: boolean
  returnCodeInterpretation?: string
  noOutputExpected?: boolean
  persistedOutputPath?: string
  persistedOutputSize?: number
  gitOperation?: {
    commit?: { sha: string; kind: string; branch?: string }
    push?: { branch: string }
    branch?: { ref: string; action: string }
    pr?: { number: number; action: string }
  }
  bashEditDiff?: { files?: { filePath: string }[]; moreFiles?: number }
}

const BACKGROUND_LINES = 3
/** Lines a finished row reads to choose its gist. */
const GIST_LINES = 8
const FAILED_LINES = 8
const DETAIL_LINES = 40
/** Below this width a row keeps its title and drops what details repeat. */
const NARROW = 80
/** A shell that printed nothing for this long says so. */
const QUIET_MS = 15_000

type Chip = { text: string; color: string }

export type Card = {
  els: Els
  title: string
  command: string
  iconMode?: IconMode
  /** The session's working folder and home: rows write paths under them the short way. */
  places?: Places
  run: ShellRun
  columns: number
  isOpen: boolean
  toggle: (() => unknown) | undefined
  /**
   * Whether the card draws the call's output itself: always in fullscreen,
   * where rows redraw; on the main screen while the call runs, in an
   * unfolded group, and once it ended well (rowHoldsResult). Otherwise the
   * engine's own result block shows it, and ctrl+o expands either.
   */
  ownsOutput: boolean
}

function chipsOf(output: BashOutput | undefined, run: ShellRun): Chip[] {
  if (output === undefined) return []
  const chips: Chip[] = []
  const git = output.gitOperation
  if (git?.commit) {
    const on = git.commit.branch === undefined ? '' : ` on ${git.commit.branch}`
    chips.push({ text: `⎇ ${git.commit.kind} ${git.commit.sha.slice(0, 7)}${on}`, color: 'success' })
  }
  if (git?.push) chips.push({ text: `↑ pushed ${git.push.branch}`, color: 'suggestion' })
  if (git?.branch) chips.push({ text: `⑂ ${git.branch.action} ${git.branch.ref}`, color: 'merged' })
  if (git?.pr) chips.push({ text: `⇄ PR #${git.pr.number} ${git.pr.action}`, color: 'merged' })
  const edited = (output.bashEditDiff?.files?.length ?? 0) + (output.bashEditDiff?.moreFiles ?? 0)
  if (edited > 0) chips.push({ text: `✎ ${edited} file${edited === 1 ? '' : 's'} changed`, color: 'warning' })
  if (output.timedOutAfterMs !== undefined) {
    chips.push({ text: `⏱ timed out at ${duration(output.timedOutAfterMs)}, moved to background`, color: 'warning' })
  } else if (output.backgroundedByUser) {
    chips.push({ text: '⇣ sent to background', color: 'suggestion' })
  }
  if (output.persistedOutputPath !== undefined) {
    const saved = output.persistedOutputSize === undefined ? '' : ` ${size(output.persistedOutputSize)}`
    chips.push({ text: `⤓${saved} output saved to file`, color: 'subtle' })
  }
  if (output.dangerouslyDisableSandbox) chips.push({ text: '⚠ unsandboxed', color: 'warning' })
  if (output.isImage) chips.push({ text: '▣ image output', color: 'subtle' })
  if (output.returnCodeInterpretation) chips.push({ text: `ℹ ${output.returnCodeInterpretation}`, color: 'subtle' })
  if (run.lines === undefined && run.bytes > READ_WHOLE_BYTES) chips.push({ text: `${size(run.bytes)} streamed`, color: 'subtle' })
  return chips
}

function elapsedOf(run: ShellRun): number | undefined {
  if (run.startedAt === 0) return undefined
  const from = run.spawnedAt ?? run.startedAt
  return (run.endedAt ?? run.now) - from
}

function displayTitle(title: string, command: string): string {
  return title.trim() === command.split('\n')[0]?.trim() ? commandLabel(command) : title
}

/** What follows a row's title: its gist (`⎿`) or, with none, its command (`$`). */
type Subtitle = { mark: string; text: string; isToned?: boolean; isStrong?: boolean }

function Header(
  card: Card,
  glyph: string,
  glyphColor: string,
  right: RenderNode[],
  subtitle?: Subtitle,
): RenderElement {
  const { Box, Text, Button } = card.els
  const icon = commandIcon(card.command, card.iconMode)
  const shown = subtitle === undefined ? '' : shortPaths(subtitle.text, card.places)
  const parts = subtitle === undefined ? [] : subtitle.isToned ? toneParts(shown, subtitle.isStrong === true) : [{ text: shown }]
  // The mark stays quiet even where the line opens on a toned count.
  if (subtitle !== undefined && parts[0]?.tone !== undefined) parts.unshift({ text: '' })
  return (
    <Box>
      <Box flexShrink={0}>
        <Text color={glyphColor} bold>{`${glyph} `}</Text>
        {icon !== '' && <Text dimColor>{`${icon} `}</Text>}
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          <Text bold>{shortPaths(displayTitle(card.title, card.command), card.places)}</Text>
          {subtitle !== undefined && parts.map((part, i) => (
            <Text color={part.tone} dimColor={part.tone === undefined && !subtitle.isStrong}>
              {i === 0 ? `  ${subtitle.mark} ${part.text}` : part.text}
            </Text>
          ))}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={2}>
        {right}
        {card.toggle !== undefined && (
          <Box marginLeft={2}>
            <Button
              key="details"
              label={card.columns < NARROW ? card.isOpen ? '▾' : '▸' : card.isOpen ? '▾ less' : '▸ details'}
              plain
              dimColor
              onPress={card.toggle}
            />
          </Box>
        )}
      </Box>
    </Box>
  )
}

/** One part of a row's right side: plain facts are dim, a color marks a state. */
type Seg = { text: string; color?: string } | { progress: Progress; width: number }

/** Parts joined by ` · `: neighbouring dim ones as one Text, a bar as its two halves. */
function Segs(els: Els, segs: readonly Seg[]): RenderNode[] {
  const { Text } = els
  const out: RenderNode[] = []
  let dim = ''
  const flush = () => {
    if (dim !== '') out.push(<Text dimColor>{dim}</Text>)
    dim = ''
  }
  segs.forEach((seg, i) => {
    if (i > 0) dim += ' · '
    if ('text' in seg && seg.color === undefined) {
      dim += seg.text
      return
    }
    flush()
    if ('text' in seg) {
      out.push(<Text color={seg.color}>{seg.text}</Text>)
      return
    }
    const { filled, empty } = bar(seg.progress.ratio, seg.width)
    if (filled !== '') out.push(<Text color="success">{filled}</Text>)
    if (empty !== '') out.push(<Text color="inactive">{empty}</Text>)
    out.push(<Text>{` ${seg.progress.label}`}</Text>)
  })
  flush()
  return out
}

/**
 * How long a watched shell has printed nothing, once that is worth saying:
 * the answer to "is it stuck?". Unknown where its output file was never found.
 */
function quietOf(run: ShellRun): string | undefined {
  if (run.file === undefined || run.startedAt === 0) return undefined
  const quiet = run.now - (run.outputAt ?? run.spawnedAt ?? run.startedAt)
  if (quiet < QUIET_MS) return undefined
  return run.bytes === 0 ? 'no output yet' : `quiet ${duration(quiet)}`
}

/** The chips a row has room for, in their order; details list them all. */
function fitChips(chips: readonly Chip[], budget: number): { shown: Chip[]; hidden: number } {
  const shown: Chip[] = []
  let left = budget
  for (const chip of chips) {
    if (chip.text.length + 2 > left) continue
    shown.push(chip)
    left -= chip.text.length + 2
  }
  return { shown, hidden: chips.length - shown.length }
}

function CommandLine(card: Card, isFull: boolean): RenderElement {
  const { Box, Text, Code } = card.els
  const lines = card.command.split('\n')
  const shown = isFull ? lines.slice(0, 30) : lines.slice(0, 1)
  const hidden = lines.length - shown.length
  return (
    <Box>
      <Text color="bashBorder" bold>{'$ '}</Text>
      <Box flexDirection="column" flexShrink={1} flexGrow={1}>
        <Code language="bash" source={shown.join('\n')} wrap={isFull ? 'wrap' : 'truncate-end'} />
        {hidden > 0 && <Text dimColor>{`… ${hidden} more line${hidden === 1 ? '' : 's'}`}</Text>}
      </Box>
    </Box>
  )
}

/** Output lines behind a thin gutter, the way a log viewer frames them. */
function OutputLines(card: Card, lines: readonly string[], gutter: string, color?: string): RenderElement {
  const { Box, Text } = card.els
  return (
    <Box flexDirection="column">
      {lines.map(line => (
        <Box>
          <Text color={gutter}>{'▏ '}</Text>
          <Text color={color} dimColor={color === undefined} wrap="truncate-end">{line === '' ? ' ' : line}</Text>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Exactly `count` output rows, the newest last, blank rows first while output
 * is sparse: a live card keeps its height from its first frame to its last.
 */
function LiveLines(card: Card, tail: readonly string[], count: number, gutter: string): RenderElement {
  const { Box, Text } = card.els
  if (tail.length === 0) {
    return (
      <Box flexDirection="column">
        <Text dimColor italic>{'▏ waiting for output…'}</Text>
        {Array.from({ length: count - 1 }, () => <Text>{' '}</Text>)}
      </Box>
    )
  }
  const shown = tail.slice(-count)
  return OutputLines(card, [...Array.from({ length: count - shown.length }, () => ''), ...shown], gutter)
}

/** The live meter: a real bar when the output reports progress, else a shimmer. */
function Meter(card: Card): RenderElement {
  const { Box, Text } = card.els
  // The card's inner width: the terminal less two border and two padding cells, and one spare.
  const inner = Math.max(20, card.columns - 5)
  const progress = detectProgress(card.run.tail)
  const width = Math.max(10, inner - (progress === undefined ? 0 : progress.label.length + 1))
  if (progress !== undefined) {
    const { filled, empty } = bar(progress.ratio, width)
    return (
      <Box>
        <Text color="success">{filled}</Text>
        <Text color="inactive">{empty}</Text>
        <Text bold>{` ${progress.label}`}</Text>
      </Box>
    )
  }
  const { before, lit, after } = shimmer(card.run.ticks, width)
  return (
    <Box>
      <Text color="inactive">{before}</Text>
      <Text color="claude">{lit}</Text>
      <Text color="inactive">{after}</Text>
    </Box>
  )
}

function Stats(card: Card, isBackground: boolean): RenderElement {
  const { Text } = card.els
  const { run } = card
  const lines = run.lines === undefined ? '' : ` · ${run.lines} line${run.lines === 1 ? '' : 's'}`
  const recent = run.rates.slice(-4)
  const rate = recent.length === 0 ? 0 : recent.reduce((sum, value) => sum + value, 0) / recent.length
  const hasFlow = run.rates.some(value => value > 0)
  const elapsed = elapsedOf(run) ?? 0
  const left = run.timeoutMs - elapsed
  const isLate = !isBackground && run.startedAt !== 0 && elapsed > run.timeoutMs / 2
  return (
    <Text dimColor>
      {run.bytes === 0 ? 'no output yet' : `${size(run.bytes)}${lines}`}
      {hasFlow && <Text color="suggestion">{`  ${sparkline(run.rates, 16)}`}</Text>}
      {hasFlow && ` ${size(Math.round(rate))}/s`}
      {isLate && <Text color="warning">{`  ⏱ times out in ${duration(Math.max(0, left))}`}</Text>}
    </Text>
  )
}

/** `label value` facts on one wrapping line: short ones need no row each. */
function FactLine(card: Card, facts: readonly [string, string][]): RenderElement {
  const { Text } = card.els
  return (
    <Text wrap="wrap">
      {facts.map(([label, value], i) => [
        <Text dimColor>{`${i === 0 ? '' : '  ·  '}${label} `}</Text>,
        <Text>{value}</Text>,
      ])}
    </Text>
  )
}

function Details(card: Card, output: BashOutput | undefined, errorText: string | undefined): RenderElement {
  const { Box, Text } = card.els
  const { run } = card
  const timing: [string, string][] = []
  if (run.startedAt !== 0) {
    const at = new Date(run.spawnedAt ?? run.startedAt)
    const clock = [at.getHours(), at.getMinutes(), at.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
    timing.push(['started', clock])
  }
  const elapsed = elapsedOf(run)
  if (elapsed !== undefined) timing.push(['took', duration(elapsed)])
  timing.push(['timeout', duration(run.timeoutMs)])
  if (run.background !== undefined) timing.push(['task', `${run.background.taskId} (${run.background.status})`])
  const paths: [string, string][] = []
  const stream = run.file === undefined ? undefined : streamPath(run.file)
  if (stream !== undefined) paths.push(['stream', stream])
  if (output?.persistedOutputPath !== undefined) paths.push(['saved', output.persistedOutputPath])
  for (const file of (output?.bashEditDiff?.files ?? []).slice(0, 8)) paths.push(['edited', file.filePath])

  const stdout = output?.stdout === undefined ? [] : tailLines(output.stdout, DETAIL_LINES)
  const stderr = output?.stderr === undefined ? [] : tailLines(output.stderr, DETAIL_LINES)
  const fallback = errorText !== undefined ? tailLines(errorText, DETAIL_LINES) : run.tail.slice(-DETAIL_LINES)
  const hasOwn = stdout.length > 0 || stderr.length > 0
  // Only the end is drawn: say how much came before it.
  const total = hasOwn ? countLines(output?.stdout ?? '') : errorText !== undefined ? countLines(errorText) : run.lines ?? 0
  const drawn = hasOwn ? stdout.length : fallback.length
  const earlier = drawn < DETAIL_LINES ? 0 : Math.max(0, total - drawn)
  const chips = chipsOf(output, run)

  return (
    <Box flexDirection="column" marginTop={1}>
      {CommandLine(card, true)}
      <Box flexDirection="column" marginTop={1}>
        {earlier > 0 && <Text dimColor>{`⋮ ${earlier} earlier line${earlier === 1 ? '' : 's'}`}</Text>}
        {hasOwn ? OutputLines(card, stdout, 'inactive') : OutputLines(card, fallback, 'inactive')}
        {stderr.length > 0 && stdout.length > 0 && <Text color="error" dimColor>{'stderr'}</Text>}
        {stderr.length > 0 && OutputLines(card, stderr, 'error', 'error')}
        {!hasOwn && fallback.length === 0 && <Text dimColor italic>{'▏ no output'}</Text>}
      </Box>
      {chips.length > 0 && (
        <Box marginTop={1}>
          <Text wrap="wrap">
            {chips.map((chip, i) => <Text color={chip.color}>{`${i === 0 ? '' : '   '}${chip.text}`}</Text>)}
          </Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {FactLine(card, timing)}
        {paths.map(([label, value]) => (
          <Box>
            <Box width={8} flexShrink={0}>
              <Text dimColor>{label}</Text>
            </Box>
            <Text wrap="truncate-middle">{value}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function Running(card: Card): RenderElement {
  const { run } = card
  const elapsed = elapsedOf(run)
  const progress = detectProgress(run.tail)
  const isLate = elapsed !== undefined && elapsed > run.timeoutMs / 2
  const meta: Seg[] = []
  if (isLate) meta.push({ text: `⏱ ${duration(Math.max(0, run.timeoutMs - elapsed))} left`, color: 'warning' })
  if (progress !== undefined) {
    meta.push({ progress, width: card.columns < NARROW ? 6 : 10 })
  } else {
    // The spinner already says it runs: a word only where nothing better does.
    const quiet = quietOf(run)
    if (quiet !== undefined) meta.push({ text: quiet })
    else if (!isLate) meta.push({ text: 'running' })
  }
  if (elapsed !== undefined) meta.push({ text: duration(elapsed) })
  return Compact(card, {
    glyph: SPINNER[run.ticks % SPINNER.length] ?? '⠋',
    color: 'claude',
    meta,
    gist: lastLine(run.tail),
    details: () => Details(card, undefined, undefined),
  })
}

/**
 * A running background shell's live card, pinned above the prompt: always
 * the same rows (header, command, three output lines, meter, stats), so the
 * prompt under it never moves while the shell runs.
 */
function BackgroundLive(card: Card, taskId: string): RenderElement {
  const { Box, Text } = card.els
  const { run } = card
  const elapsed = elapsedOf(run)
  const pulse = run.ticks % 4 < 2 ? '◉' : '○'
  return (
    <Box flexDirection="column" borderStyle="dashed" borderColor="suggestion" paddingX={1}>
      {Header(card, pulse, 'suggestion', [
        <Text color="suggestion">{'background'}</Text>,
        <Text dimColor>{` · ${taskId}`}</Text>,
        <Text dimColor>{elapsed === undefined ? '' : ` · ${duration(elapsed)}`}</Text>,
      ])}
      {CommandLine(card, false)}
      {LiveLines(card, run.tail, BACKGROUND_LINES, 'suggestion')}
      {Meter(card)}
      {Stats(card, true)}
    </Box>
  )
}

type Row = {
  glyph: string
  color: string
  /** The right side: state, then counts, then the time, so times line up. */
  meta: readonly Seg[]
  /** The output line that says most; drawn only where the card owns the output. */
  gist?: string
  /** A finished row tones its result counts; a failed one is at full strength. */
  isToned?: boolean
  isStrong?: boolean
  chips?: readonly Chip[]
  details: (() => RenderElement) | null
}

/**
 * A shell as one line: glyph, what it is for, the output line that says how it
 * went (its command where the output is content, or there is none), chips and timing. Details open the rest; where the card
 * does not own the output, the engine's result block follows.
 */
function Compact(card: Card, row: Row): RenderElement {
  const { Box, Text } = card.els
  const gist = card.ownsOutput ? row.gist : undefined
  const label = commandLabel(card.command)
  // A call with no description is titled by its command: once is enough.
  const subtitle: Subtitle | undefined = gist !== undefined && gist !== ''
    ? { mark: '⎿', text: gist, isToned: row.isToned, isStrong: row.isStrong }
    : label !== '' && label !== displayTitle(card.title, card.command) ? { mark: '$', text: label } : undefined
  // Where no details can open (the main screen), chips get more of the row.
  const { shown, hidden } = fitChips(row.chips ?? [], Math.floor(card.columns / (card.toggle === undefined ? 2 : 3)))
  const right: RenderNode[] = [
    ...shown.map(chip => <Text color={chip.color}>{`${chip.text}  `}</Text>),
    ...(hidden > 0 ? [<Text dimColor>{`+${hidden}  `}</Text>] : []),
    ...Segs(card.els, row.meta),
  ]
  return (
    <Box flexDirection="column">
      {Header(card, row.glyph, row.color, right, card.isOpen ? undefined : subtitle)}
      {card.isOpen && row.details !== null && <Box paddingLeft={2}>{row.details()}</Box>}
    </Box>
  )
}

function Failed(card: Card, code: number, text: string): RenderElement {
  const { Box, Text } = card.els
  const body = text.replace(/^.*\bExit code \d+\b.*(?:\n|$)/m, '')
  const lines = tailLines(body, card.isOpen ? DETAIL_LINES : FAILED_LINES)
  const elapsed = elapsedOf(card.run)
  const meaning = exitMeaning(code)
  if (!card.isOpen) {
    const meta = [`exit ${code}`, card.columns < NARROW ? undefined : meaning, elapsed === undefined ? undefined : duration(elapsed)]
      .filter(part => part !== undefined).join(' · ')
    return Compact(card, {
      glyph: '✘', color: 'error', meta: [{ text: meta, color: 'error' }],
      gist: gistOf(lines, 'error'), isToned: true, isStrong: true, details: null,
    })
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
      {Header(card, '✘', 'error', [
        <Text color="error" bold>{`exit ${code}`}</Text>,
        <Text dimColor>{`${meaning === undefined ? '' : ` · ${meaning}`}${elapsed === undefined ? '' : ` · ${duration(elapsed)}`}`}</Text>,
      ])}
      {CommandLine(card, card.isOpen)}
      {lines.length > 0 ? OutputLines(card, lines, 'error') : <Text dimColor italic>{'▏ no output'}</Text>}
    </Box>
  )
}

/** A finished row's facts: its state, its line count, then its time, last. */
function metaOf(card: Card, lines: number, prefix: string[] = []): Seg[] {
  const isNarrow = card.columns < NARROW
  const parts = isNarrow ? prefix.slice(-1) : [...prefix]
  const elapsed = elapsedOf(card.run)
  if (!isNarrow || elapsed === undefined) parts.push(lines === 0 ? 'no output' : `${lines} line${lines === 1 ? '' : 's'}`)
  if (elapsed !== undefined) parts.push(duration(elapsed))
  return [{ text: parts.join(' · ') }]
}

/**
 * Whether a call's row says all its result block would: one that ran and
 * ended well, or went to the background. A failure, an interrupt, an image or
 * an edit's diff keeps the engine's block, which shows those best.
 */
export function rowHoldsResult(output: unknown, isErrored: boolean): boolean {
  if (isErrored || typeof output !== 'object' || output === null) return false
  const result = output as BashOutput
  return !result.interrupted && !result.isImage && (result.bashEditDiff?.files?.length ?? 0) === 0
}

export type ToolUseProps = {
  input: unknown
  output?: unknown
  isRunning: boolean
  isErrored: boolean
  isInterrupted: boolean
}

export function drawCard(card: Card, props: ToolUseProps): RenderElement {
  const { run } = card
  if (props.isRunning) {
    // Running time never expands a row; only the explicit details toggle does.
    return Running(card)
  }

  if (props.isInterrupted) {
    const elapsed = elapsedOf(run)
    const meta = elapsed === undefined ? 'interrupted' : `interrupted after ${duration(elapsed)}`
    return Compact(card, {
      glyph: '⊘', color: 'warning', meta: [{ text: meta }],
      gist: lastLine(run.tail), details: () => Details(card, undefined, undefined),
    })
  }

  if (props.isErrored) {
    const text = typeof props.output === 'string' ? props.output : ''
    const code = exitCodeOf(text)
    if (code !== undefined) return Failed(card, code, text)
    // Refused before it ran (the dialog, a rule, a hook): not a command failure.
    return Compact(card, {
      glyph: '⊘', color: 'warning', meta: [{ text: 'not run' }],
      gist: lastLine(tailLines(text, 2)), details: () => Details(card, undefined, text),
    })
  }

  if (props.output === undefined && run.endedAt === undefined) {
    // The model is still writing the call, or it waits on a check before it
    // runs: neither running nor done yet.
    return Compact(card, { glyph: SPINNER[run.ticks % SPINNER.length] ?? '⠋', color: 'claude', meta: [{ text: 'starting' }], details: null })
  }

  const output = typeof props.output === 'object' && props.output !== null ? (props.output as BashOutput) : undefined
  const chips = chipsOf(output, run)
  const details = () => Details(card, output, undefined)
  const taskId = output?.backgroundTaskId
  if (taskId !== undefined) {
    const status = run.background?.status
    const isLive = run.startedAt !== 0 && (status === undefined || status === 'running')
    if (isLive) {
      // Its live card is pinned above the prompt; here it stays one row, so
      // the transcript never reflows as the shell runs or ends.
      const elapsed = elapsedOf(run)
      const meta = `pinned ↓${elapsed === undefined ? '' : ` · ${duration(elapsed)}`}`
      return Compact(card, { glyph: run.ticks % 4 < 2 ? '◉' : '○', color: 'suggestion', meta: [{ text: meta, color: 'suggestion' }], chips, details })
    }
    if (status === undefined) {
      return Compact(card, { glyph: '◉', color: 'suggestion', meta: [{ text: `background · ${taskId}` }], chips, details })
    }
    const lines = run.lines ?? run.tail.length
    const exit = run.background?.exitCode
    const isKilled = status === 'killed' || status === 'stopped'
    const isOk = !isKilled && status === 'completed' && (exit === undefined || exit === 0)
    // A failed shell's last line is why it failed, never just where content stopped.
    const output = status !== 'finished' && !isKilled && !isOk ? 'error' : endsInContent(card.command) ? 'content' : 'verdict'
    const gist = gistOf(run.tail.slice(-GIST_LINES), output)
    if (status === 'finished') {
      return Compact(card, {
        glyph: '○', color: 'subtle', meta: metaOf(card, lines, ['background', 'finished · exit unknown']),
        gist, isToned: true, chips, details,
      })
    }
    const word = isKilled ? 'stopped' : exit === undefined ? status : `exit ${exit}`
    return Compact(card, {
      glyph: isKilled ? '■' : isOk ? '✔' : '✘',
      color: isKilled ? 'warning' : isOk ? 'success' : 'error',
      meta: metaOf(card, lines, ['background', word]),
      gist, isToned: true, isStrong: !isKilled && !isOk, chips, details,
    })
  }

  const stdout = output?.stdout ?? ''
  const stderr = output?.stderr ?? ''
  const shown = tailLines(stdout, GIST_LINES)
  return Compact(card, {
    glyph: '✔',
    color: 'success',
    meta: metaOf(card, countLines(stdout) + countLines(stderr)),
    gist: gistOf(shown.length > 0 ? shown : tailLines(stderr, GIST_LINES), endsInContent(card.command) ? 'content' : 'verdict'),
    isToned: true,
    chips,
    details,
  })
}

/** A running background shell, for the band and the footer. */
export type Pinned = { title: string; command: string; run: ShellRun }

/** A title as the band shows it: everything there is in the background already. */
function bandTitle(title: string): string {
  return title.replace(/\s+in (?:the )?background$/i, '')
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

function BandRow(els: Els, { title, command, run }: Pinned, columns: number, iconMode: IconMode): RenderElement {
  const { Box, Text } = els
  const icon = commandIcon(command, iconMode)
  const elapsed = elapsedOf(run)
  const progress = detectProgress(run.tail)
  const last = lastLine(run.tail)
  // With no output at all the row already says it is waiting.
  const quiet = run.bytes === 0 ? undefined : quietOf(run)
  const when = [quiet, elapsed === undefined ? undefined : duration(elapsed)].filter(part => part !== undefined).join(' · ')
  return (
    <Box>
      <Box flexShrink={0}>
        <Text color="suggestion">{'◉ '}</Text>
        {icon !== '' && <Text dimColor>{`${icon} `}</Text>}
        <Text bold>{`${clip(bandTitle(displayTitle(title, command)), Math.max(12, Math.floor(columns / 3)))}  `}</Text>
        {progress !== undefined && Segs(els, [{ progress, width: columns < NARROW ? 6 : 8 }])}
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">{`${progress === undefined ? '' : '  '}${last ?? 'waiting for output…'}`}</Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor>{when === '' ? '' : `  ${when}`}</Text>
      </Box>
    </Box>
  )
}

/** Rows a pinned card takes: two borders, header, command, output, meter, stats. */
const PINNED_ROWS = 2 + 1 + 1 + BACKGROUND_LINES + 1 + 1

/**
 * Quiet rows by default, bounded independently of the terminal's height.
 * Full live cards remain an explicit opt-in.
 */
export function drawPinned(els: Els, shells: readonly Pinned[], columns: number, maxRows: number, iconMode: IconMode = 'unicode', layout: 'compact' | 'cards' = 'compact'): RenderElement {
  const { Box, Text } = els
  let budget = Math.max(0, Math.floor(maxRows))
  if (layout === 'compact') {
    const limit = Math.min(3, budget)
    const shown = shells.slice(0, shells.length > limit ? Math.min(limit, Math.max(0, budget - 1)) : limit)
    const more = shells.length - shown.length
    return <Box flexDirection="column">
      {shown.map(shell => BandRow(els, shell, columns, iconMode))}
      {more > 0 && budget > shown.length && <Text dimColor>{`  +${more} more in the background`}</Text>}
    </Box>
  }
  if (budget === 0) return <Box />
  const parts: RenderElement[] = []
  let more = 0
  for (const shell of shells) {
    const rowsLeft = shells.length - parts.length
    if (budget - PINNED_ROWS >= rowsLeft - 1) {
      const card: Card = {
        els,
        title: shell.title,
        command: shell.command,
        iconMode,
        run: shell.run,
        columns,
        isOpen: false,
        toggle: undefined,
        ownsOutput: true,
      }
      parts.push(BackgroundLive(card, shell.run.background?.taskId ?? ''))
      budget -= PINNED_ROWS
    } else if (budget > 1 || (budget > 0 && rowsLeft === 1)) {
      parts.push(BandRow(els, shell, columns, iconMode))
      budget -= 1
    } else {
      more += 1
    }
  }
  return (
    <Box flexDirection="column">
      {parts}
      {more > 0 && budget > 0 && <Text dimColor>{`  +${more} more in the background`}</Text>}
    </Box>
  )
}

/** What the footer's "1 shell" is doing, in a few words: `→ Run e2e 12/24 24s`. */
export function footerTail(shells: readonly Pinned[]): string | undefined {
  if (shells.length === 0) return undefined
  const parts = shells.slice(0, 1).map(({ title, command, run }) => {
    const progress = detectProgress(run.tail)
    const elapsed = elapsedOf(run)
    return [clip(bandTitle(displayTitle(title, command)), 22), progress?.label, elapsed === undefined ? undefined : duration(elapsed)]
      .filter(part => part !== undefined)
      .join(' ')
  })
  return `→ ${parts.join(' · ')}${shells.length > 1 ? ` · +${shells.length - 1} more` : ''}`
}
