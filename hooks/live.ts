// Following a shell while it runs. Claude Code streams each shell's combined
// output to <tmp>/claude-<uid>/<project>/<session>/tasks/b<id>.output; a call
// claims the first such file that appeared after it started, and a ticker
// samples every live one into the call's run until it ends.

import type { FsEntry, FsStat, Timer } from 'claude-code'

import type { ShellRun } from '../types'
import { countLines, projectSlug, tailLines } from './format'
import type { Notification } from './format'

/** What the tracker needs from the engine, bound to `$` by the hooks module. */
export type Io = {
  now: () => Promise<number>
  sessionId: () => Promise<string>
  places: () => Promise<string[]>
  tmpdir: () => Promise<string | undefined>
  uid: () => Promise<string>
  tail: (path: string) => Promise<string>
  list: (path: string) => Promise<FsEntry[]>
  exists: (path: string) => Promise<boolean>
  stat: (path: string) => Promise<FsStat>
  read: (path: string) => Promise<string>
  every: (ms: number, fn: () => void) => Timer
  log: (text: string) => void
  getRun: (id: string) => Promise<ShellRun>
  setRun: (id: string, change: (run: ShellRun) => ShellRun) => Promise<ShellRun>
  getActive: () => Promise<readonly string[]>
  setActive: (change: (ids: readonly string[]) => string[]) => Promise<readonly string[]>
}

export const TICK_MS = 300
export const DEFAULT_TIMEOUT_MS = 120_000
export const READ_WHOLE_BYTES = 256 * 1024
const KEEP_LINES = 40
const RATE_SAMPLES = 24

export const BLANK: ShellRun = {
  startedAt: 0,
  now: 0,
  ticks: 0,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  bytes: 0,
  tail: [],
  rates: [],
}

// What the module keeps between ticks. A hot reload starts these over; the
// runs themselves live in `$.state`, so cards keep drawing either way.
let io: Io | undefined
let ticker: Timer | undefined
let isTicking = false
let tasks: { session: string; dir: string } | undefined
let lastScanAt = 0
let uid: string | undefined
const baselines = new Map<string, ReadonlySet<string>>()
const claimed = new Set<string>()

export function connect(next: Io) {
  io = next
}

export function connected(): Io | undefined {
  return io
}

/** Where a run's live output file sits, once the tasks folder is known. */
export function streamPath(file: string): string | undefined {
  return tasks === undefined ? undefined : `${tasks.dir}/${file}`
}

async function tempBases(io: Io): Promise<string[]> {
  uid ??= (await io.uid().catch(() => '')) || undefined
  if (uid === undefined) return []
  const custom = await io.tmpdir()
  const roots = [custom, '/tmp'].filter((root): root is string => root !== undefined && root !== '')
  return [...new Set(roots.map(root => `${root.replace(/\/+$/, '')}/claude-${uid}`))]
}

export async function tasksDir(io: Io): Promise<string | undefined> {
  const session = await io.sessionId()
  if (tasks?.session === session) return tasks.dir
  const now = await io.now()
  const bases = await tempBases(io)
  const places = new Set(await io.places())
  for (const base of bases) {
    for (const place of places) {
      const dir = `${base}/${projectSlug(place)}/${session}/tasks`
      if (await io.exists(dir)) return (tasks = { session, dir }).dir
    }
  }
  // A long path is hashed into its folder's name: look the session up
  // instead, at most every few seconds.
  if (now - lastScanAt < 5000) return undefined
  lastScanAt = now
  for (const base of bases) {
    for (const project of await io.list(base).catch(() => [])) {
      if (project.kind !== 'dir') continue
      const dir = `${base}/${project.name}/${session}/tasks`
      if (await io.exists(dir)) return (tasks = { session, dir }).dir
    }
  }
  return undefined
}

async function outputsIn(io: Io, dir: string): Promise<Set<string>> {
  const entries = await io.list(dir).catch(() => [])
  return new Set(entries.filter(entry => /^b\w+\.output$/.test(entry.name)).map(entry => entry.name))
}

async function readOutput(io: Io, path: string, bytes: number) {
  if (bytes <= READ_WHOLE_BYTES) {
    const text = await io.read(path)
    return { text, lines: countLines(text) }
  }
  const text = await io.tail(path)
  return { text: text.slice(text.indexOf('\n') + 1), lines: undefined }
}

/** One look at a live output file: what changed since the run's last tick. */
async function sample(io: Io, path: string, run: ShellRun, now: number): Promise<Partial<ShellRun> | 'gone'> {
  const stat = await io.stat(path).catch(() => undefined)
  if (stat === undefined) return 'gone'
  const seconds = Math.max(0.05, (now - run.now) / 1000)
  const rate = Math.max(0, (stat.size - run.bytes) / seconds)
  const rates = [...run.rates, rate].slice(-RATE_SAMPLES)
  if (stat.size === run.bytes) return { rates }
  const output = await readOutput(io, path, stat.size).catch(() => undefined)
  if (output === undefined) return { rates }
  return {
    rates,
    bytes: stat.size,
    tail: tailLines(output.text, KEEP_LINES),
    ...(output.lines === undefined ? {} : { lines: output.lines }),
  }
}

