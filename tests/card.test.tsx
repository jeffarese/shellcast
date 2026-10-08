import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { footerTail } from '../hooks/card'
import { BLANK } from '../hooks/live'

const PLUGIN = 'shellcast'
const VIEWPORT = { columns: 100, rows: 40, isFullscreen: true }

const call = (props: object) => ({
  tool_use_id: 'toolu_test',
  tool: 'Bash',
  input: { command: 'npm test -- --run', description: 'Run unit tests' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...props,
})

test('a call that just started is a compact row, so quick ones never flash', async ($, on) => {
  mock.env(on, {})
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    props: call({ isRunning: true }),
  })
  expect(await ui.find({ type: 'Text', text: 'Run unit tests' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$ npm test -- --run' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'running' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /waiting for output/ })).toBeUndefined()
})

test('a call the model is still writing is pending, not finished', async ($, on) => {
  mock.env(on, {})
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    props: call({ input: {} }),
  })
  expect(await ui.find({ type: 'Text', text: 'starting' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✔ ' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
})

test('long-running shells stay compact and only expand when details are requested', async ($, on) => {
  mock.env(on, {})
  const clock = mock.clock(on, { now: 1_000 })
  on('session.start', () => ({ cwd: '/work' }))
  let id = ''
  let finish = () => {}
  const held = new Promise<void>(resolve => (finish = resolve))
  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    id = e.tool_use_id
    await held
    return { result: { stdout: 'done\n', stderr: '', interrupted: false } }
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const running = $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Run unit tests' })
  await clock.advance(90_000)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    requestId: id,
    viewport: VIEWPORT,
    props: call({ tool_use_id: id, isRunning: true }),
  })
  expect(await ui.find({ type: 'Text', text: /waiting for output/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'running · 1m 30s' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'details' })).toBeDefined()
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Code' })).toBeDefined()
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  finish()
  expect((await running).deny).toBeUndefined()
})

test('a finished call is a compact row with its last output', async ($, on) => {
  mock.env(on, {})
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    props: call({
      output: { stdout: 'one\ntwo\nTests  12 passed\n', stderr: '', interrupted: false },
    }),
  })
  expect(await ui.find({ type: 'Text', text: '✔ ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⚗ ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '3 lines' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Tests  12 passed' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'one' })).toBeUndefined()
})

test('details open the full output and close again', async ($, on) => {
  mock.env(on, {})
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    props: call({
      output: { stdout: 'one\ntwo\nthree\n', stderr: 'warn: careful\n', interrupted: false },
    }),
  })
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Text', text: 'one' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'warn: careful' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'details' }))?.text).toContain('less')
  await ui.press({ key: 'details' })
  expect(await ui.find({ type: 'Text', text: 'one' })).toBeUndefined()
})

