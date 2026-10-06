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
  shimmer,
  size,
  sparkline,
  tailLines,
} from './format'
import { READ_WHOLE_BYTES, streamPath } from './live'

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

const LIVE_LINES = 3
const BACKGROUND_LINES = 3
const DONE_LINES = 2
const FAILED_LINES = 8
const DETAIL_LINES = 40
/** How long a shell runs as a compact row before it opens into a live card. */
export const LONG_RUNNING_MS = 1500

type Chip = { text: string; color: string }

export type Card = {
  els: Els
  title: string
  command: string
  run: ShellRun
  columns: number
  isOpen: boolean
  toggle: (() => unknown) | undefined
  /**
   * Whether the card draws the call's output itself (the fullscreen layout,
   * where rows redraw) or leaves it to the engine's own result block (the
   * main screen, where finished rows are printed once and ctrl+o expands).
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

function Header(
  card: Card,
  glyph: string,
  glyphColor: string,
  right: RenderNode[],
  subtitle?: string,
): RenderElement {
  const { Box, Text, Button } = card.els
  return (
    <Box>
      <Text color={glyphColor} bold>{`${glyph} `}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">
          <Text bold>{card.title}</Text>
          {subtitle !== undefined && subtitle !== '' && <Text dimColor>{`  ${subtitle}`}</Text>}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={2}>
        {right}
        {card.toggle !== undefined && (
          <Box marginLeft={2}>
            <Button
              key="details"
              label={card.isOpen ? '▾ less' : '▸ details'}
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

function Details(card: Card, output: BashOutput | undefined, errorText: string | undefined): RenderElement {
  const { Box, Text } = card.els
  const { run } = card
  const facts: [string, string][] = []
  if (run.startedAt !== 0) {
    const at = new Date(run.spawnedAt ?? run.startedAt)
    const clock = [at.getHours(), at.getMinutes(), at.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
    facts.push(['started', clock])
  }
  const elapsed = elapsedOf(run)
  if (elapsed !== undefined) facts.push(['took', duration(elapsed)])
  facts.push(['timeout', duration(run.timeoutMs)])
  if (run.background !== undefined) facts.push(['task', `${run.background.taskId} (${run.background.status})`])
  const stream = run.file === undefined ? undefined : streamPath(run.file)
  if (stream !== undefined) facts.push(['stream', stream])
  if (output?.persistedOutputPath !== undefined) facts.push(['saved', output.persistedOutputPath])
  for (const file of (output?.bashEditDiff?.files ?? []).slice(0, 8)) facts.push(['edited', file.filePath])

  const stdout = output?.stdout === undefined ? [] : tailLines(output.stdout, DETAIL_LINES)
  const stderr = output?.stderr === undefined ? [] : tailLines(output.stderr, DETAIL_LINES)
  const fallback = errorText !== undefined ? tailLines(errorText, DETAIL_LINES) : run.tail.slice(-DETAIL_LINES)
  const hasOwn = stdout.length > 0 || stderr.length > 0

  return (
    <Box flexDirection="column" marginTop={1}>
      {CommandLine(card, true)}
      <Box flexDirection="column" marginTop={1}>
        {hasOwn ? OutputLines(card, stdout, 'inactive') : OutputLines(card, fallback, 'inactive')}
        {stderr.length > 0 && OutputLines(card, stderr, 'error', 'error')}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {facts.map(([label, value]) => (
          <Box>
            <Box width={9} flexShrink={0}>
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
  const { Box, Text } = card.els
  const { run } = card
  const tail = run.tail.slice(card.isOpen ? -20 : -LIVE_LINES)
  const elapsed = elapsedOf(run)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="bashBorder" paddingX={1}>
      {Header(card, SPINNER[run.ticks % SPINNER.length] ?? '⠋', 'claude', [
        <Text color="claude">{elapsed === undefined ? 'running' : duration(elapsed)}</Text>,
      ])}
      {CommandLine(card, card.isOpen)}
      {tail.length > 0 ? OutputLines(card, tail, 'bashBorder') : <Text dimColor italic>{'▏ waiting for output…'}</Text>}
      {Meter(card)}
      {Stats(card, false)}
    </Box>
  )
}

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
      {CommandLine(card, card.isOpen)}
      {run.tail.length > 0
        ? OutputLines(card, run.tail.slice(card.isOpen ? -20 : -BACKGROUND_LINES), 'suggestion')
        : <Text dimColor italic>{'▏ waiting for output…'}</Text>}
      {Stats(card, true)}
    </Box>
  )
}

/**
 * A finished shell as one line: glyph, what it was for, the gist of how it
 * ended (its last output line, else its command), chips and timing. Details
 * open the rest; on the main screen the engine's result block follows.
 */
function Compact(
  card: Card,
  glyph: string,
  color: string,
  meta: string,
  lines: readonly string[],
  chips: readonly Chip[],
  details: RenderElement | null,
  metaColor?: string,
): RenderElement {
  const { Box, Text } = card.els
  const gist = card.ownsOutput ? lines[lines.length - 1]?.trim() : undefined
  const firstLine = card.command.split('\n')[0]?.trim() ?? ''
  const subtitle = gist !== undefined && gist !== '' ? `⎿ ${gist}` : firstLine !== '' ? `$ ${firstLine}` : undefined
  const right: RenderNode[] = [
    ...chips.map(chip => <Text color={chip.color}>{`${chip.text}  `}</Text>),
    <Text color={metaColor} dimColor={metaColor === undefined}>{meta}</Text>,
  ]
  return (
    <Box flexDirection="column">
      {Header(card, glyph, color, right, card.isOpen ? undefined : subtitle)}
      {card.isOpen && <Box paddingLeft={2}>{details}</Box>}
    </Box>
  )
}

function Failed(card: Card, code: number, text: string): RenderElement {
  const { Box, Text } = card.els
  const body = text.replace(/^.*\bExit code \d+\b.*(?:\n|$)/m, '')
  const lines = tailLines(body, card.isOpen ? DETAIL_LINES : FAILED_LINES)
  const elapsed = elapsedOf(card.run)
  if (!card.isOpen) {
    const meta = elapsed === undefined ? `exit ${code}` : `exit ${code} · ${duration(elapsed)}`
    return Compact(card, '✘', 'error', meta, lines, [], null, 'error')
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="error" paddingX={1}>
      {Header(card, '✘', 'error', [
        <Text color="error" bold>{`exit ${code}`}</Text>,
        <Text dimColor>{elapsed === undefined ? '' : ` · ${duration(elapsed)}`}</Text>,
      ])}
      {CommandLine(card, card.isOpen)}
      {lines.length > 0 ? OutputLines(card, lines, 'error') : <Text dimColor italic>{'▏ no output'}</Text>}
    </Box>
  )
}

function metaOf(run: ShellRun, lines: number, prefix: string[] = []): string {
  const parts = [...prefix]
  const elapsed = elapsedOf(run)
  if (elapsed !== undefined) parts.push(duration(elapsed))
  parts.push(lines === 0 ? 'no output' : `${lines} line${lines === 1 ? '' : 's'}`)
  return parts.join(' · ')
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
    // A quick command stays one compact row from start to finish, so nothing
    // flashes open and shut; only a shell still running after a moment opens.
    // Timed from the process's own start once its output file appears; the
    // call's start also counts the engine's checks before it spawns.
    const isLong = run.spawnedAt !== undefined
      ? run.now - run.spawnedAt >= LONG_RUNNING_MS
      : run.startedAt !== 0 && run.now - run.startedAt >= LONG_RUNNING_MS * 3
    if (isLong) return Running(card)
    const spinner = SPINNER[run.ticks % SPINNER.length] ?? '⠋'
    return Compact(card, spinner, 'claude', 'running', [], [], null)
  }

  if (props.isInterrupted) {
    const elapsed = elapsedOf(run)
    const meta = elapsed === undefined ? 'interrupted' : `interrupted after ${duration(elapsed)}`
    return Compact(card, '⊘', 'warning', meta, run.tail.slice(-DONE_LINES), [], Details(card, undefined, undefined))
  }

  if (props.isErrored) {
    const text = typeof props.output === 'string' ? props.output : ''
    const code = exitCodeOf(text)
    if (code !== undefined) return Failed(card, code, text)
    // Refused before it ran (the dialog, a rule, a hook): not a command failure.
    const reason = tailLines(text, 2)
    return Compact(card, '⊘', 'warning', 'not run', reason, [], Details(card, undefined, text))
  }

  if (props.output === undefined && run.endedAt === undefined) {
    // The model is still writing the call, or it waits on a check before it
    // runs: neither running nor done yet.
    const spinner = SPINNER[run.ticks % SPINNER.length] ?? '⠋'
    return Compact(card, spinner, 'claude', 'starting', [], [], null)
  }

  const output = typeof props.output === 'object' && props.output !== null ? (props.output as BashOutput) : undefined
  const chips = chipsOf(output, run)
  const taskId = output?.backgroundTaskId
  if (taskId !== undefined) {
    const status = run.background?.status
    const isLive = run.startedAt !== 0 && (status === undefined || status === 'running')
    if (isLive && card.ownsOutput) return BackgroundLive(card, taskId)
    if (isLive) {
      return Compact(card, '◉', 'suggestion', `moved to background · ${taskId}`, [], chips, null)
    }
    if (status === undefined) {
      return Compact(card, '◉', 'suggestion', `background · ${taskId}`, [], chips, Details(card, output, undefined))
    }
    const exit = run.background?.exitCode
    const isKilled = status === 'killed' || status === 'stopped'
    const isOk = !isKilled && status === 'completed' && (exit === undefined || exit === 0)
    const glyph = isKilled ? '■' : isOk ? '✔' : '✘'
    const color = isKilled ? 'warning' : isOk ? 'success' : 'error'
    const word = isKilled ? 'stopped' : exit === undefined ? status : `exit ${exit}`
    const meta = metaOf(run, run.lines ?? run.tail.length, ['background', word])
    return Compact(card, glyph, color, meta, run.tail.slice(-DONE_LINES), chips, Details(card, output, undefined))
  }

  const stdout = output?.stdout ?? ''
  const stderr = output?.stderr ?? ''
  const lines = countLines(stdout) + countLines(stderr)
  const shown = tailLines(stdout, DONE_LINES)
  const shownErr = shown.length === 0 ? tailLines(stderr, DONE_LINES) : []
  const meta = metaOf(run, lines)
  return Compact(
    card,
    '✔',
    'success',
    meta,
    shown.length > 0 ? shown : shownErr,
    chips,
    Details(card, output, undefined),
  )
}
