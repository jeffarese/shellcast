import type { ToolGroupCall } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { canCollapseGroup, groupDuration, groupIcons, groupSummary } from '../hooks/group'
import { BLANK } from '../hooks/live'

const VIEWPORT = { columns: 100, rows: 40, isFullscreen: true }
const call = (command: string, extra: Partial<ToolGroupCall> = {}): ToolGroupCall => ({
  tool: 'Bash', input: { command }, isRunning: false, isErrored: false, isInterrupted: false,
  output: { stdout: 'done\n', stderr: '', interrupted: false }, ...extra,
})
const CALLS = [call('cat a.ts'), call('cat b.ts'), call('rg TODO src'), call('npm test')]
const PROPS = { calls: CALLS, isActive: false, isExpanded: false }

function native(on: Parameters<TestBody>[1]) {
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`${e.props.isExpanded ? 'expanded' : 'native'} ${e.props.calls.length} rows`}</Text>
  })
}

test('finished blocks describe the work and keep deduplicated command icons', async ($, on) => {
  mock.env(on, {})
  native(on)
  const ui = await $.ui.mount({ plugin: 'shellcast', surface: 'terminal', component: 'ToolGroup', viewport: VIEWPORT, props: PROPS })
  expect(await ui.find({ type: 'Text', text: 'Ran 4 shell commands' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  ▤×2  ⌕  ⚗' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✔ ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /expanded|native/ })).toBeUndefined()
  await ui.press({ key: 'group-details' })
  expect(await ui.find({ type: 'Text', text: 'expanded 4 rows' })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'group-details' }))?.text).toContain('less')
  await ui.press({ key: 'group-details' })
  expect(await ui.find({ type: 'Text', text: 'expanded 4 rows' })).toBeUndefined()
})

test('group disclosure is local to the selected block', async ($, on) => {
  mock.env(on, {})
  native(on)
  const mount = (requestId: string) => $.ui.mount({ plugin: 'shellcast', surface: 'terminal', component: 'ToolGroup', requestId, viewport: VIEWPORT, props: PROPS })
  const first = await mount('first-block')
  const second = await mount('second-block')
  await first.press({ key: 'group-details' })
  expect(await first.find({ type: 'Text', text: 'expanded 4 rows' })).toBeDefined()
  expect(await second.find({ type: 'Text', text: 'expanded 4 rows' })).toBeUndefined()
})

test('live blocks keep their rows until the block finishes', async ($, on) => {
  mock.env(on, {})
  native(on)
  const ui = await $.ui.mount({ plugin: 'shellcast', surface: 'terminal', component: 'ToolGroup', viewport: VIEWPORT, props: { ...PROPS, isActive: true } })
  expect(await ui.find({ type: 'Text', text: 'expanded 4 rows' })).toBeDefined()
  await ui.redraw(PROPS)
  expect(await ui.find({ type: 'Text', text: 'Ran 4 shell commands' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'expanded 4 rows' })).toBeUndefined()
})