test('directory setup is hidden in compact titles but retained in command details', async ($, on) => {
  mock.env(on, {})
  const command = 'cd /long/worktree/dashboard && git status --short'
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', viewport: VIEWPORT,
    props: call({ input: { command }, isRunning: true }),
  })
  expect(await ui.find({ type: 'Text', text: 'git status --short' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cd \/long/ })).toBeUndefined()
  await ui.press({ key: 'details' })
  expect(JSON.stringify(await ui.drawn())).toContain(command)
  await ui.press({ key: 'details' })
  await ui.redraw(call({ input: { command, description: 'Check worktree status' }, output: { stdout: '' } }))
  expect(await ui.find({ type: 'Text', text: 'Check worktree status' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$ git status --short' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cd \/long/ })).toBeUndefined()
})

test('bold Nerd Font command icons stay the same as execution status changes', async ($, on) => {
  mock.env(on, { SHELLCAST_ICONS: 'nerd-bold' })
  for (const state of [
    { isRunning: true },
    { output: { stdout: 'passed\n', stderr: '', interrupted: false } },
    { isErrored: true, output: 'Exit code 1\nfailed' },
    { isInterrupted: true },
  ]) {
    const ui = await $.ui.mount({
      plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', viewport: VIEWPORT,
      props: call({ input: { command: 'cd project && npm test', description: 'Run tests' }, ...state }),
    })
    expect(await ui.find({ type: 'Text', text: '\uf0c3 ' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '\uea79 ' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '⚗ ' })).toBeUndefined()
  }
})

test('icons can be disabled while preserving the status and title', async ($, on) => {
  mock.env(on, { SHELLCAST_ICONS: 'none' })
  const ui = await $.ui.mount({
    plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', viewport: VIEWPORT,
    props: call({ output: { stdout: 'passed\n', stderr: '', interrupted: false } }),
  })
  expect(await ui.find({ type: 'Text', text: '✔ ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Run unit tests' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⚗ ' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '\uea79 ' })).toBeUndefined()
})

test('a failing call draws its exit code and output', async ($, on) => {
  mock.env(on, {})
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    viewport: VIEWPORT,
    props: call({ isErrored: true, output: 'Exit code 2\nFAIL src/a.test.ts\nexpected 1 got 2' }),
  })
  expect(await ui.find({ type: 'Text', text: 'exit 2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'expected 1 got 2' })).toBeDefined()
})

test('a refused call is not drawn as a failure', async ($, on) => {
  mock.env(on, {})
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    props: call({ isErrored: true, output: "The user doesn't want to proceed with this tool use." }),
  })
  expect(await ui.find({ type: 'Text', text: 'not run' })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
})

const RESULT = { tool_use_id: 'toolu_test', tool: 'Bash', output: { stdout: 'x', stderr: '' }, isErrored: false }

test('in fullscreen the card owns the output and the engine block is hidden', async $ => {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolResult',
    viewport: VIEWPORT,
    props: RESULT,
  })
  expect(await ui.drawn()).toMatchObject({ type: 'Box' })
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
})

test('on the main screen the engine keeps its result block and the card no tail', async ($, on) => {
  mock.env(on, {})
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine result</Text>
  })
  const MAIN = { columns: 100, rows: 40, isFullscreen: false }
  const result = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolResult', viewport: MAIN, props: RESULT })
  expect(await result.find({ type: 'Text', text: 'engine result' })).toBeDefined()
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    viewport: MAIN,
    props: call({ output: { stdout: 'only line\n', stderr: '', interrupted: false } }),
  })
  expect(await row.find({ type: 'Text', text: '1 line' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: 'only line' })).toBeUndefined()
  expect(await row.find({ type: 'Button' })).toBeUndefined()
})

test('other surfaces keep their own rows', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine row</Text>
  })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'ToolUse', props: call({}) })
  expect(await ui.find({ type: 'Text', text: 'engine row' })).toBeDefined()
})

test('a call the agent ran is timed and drawn from what the mod observed', async ($, on) => {
  mock.env(on, {})
  const clock = mock.clock(on, { now: 1_000 })
  on('session.start', () => ({ cwd: '/work' }))
  let id = ''
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    id = e.tool_use_id
    return { result: { stdout: 'built\n', stderr: '', interrupted: false } }
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({ tool: 'Bash', command: 'make', description: 'Build it' })
  expect(ran.deny).toBeUndefined()
  expect(clock.now()).toBe(1_000)
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    requestId: id,
    props: call({
      tool_use_id: id,
      input: { command: 'make', description: 'Build it' },
      output: { stdout: 'built\n', stderr: '', interrupted: false },
    }),
  })
  expect(await ui.find({ type: 'Text', text: '0.0s · 1 line' })).toBeDefined()
})

async function startBackgrounds($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], taskIds = ['b42']) {
  mock.clock(on, { now: 1_000 })
  on('session.start', () => ({ cwd: '/work' }))
  on('classic.Stop', () => ({}))
  const ids: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    const taskId = taskIds[ids.length]
    ids.push(e.tool_use_id)
    return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: taskId } }
  })
  // What the engine draws beneath the plugin: an empty band, the hint as given.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`${e.props.hint}${e.props.tail === undefined ? '' : ` ${e.props.tail}`}`}</Text>
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const taskId of taskIds) {
    await $.tool.call({ tool: 'Bash', command: './scripts/e2e.sh', description: taskIds.length === 1 ? 'Run the e2e suite' : `Job ${taskId}`, run_in_background: true })
  }
  return ids
}

async function startBackground(...[$, on]: Parameters<TestBody>) {
  return (await startBackgrounds($, on))[0]!
}

const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 90, scroll: { offset: 0, bodyRows: 10 }, view: {} }

test('background shells stay compact even when the terminal has room for cards', async ($, on) => {
  mock.env(on, { SHELLCAST_ICONS: 'nerd' })
  await startBackground($, on)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { ...BAND, maxRows: 60 } })
  expect(await band.find({ type: 'Text', text: /Run the e2e suite/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'background' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: '\uea85 ' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /waiting for output/ })).toBeDefined()
})

