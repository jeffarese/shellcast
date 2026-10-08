// Rendering cost, scored: how many elements each draw builds (including any
// it throws away), how many it returns, and how long it takes. Element counts
// are deterministic and guarded; times are printed, never asserted.

import { expect, test } from 'claude-code/testing'

import type { ShellRun } from '../types'
import { drawCard, drawPinned, footerTail } from '../hooks/card'
import type { Card, Pinned, ToolUseProps } from '../hooks/card'

type Node = { type: string; children?: unknown[] }

const els = { Box: 'Box', Text: 'Text', Button: 'Button', Code: 'Code' } as unknown as Card['els']

const g = globalThis as unknown as { h: (...args: unknown[]) => unknown; performance: { now: () => number } }

function returned(tree: unknown): number {
  if (Array.isArray(tree)) return tree.reduce((sum: number, child) => sum + returned(child), 0)
  if (typeof tree !== 'object' || tree === null || !('type' in tree)) return 0
  return 1 + returned((tree as Node).children ?? [])
}

/** One draw's element counts, then its median time over many. */
function score(draw: () => unknown, rounds = 400) {
  const h = g.h
  let built = 0
  g.h = (...args: unknown[]) => {
    built += 1
    return h(...args)
  }
  let tree: unknown
  try {
    tree = draw()
  } finally {
    g.h = h
  }
  const times: number[] = []
  for (let i = 0; i < rounds; i++) {
    const at = g.performance.now()
    draw()
    times.push(g.performance.now() - at)
  }
  times.sort((a, b) => a - b)
  return { built, returned: returned(tree), us: Math.round((times[Math.floor(rounds / 2)] ?? 0) * 1000) }
}

const BIG = Array.from({ length: 600 }, (_, i) => `\x1b[32m✓\x1b[0m src/module-${i}.test.ts (12 tests) ${i}ms`).join('\n') + '\n'
const TAIL = Array.from({ length: 40 }, (_, i) => `[${i + 1}/120] compiling src/file-${i}.ts`)

const run = (change: Partial<ShellRun> = {}): ShellRun => ({
  startedAt: 1_000,
  spawnedAt: 1_100,
  now: 9_000,
  ticks: 25,
  timeoutMs: 120_000,
  bytes: 48_000,
  lines: 600,
  tail: TAIL,
  rates: Array.from({ length: 24 }, (_, i) => (i * 997) % 5000),
  ...change,
})

const card = (change: Partial<Card> = {}): Card => ({
  els,
  title: 'Run the test suite',
  command: 'npm test -- --run\n  --reporter=verbose',
  iconMode: 'nerd-bold',
  run: run({ endedAt: 9_000 }),
  columns: 120,
  isOpen: false,
  toggle: undefined,
  ownsOutput: false,
  ...change,
})

const props = (change: Partial<ToolUseProps> = {}): ToolUseProps => ({
  input: {},
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  ...change,
})

const done = { stdout: BIG, stderr: 'warn: deprecated\n', interrupted: false }
const failed = `Exit code 1\n${BIG}`
const shells: Pinned[] = ['Run e2e suite', 'Watch build', 'Tail server log'].map((title, i) => ({
  title,
  command: `npm run job-${i}`,
  run: run({ background: { taskId: `b${i}`, status: 'running' } }),
}))
const toggle = () => undefined

const SCENARIOS = {
  'done · icons off': () => drawCard(card({ iconMode: 'none' }), props({ output: done })),
  'done · main screen': () => drawCard(card(), props({ output: done })),
  'done · fullscreen': () => drawCard(card({ ownsOutput: true, toggle }), props({ output: done })),
  'done · fullscreen, open': () => drawCard(card({ ownsOutput: true, toggle, isOpen: true }), props({ output: done })),
  'failed · fullscreen': () => drawCard(card({ ownsOutput: true, toggle }), props({ isErrored: true, output: failed })),
  'interrupted · main screen': () => drawCard(card(), props({ isInterrupted: true })),
  'running · compact row': () => drawCard(card({ run: run(), ownsOutput: true, toggle }), props({ isRunning: true })),
  'background · transcript row': () =>
    drawCard(card({ run: run({ background: { taskId: 'b1', status: 'running' } }) }), props({ output: { backgroundTaskId: 'b1' } })),
  'band · icons off': () => drawPinned(els, shells, 120, 40, 'none'),
  'band · 3 pinned shells': () => drawPinned(els, shells, 120, 40, 'nerd-bold'),
  'band · 3 full cards': () => drawPinned(els, shells, 120, 40, 'nerd-bold', 'cards'),
  'footer · 3 shells': () => footerTail(shells),
}

/** Elements built per draw, today: a draw that builds more has regressed. */
const BUDGET: Record<keyof typeof SCENARIOS, number> = {
  'done · icons off': 10,
  'done · main screen': 11,
  'done · fullscreen': 13,
  'done · fullscreen, open': 157,
  'failed · fullscreen': 13,
  'interrupted · main screen': 11,
  'running · compact row': 13,
  'background · transcript row': 11,
  'band · icons off': 28,
  'band · 3 pinned shells': 31,
  'band · 3 full cards': 97,
  'footer · 3 shells': 0,
}

test('rendering score', () => {
  const rows: string[] = []
  const over: string[] = []
  for (const [name, draw] of Object.entries(SCENARIOS) as [keyof typeof SCENARIOS, () => unknown][]) {
    const { built, returned: kept, us } = score(draw)
    rows.push(`${name.padEnd(30)} built ${String(built).padStart(4)}  returned ${String(kept).padStart(4)}  ${String(us).padStart(5)} µs`)
    if (built > BUDGET[name]) over.push(`${name}: ${built} > ${BUDGET[name]}`)
  }
  console.log(`\n${rows.join('\n')}`)
  expect(over).toEqual([])
})