async function tick(io: Io) {
  if (isTicking) return
  isTicking = true
  try {
    const ids = await io.getActive()
    if (ids.length === 0) {
      stopTicker()
      return
    }
    const now = await io.now()
    const dir = await tasksDir(io).catch(() => undefined)
    let present: Set<string> | undefined
    const finished: string[] = []
    for (const id of ids) {
      const run = await io.getRun(id)
      if (run.startedAt === 0) {
        finished.push(id)
        continue
      }
      let file = run.file
      const baseline = baselines.get(id)
      if (file === undefined && dir !== undefined && baseline !== undefined) {
        present ??= await outputsIn(io, dir)
        file = [...present].find(name => !baseline.has(name) && !claimed.has(name))
        if (file !== undefined) {
          claimed.add(file)
          io.log(`${id} streams ${dir}/${file}`)
        }
      }
      const seen = file !== undefined && dir !== undefined ? await sample(io, `${dir}/${file}`, run, now) : {}
      const isGone = seen === 'gone'
      const isOverdue = file === undefined && now - run.startedAt > run.timeoutMs + 60_000
      const isSettled = run.background !== undefined && run.background.status !== 'running'
      if (isGone || isOverdue || isSettled) finished.push(id)
      await io.setRun(id, current => ({
        ...current,
        ...(isGone ? {} : seen),
        ...(file !== undefined && current.file === undefined ? { file, spawnedAt: now } : {}),
        now,
        ticks: current.ticks + 1,
      }))
    }
    if (finished.length > 0) await io.setActive(list => list.filter(id => !finished.includes(id)))
  } catch (error) {
    io.log(`tick failed: ${String(error)}`)
  } finally {
    isTicking = false
  }
}

export function ensureTicker() {
  if (ticker !== undefined || io === undefined) return
  const bound = io
  ticker = bound.every(TICK_MS, () => void tick(bound))
}

function stopTicker() {
  ticker?.cancel()
  ticker = undefined
}

/** A shell call is about to run: remember which output files already exist. */
export async function begin(io: Io, id: string, timeoutMs: number | undefined) {
  const startedAt = await io.now()
  const dir = await tasksDir(io).catch(() => undefined)
  baselines.set(id, dir === undefined ? new Set() : await outputsIn(io, dir))
  await io.setRun(id, () => ({ ...BLANK, startedAt, now: startedAt, timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS }))
  await io.setActive(list => [...list.filter(other => other !== id), id])
  ensureTicker()
}

/** The call returned: done, or moved to the background under `taskId`. */
export async function end(io: Io, id: string, taskId: string | undefined) {
  baselines.delete(id)
  const endedAt = await io.now()
  if (taskId === undefined) {
    const run = await io.setRun(id, current => ({
      ...current,
      now: endedAt,
      endedAt,
      tail: current.tail.slice(-12),
      rates: [],
    }))
    io.log(`${id} ended after ${run.ticks} ticks, ${run.bytes} B, tail ${JSON.stringify(run.tail.slice(-2))}`)
    await io.setActive(list => list.filter(other => other !== id))
    return
  }
  const file = `${taskId}.output`
  claimed.add(file)
  await io.setRun(id, run => ({
    ...run,
    now: endedAt,
    file,
    spawnedAt: run.spawnedAt ?? endedAt,
    background: { taskId, status: 'running' },
  }))
  ensureTicker()
}

/** A background shell ended (its notification arrived, or TaskStop ran). */
export async function settle(io: Io, note: Notification) {
  for (const id of await io.getActive()) {
    const run = await io.getRun(id)
    if (run.background?.taskId !== note.taskId) continue
    const now = await io.now()
    const path = run.file === undefined ? undefined : streamPath(run.file)
    const last = path === undefined ? 'gone' : await sample(io, path, run, now)
    await io.setRun(id, current => ({
      ...current,
      ...(last === 'gone' ? {} : last),
      now,
      endedAt: now,
      background: {
        taskId: note.taskId,
        status: note.status,
        endedAt: now,
        ...(note.exitCode === undefined ? {} : { exitCode: note.exitCode }),
      },
    }))
    await io.setActive(list => list.filter(other => other !== id))
  }
}

/** The text blocks of a conversation row, joined. */
export function textOf(content: readonly unknown[]): string {
  let text = ''
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string') {
      text += block.text
    }
  }
  return text
}
