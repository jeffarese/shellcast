/** A background shell's life after its call returned. */
export type ShellBackground = {
  taskId: string
  /** `running`, then the notification's word: `completed`, `failed`, `killed`. */
  status: string
  exitCode?: number
  endedAt?: number
}

/** What the mod observed of one Bash call, keyed by its tool_use_id. */
export type ShellRun = {
  /** What the call was for: its description, else its command's first line. */
  title?: string
  /** When `tool.call` fired (includes any permission wait); 0 when unknown. */
  startedAt: number
  /** When its output file first appeared: the process really started. */
  spawnedAt?: number
  endedAt?: number
  /** The last tick's clock; drives elapsed time while running. */
  now: number
  /** Ticks seen while live; drives the spinner and shimmer frames. */
  ticks: number
  timeoutMs: number
  /** The live output file's name in the session's tasks folder. */
  file?: string
  bytes: number
  lines?: number
  /** Last lines of output, ANSI stripped, carriage returns resolved. */
  tail: string[]
  /** Bytes per second, one sample per tick, newest last. */
  rates: number[]
  background?: ShellBackground
}

declare module 'claude-code' {
  interface PluginState {
    'shellcast': {
      runs: StateFamily<ShellRun>
      expanded: StateFamily<boolean>
      active: string[]
    }
  }
}
