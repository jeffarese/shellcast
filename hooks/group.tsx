// Completed tool blocks keep their identity without repeating every row.

import type { RenderElement, ToolGroupCall } from 'claude-code'

import type { ShellRun } from '../types'
import type { BashOutput, Card } from './card'
import { duration } from './format'
import { commandIcon } from './icons'
import type { IconMode } from './icons'

export type Group = {
  els: Card['els']
  calls: readonly ToolGroupCall[]
  runs: readonly (ShellRun | undefined)[]
  iconMode: IconMode
  columns: number
  isOpen: boolean
  toggle?: () => unknown
}

const TOOL_COMMAND: Record<string, string> = {
  Read: 'cat', Grep: 'rg', Glob: 'find', LS: 'ls',
  Write: 'apply_patch', Edit: 'apply_patch', MultiEdit: 'apply_patch',
  WebFetch: 'curl', WebSearch: 'rg',
}

const GROUP_ACTIONS: readonly { tools: readonly string[]; verb: string; noun: string; plural?: string }[] = [
  { tools: ['Grep', 'Glob'], verb: 'searched for', noun: 'pattern' },
  { tools: ['Read'], verb: 'read', noun: 'file' },
  { tools: ['LS'], verb: 'listed', noun: 'directory', plural: 'directories' },
  { tools: ['Write'], verb: 'wrote', noun: 'file' },
  { tools: ['Edit', 'MultiEdit'], verb: 'edited', noun: 'file' },
  { tools: ['WebSearch'], verb: 'ran', noun: 'web search', plural: 'web searches' },
  { tools: ['WebFetch'], verb: 'fetched', noun: 'page' },
  { tools: ['Bash'], verb: 'ran', noun: 'shell command' },
]

/** Describe actual tool calls; shell commands keep their icons without being reclassified as native reads/searches. */
export function groupSummary(calls: Group['calls']): string {
  const counts = new Map<string, number>()
  for (const call of calls) counts.set(call.tool, (counts.get(call.tool) ?? 0) + 1)
  const parts: string[] = []
  let remaining = calls.length
  for (const { tools, verb, noun, plural = `${noun}s` } of GROUP_ACTIONS) {
    const count = tools.reduce((sum, tool) => sum + (counts.get(tool) ?? 0), 0)
    if (count === 0) continue
    parts.push(`${verb} ${count} ${count === 1 ? noun : plural}`)
    remaining -= count
  }
  if (remaining > 0) parts.push(`used ${remaining} ${parts.length > 0 ? 'other ' : ''}${remaining === 1 ? 'tool' : 'tools'}`)
  const summary = parts.join(', ')
  return summary.charAt(0).toUpperCase() + summary.slice(1)
}

/** A live, failed, interrupted, pending, or staged result stays inspectable. */
export function canCollapseGroup(calls: readonly ToolGroupCall[], runs: Group['runs']): boolean {
  return calls.length > 1 && calls.every((call, index) => {
    if (call.isRunning || call.isErrored || call.isInterrupted || call.output === undefined) return false
    const output = call.output !== null && typeof call.output === 'object'
      ? call.output as BashOutput & { staged?: boolean }
      : undefined
    if (output?.staged) return false
    if (call.tool === 'Bash' && output?.backgroundTaskId !== undefined) {
      const background = runs[index]?.background
      return background?.status === 'completed' && (background.exitCode === undefined || background.exitCode === 0)
    }
    return true
  })
}

/** Repeated operations get one icon and a count; unknown tools share a terminal. */
export function groupIcons(calls: Group['calls'], mode: IconMode): string {
  if (mode === 'none') return ''
  const counts = new Map<string, number>()
  for (const call of calls) {
    const input = call.input !== null && typeof call.input === 'object' ? call.input as { command?: unknown } : undefined
    const command = call.tool === 'Bash' && typeof input?.command === 'string'
      ? input.command : TOOL_COMMAND[call.tool] ?? '?'
    const icon = commandIcon(command, mode)
    if (icon !== '') counts.set(icon, (counts.get(icon) ?? 0) + 1)
  }
  return [...counts].map(([icon, count]) => count > 1 ? `${icon}×${count}` : icon).join('  ')
}

/** Wall time of an observed shell block, including overlaps only once. */
export function groupDuration(calls: Group['calls'], runs: Group['runs']): number | undefined {
  if (calls.length === 0 || calls.some(call => call.tool !== 'Bash')) return undefined
  let first = Infinity
  let last = 0
  for (let i = 0; i < calls.length; i++) {
    const run = runs[i]
    const end = run?.background?.endedAt ?? run?.endedAt
    if (run === undefined || run.startedAt === 0 || end === undefined) return undefined
    first = Math.min(first, run.spawnedAt ?? run.startedAt)
    last = Math.max(last, end)
  }
  return Math.max(0, last - first)
}

export function drawGroup(group: Group): RenderElement {
  const { Box, Text, Button } = group.els
  const { calls, columns, isOpen, toggle } = group
  const icons = groupIcons(calls, group.iconMode)
  const elapsed = columns >= 72 ? groupDuration(calls, group.runs) : undefined
  return (
    <Box>
      <Box flexShrink={0}><Text color="success" bold>{'✔ '}</Text></Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="wrap">
          <Text bold>{groupSummary(calls)}</Text>
          {icons !== '' && <Text dimColor>{`  ${icons}`}</Text>}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={2}>
        {elapsed !== undefined && <Text dimColor>{duration(elapsed)}</Text>}
        {toggle !== undefined ? (
          <Box marginLeft={elapsed === undefined ? 0 : 2}>
            <Button key="group-details" plain dimColor
              label={columns < 40 ? isOpen ? '▾' : '▸' : isOpen ? '▾ less' : '▸ details'}
              onPress={toggle} />
          </Box>
        ) : columns >= 48 && <Text dimColor>{`${elapsed === undefined ? '' : '  '}ctrl+o`}</Text>}
      </Box>
    </Box>
  )
}