test('full background cards remain available by explicit preference', async ($, on) => {
  mock.env(on, { SHELLCAST_BACKGROUND: 'cards' })
  await startBackground($, on)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: BAND })
  expect(await band.find({ type: 'Text', text: 'background' })).toBeDefined()
})

test('the compact band caps visible jobs and reserves room for overflow', async ($, on) => {
  mock.env(on, {})
  await startBackgrounds($, on, ['b1', 'b2', 'b3', 'b4', 'b5'])
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { ...BAND, maxRows: 60 } })
  expect(await band.find({ type: 'Text', text: /Job b3/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Job b4/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: '  +2 more in the background' })).toBeDefined()
  await band.redraw({ ...BAND, maxRows: 3 })
  expect(await band.find({ type: 'Text', text: /Job b3/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: '  +3 more in the background' })).toBeDefined()
  await band.redraw({ ...BAND, maxRows: 0 })
  expect(await band.find({ type: 'Text' })).toBeUndefined()
})

test('engine task snapshots remove ghosts while preserving quiet running shells', async ($, on) => {
  mock.env(on, {})
  const ids = await startBackgrounds($, on, ['b1', 'b2', 'b3', 'b4', 'b5'])
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [
    { id: 'b4', type: 'shell', status: 'running', description: 'Quiet job' },
    { id: 'b5', type: 'shell', status: 'running', description: 'Other job' },
    { id: 'agent1', type: 'subagent', status: 'running', description: 'Agent' },
  ] })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: BAND })
  expect(await band.find({ type: 'Text', text: /Job b1/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /Job b4/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /Job b5/ })).toBeDefined()
  const row = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'ToolUse', requestId: ids[0], viewport: VIEWPORT,
    props: call({ tool_use_id: ids[0], output: { backgroundTaskId: 'b1' } }) })
  expect(await row.find({ type: 'Text', text: /finished · exit unknown/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: '✔ ' })).toBeUndefined()
  // A late notice refines the unknown result, although the run is no longer active.
  await $.session.append({ door: 'delivery', origin: { kind: 'task-notification' }, uuid: 'late-completion', message: { type: 'user', content: [{ type: 'text', text:
    '<task-notification><task-id>b1</task-id><status>failed</status><summary>exit code 2</summary></task-notification>',
  }] } })
  await row.redraw(call({ tool_use_id: ids[0], output: { backgroundTaskId: 'b1' } }))
  expect(await row.find({ type: 'Text', text: /background · exit 2/ })).toBeDefined()
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
  await band.redraw(BAND)
  expect(await band.find({ type: 'Text' })).toBeUndefined()
})

test('missing or subagent snapshots do not retire the main session shells', async ($, on) => {
  mock.env(on, {})
  await startBackground($, on)
  await $.classic.Stop({ stop_hook_active: false })
  await $.classic.Stop({ stop_hook_active: false, agent_id: 'agent1', background_tasks: [] })
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: BAND })
  expect(await band.find({ type: 'Text', text: /Run the e2e suite/ })).toBeDefined()
})

test('the footer describes one job and counts the rest', () => {
  const shells = ['One', 'Two', 'Three'].map(title => ({ title, command: 'sleep 100', run: BLANK }))
  expect(footerTail(shells)).toBe('→ One · +2 more')
})

test('in the transcript it stays one row that points at the pinned card', async ($, on) => {
  mock.env(on, {})
  const id = await startBackground($, on)
  const row = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'terminal',
    component: 'ToolUse',
    requestId: id,
    viewport: VIEWPORT,
    props: call({ tool_use_id: id, output: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b42' } }),
  })
  expect(await row.find({ type: 'Text', text: /^pinned ↓/ })).toBeDefined()
  expect(await row.find({ type: 'Text', text: /waiting for output/ })).toBeUndefined()
})

test('a pinned band with little room falls back to one row per shell', async ($, on) => {
  mock.env(on, { SHELLCAST_ICONS: 'nerd' })
  await startBackground($, on)
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', viewport: VIEWPORT, props: { ...BAND, maxRows: 3 } })
  expect(await band.find({ type: 'Text', text: /Run the e2e suite/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /waiting for output/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'background' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: '\uea85 ' })).toBeDefined()
})

test("the footer's shell count says what the shell is doing", async ($, on) => {
  await startBackground($, on)
  const hint = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', viewport: VIEWPORT, props: { hint: '1 shell', isDraft: false, isWorking: true } })
  expect(await hint.find({ type: 'Text', text: /^1 shell → Run the e2e suite/ })).toBeDefined()
})
