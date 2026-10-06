import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { drawCard } from './card'
import type { BashInput, BashOutput, Card } from './card'
import { parseNotifications } from './format'
import { BLANK, begin, connect, connected, end, ensureTicker, settle, textOf } from './live'

const runs = atom({ plugin: 'shellcast', key: 'runs' } as const, BLANK)
const expanded = atom({ plugin: 'shellcast', key: 'expanded' } as const, false)
const active = atom({ plugin: 'shellcast', key: 'active' } as const, [])

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
    })
    if ((await read($, active)).length > 0) ensureTicker()
    return started
  })

  // Observe every shell call: its start, its live output, how it ended. The
  // call itself passes through untouched.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const io = connected()
    if (io === undefined) return next(e)
    await begin(io, e.tool_use_id, e.timeout)
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

  // Shells folded into "ran 3 shell commands" would hide their cards.
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    const hasShell = e.props.calls.some(call => call.tool === 'Bash')
    if (e.surface !== 'terminal' || !hasShell || e.props.isExpanded) return next(e)
    return next({ ...e, props: { ...e.props, isExpanded: true } })
  })
}