test('running, failed, interrupted, pending and staged tools never disappear into a success summary', async ($, on) => {
  mock.env(on, {})
  native(on)
  for (const state of [{ isRunning: true }, { isErrored: true }, { isInterrupted: true }, { output: undefined }, { output: { staged: true } }]) {
    const ui = await $.ui.mount({ plugin: 'shellcast', surface: 'terminal', component: 'ToolGroup', viewport: VIEWPORT,
      props: { ...PROPS, calls: [CALLS[0]!, call('npm test', state)] } })
    expect(await ui.find({ type: 'Text', text: 'expanded 2 rows' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✔ ' })).toBeUndefined()
  }
})

test('explicit expansion and other surfaces retain the native group', async ($, on) => {
  native(on)
  const expanded = await $.ui.mount({ plugin: 'shellcast', surface: 'terminal', component: 'ToolGroup', viewport: VIEWPORT, props: { ...PROPS, isExpanded: true } })
  expect(await expanded.find({ type: 'Text', text: 'expanded 4 rows' })).toBeDefined()
  expect(await expanded.find({ type: 'Button' })).toBeUndefined()
  const desktop = await $.ui.mount({ plugin: 'shellcast', surface: 'desktop', component: 'ToolGroup', props: PROPS })
  expect(await desktop.find({ type: 'Text', text: 'native 4 rows' })).toBeDefined()
})

test('main-screen groups use ctrl+o, while narrow fullscreen groups keep a small disclosure', async ($, on) => {
  mock.env(on, { SHELLCAST_ICONS: 'none' })
  const main = await $.ui.mount({ plugin: 'shellcast', surface: 'terminal', component: 'ToolGroup', viewport: { ...VIEWPORT, isFullscreen: false }, props: PROPS })
  expect(await main.find({ type: 'Text', text: 'Ran 4 shell commands' })).toBeDefined()
  expect(await main.find({ type: 'Text', text: /ctrl\+o/ })).toBeDefined()
  expect(await main.find({ type: 'Button' })).toBeUndefined()
  expect(await main.find({ type: 'Text', text: /▤/ })).toBeUndefined()
  const narrow = await $.ui.mount({ plugin: 'shellcast', surface: 'terminal', component: 'ToolGroup', viewport: { ...VIEWPORT, columns: 32 }, props: PROPS })
  expect((await narrow.find({ type: 'Button', key: 'group-details' }))?.text).toBe('▸')
})

test('mixed and native-only tool groups retain recognizable icons in every mode', async ($, on) => {
  mock.env(on, { SHELLCAST_ICONS: 'nerd-bold' })
  const calls = [call('', { tool: 'Read', input: { file_path: 'a.ts' } }), call('', { tool: 'Grep', input: { pattern: 'TODO' } }), call('npm test')]
  const ui = await $.ui.mount({ plugin: 'shellcast', surface: 'terminal', component: 'ToolGroup', viewport: VIEWPORT, props: { ...PROPS, calls } })
  expect(await ui.find({ type: 'Text', text: 'Searched for 1 pattern, read 1 file, ran 1 shell command' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  \uf0f6  \uf002  \uf0c3' })).toBeDefined()
  expect(groupIcons(calls.slice(0, 2), 'unicode')).toBe('▤  ⌕')
  expect(groupIcons(calls, 'nerd')).toBe('\uea7b  \uea6d  \uea79')
  expect(groupIcons(calls, 'none')).toBe('')
})

test('summaries count native tools separately from shell commands and use singular/plural descriptions', () => {
  const tool = (name: string) => call('', { tool: name })
  expect(groupSummary([tool('Read'), ...Array.from({ length: 7 }, () => call('rg TODO src')), tool('Grep')]))
    .toBe('Searched for 1 pattern, read 1 file, ran 7 shell commands')
  expect(groupSummary([tool('Grep'), tool('Glob'), tool('Read'), tool('Read'), tool('LS'), tool('LS')]))
    .toBe('Searched for 2 patterns, read 2 files, listed 2 directories')
  expect(groupSummary([tool('Write'), tool('Edit'), tool('MultiEdit'), tool('WebSearch'), tool('WebSearch'), tool('WebFetch')]))
    .toBe('Wrote 1 file, edited 2 files, ran 2 web searches, fetched 1 page')
  expect(groupSummary([tool('Read'), tool('mcp__docs__lookup')])).toBe('Read 1 file, used 1 other tool')
  expect(groupSummary([tool('mcp__docs__lookup'), tool('mcp__docs__lookup')])).toBe('Used 2 tools')
})

test('background jobs only collapse after successful completion is observed', () => {
  const calls = [CALLS[0]!, call('npm test', { output: { backgroundTaskId: 'b42' } })]
  expect(canCollapseGroup(calls, [])).toBe(false)
  for (const background of [
    { taskId: 'b42', status: 'running' },
    { taskId: 'b42', status: 'failed', exitCode: 1 },
    { taskId: 'b42', status: 'killed' },
    { taskId: 'b42', status: 'completed', exitCode: 1 },
  ]) expect(canCollapseGroup(calls, [undefined, { ...BLANK, background }])).toBe(false)
  expect(canCollapseGroup(calls, [undefined, { ...BLANK, background: { taskId: 'b42', status: 'completed', exitCode: 0 } }])).toBe(true)
  expect(canCollapseGroup([CALLS[0]!], [])).toBe(false)
})

test('group time spans observed shells once, and omits unknown or mixed-tool timing', () => {
  const calls = CALLS.slice(0, 2)
  const runs = [{ ...BLANK, startedAt: 1000, spawnedAt: 1500, endedAt: 4000 }, { ...BLANK, startedAt: 2000, endedAt: 5000 }]
  expect(groupDuration(calls, runs)).toBe(3500)
  expect(groupDuration(calls, [runs[0], undefined])).toBeUndefined()
  expect(groupDuration(calls, [runs[0], BLANK])).toBeUndefined()
  expect(groupDuration([calls[0]!, call('', { tool: 'Read' })], runs)).toBeUndefined()
  expect(groupDuration(calls, [runs[0], { ...runs[1]!, background: { taskId: 'b42', status: 'completed', endedAt: 6000 } }])).toBe(4500)
})
