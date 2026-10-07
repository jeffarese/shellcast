import { atom, memberOf, read, update } from 'claude-code'
import type { BuiltinToolResults, Register } from 'claude-code'

import { drawCard, drawPinned, footerTail } from './card'
import type { BashInput, BashOutput, Card, Pinned } from './card'
import { countLines, parseNotifications } from './format'
import { canCollapseGroup, drawGroup } from './group'
import { iconMode } from './icons'
import { BLANK, begin, connect, connected, end, ensureTicker, settle, textOf } from './live'

const runs = atom({ plugin: 'shellcast', key: 'runs' } as const, BLANK)
const expanded = atom({ plugin: 'shellcast', key: 'expanded' } as const, false)
const groupExpanded = atom({ plugin: 'shellcast', key: 'groupExpanded' } as const, false)
const active = atom({ plugin: 'shellcast', key: 'active' } as const, [])
const pinned = atom({ plugin: 'shellcast', key: 'pinned' } as const, [])

type Reader = Parameters<typeof read>[0]

/**
 * Background shells still running, newest last. Reads only the pinned runs,
 * so a foreground shell's ticks never redraw the band or the footer.
 */
async function backgroundShells($: Reader): Promise<(Pinned & { id: string })[]> {
  const shells: (Pinned & { id: string })[] = []
  for (const id of await read($, pinned)) {
    const run = await read($, memberOf(runs, { requestId: id }))
    if (run.background?.status === 'running') shells.push({ id, title: run.title ?? 'Shell', command: run.command ?? '', run })
  }
  return shells
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    connect({
      now: () => $.clock.now(),
      sessionId: () => $.session.id(),
      places: async () => [await $.session.cwd(), await $.session.root()],
      tmpdir: () => $.env.get('CLAUDE_CODE_TMPDIR'),
      uid: async () => (await $.process.run(['id', '-u'], { timeoutMs: 2000 })).stdout.trim(),
      tail: async path => (await $.process.run(['tail', '-c', '16384', path], { timeoutMs: 2000 })).stdout,
      list: path => $.fs.list(path),
      exists: path => $.fs.exists(path),
      stat: path => $.fs.stat(path),
      read: path => $.fs.read(path),
      every: (ms, fn) => $.clock.every(ms, fn),
      log: text => $.ui.log(text, { to: 'debug' }),
      getRun: id => read($, memberOf(runs, { requestId: id })),
      setRun: (id, change) => update($, memberOf(runs, { requestId: id }), change),
      getActive: () => read($, active),
      setActive: change => update($, active, change),
      setPinned: change => update($, pinned, change),
    })
    const ids = await read($, active)
    if (ids.length > 0) {
      // Runs pinned before `pinned` existed (a reload mid-shell) pin again.
      const list = await read($, pinned)
      const running: string[] = []
      for (const id of ids) {
        if ((await read($, memberOf(runs, { requestId: id }))).background?.status === 'running') running.push(id)
      }
      const missing = running.filter(id => !list.includes(id))
      if (missing.length > 0) await update($, pinned, current => [...current, ...missing.filter(id => !current.includes(id))])
      ensureTicker()
    }
    return started
  })

  // Observe every shell call: its start, its live output, how it ended. The
  // call itself passes through untouched.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const io = connected()
    if (io === undefined) return next(e)
    const title = e.description?.trim() || e.command.split('\n')[0]?.trim() || 'Shell'
    await begin(io, e.tool_use_id, e.timeout, title, e.command)
    const ran = await next(e)
    const output = ran.deny === undefined && ran.isError !== true ? (ran.result as BashOutput) : undefined
    await end(io, e.tool_use_id, output?.backgroundTaskId)
    return ran
  })

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    const io = connected()
    const taskId = e.task_id ?? e.shell_id
    if (io !== undefined && taskId !== undefined && ran.deny === undefined && ran.isError !== true) {
      await settle(io, { taskId, status: 'killed' })
    }
    return ran
  })

  // A background shell's end arrives as a <task-notification> row.
  on('session.append', async ($, e, next) => {
    const io = connected()
    if (io !== undefined && e.door !== 'response' && e.door !== 'tool-result' && e.door !== 'compaction') {
      const text = textOf(e.message.content)
      if (text.includes('<task-notification>')) {
        for (const note of parseNotifications(text)) await settle(io, note).catch(() => undefined)
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'Bash' } }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const input = (typeof e.props.input === 'object' && e.props.input !== null ? e.props.input : {}) as BashInput
    const command = input.command ?? ''
    const ownsOutput = e.viewport?.isFullscreen === true
    const card: Card = {
      els: $.ui.resolve(e),
      title: input.description?.trim() || command.split('\n')[0] || 'Shell',
      command,
      iconMode: iconMode(await $.env.get('SHELLCAST_ICONS')),
      run: await read($, memberOf(runs, e)),
      columns: e.viewport?.columns ?? 100,
      isOpen: await read($, memberOf(expanded, e)),
      toggle: ownsOutput ? () => update($, memberOf(expanded, e), open => !open) : undefined,
      ownsOutput,
    }
    return drawCard(card, e.props)
  })

  // In fullscreen the card draws the output itself; the engine's block would
  // repeat it. On the main screen the engine's block stays (ctrl+o expands it).
  on('ui.render', { component: 'ToolResult', props: { tool: 'Bash' } }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  // Keep the native Write(path) row, but omit the source preview beneath it.
  on('ui.render', { component: 'ToolResult', props: { tool: 'Write' } }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored) return next(e)
    const output = e.props.output as Partial<BuiltinToolResults['Write']> | null | undefined
    if (output?.staged || typeof output?.filePath !== 'string' || typeof output.content !== 'string') return next(e)
    const cwd = (await $.session.cwd()).replace(/\/$/, '')
    const path = output.filePath.startsWith(`${cwd}/`) ? output.filePath.slice(cwd.length + 1) : output.filePath
    const lines = countLines(output.content)
    const { Box, Text } = $.ui.resolve(e)
    return <Box paddingLeft={2}><Text>{`⎿  Wrote ${lines} ${lines === 1 ? 'line' : 'lines'} to ${path}`}</Text></Box>
  })

  // Keep live blocks open; finished ones become a single row of command icons.
  // The engine's own expanded mode (ctrl+o/verbose) always takes precedence.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isExpanded) return next(e)
    const hasShell = e.props.calls.some(call => call.tool === 'Bash')
    const unfold = () => next({ ...e, props: { ...e.props, isExpanded: true } })
    if (e.props.isActive || e.props.calls.length < 2) return hasShell ? unfold() : next(e)
    const observed = await Promise.all(e.props.calls.map(call => call.tool === 'Bash' && call.tool_use_id !== undefined
      ? read($, memberOf(runs, { requestId: call.tool_use_id })) : undefined))
    if (!canCollapseGroup(e.props.calls, observed)) return unfold()
    const state = memberOf(groupExpanded, e)
    const interactive = e.viewport?.isFullscreen === true
    const isOpen = interactive && await read($, state)
    const els = $.ui.resolve(e)
    const summary = drawGroup({
      els, calls: e.props.calls, runs: observed,
      iconMode: iconMode(await $.env.get('SHELLCAST_ICONS')),
      columns: e.viewport?.columns ?? 100,
      isOpen,
      toggle: interactive ? () => update($, state, open => !open) : undefined,
    })
    if (!isOpen) return summary
    const { Box } = els
    return <Box flexDirection="column">{summary}{await unfold()}</Box>
  })

  // A background shell's live card stays pinned above the prompt while it
  // runs, so it never scrolls away as the agent keeps writing; the footer's
  // "1 shell" says what it is doing too (it stays when the band is collapsed).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey) return next(e)
    const shells = await backgroundShells($)
    if (shells.length === 0) return next(e)
    const { Box } = $.ui.resolve(e)
    const below = await next(e)
    const icons = iconMode(await $.env.get('SHELLCAST_ICONS'))
    return (
      <Box flexDirection="column">
        {drawPinned($.ui.resolve(e), shells, e.props.bodyColumns, e.props.maxRows, icons)}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.tail !== undefined) return next(e)
    const tail = footerTail(await backgroundShells($))
    return next(tail === undefined ? e : { ...e, props: { ...e.props, tail } })
  })
}
