// Command labels only: this never evaluates or changes the shell command.

export type IconMode = 'unicode' | 'nerd' | 'nerd-bold' | 'none'

export function iconMode(value: string | undefined): IconMode {
  const mode = value?.trim().toLowerCase()
  return mode === 'nerd' || mode === 'nerd-bold' || mode === 'none' ? mode : 'unicode'
}

// Unicode, then set A (Codicons outlines), then set B (mostly Font Awesome).
// https://www.nerdfonts.com/cheat-sheet
const ICONS = {
  read: ['▤', '\uea7b', '\uf0f6'],          // file / file-text-o
  list: ['≡', '\ueb84', '\uf03a'],          // list-flat / list
  directory: ['↳', '\ueaf7', '\uf07c'],     // folder-opened / folder-open
  search: ['⌕', '\uea6d', '\uf002'],        // search
  edit: ['✎', '\uea73', '\uf040'],          // edit / pencil
  remove: ['⌫', '\uea81', '\uf1f8'],        // trash
  copy: ['⧉', '\uebcc', '\uf0c5'],          // copy
  move: ['→', '\uebcb', '\uf0ec'],          // arrow-swap / exchange
  create: ['⊞', '\uea80', '\u{f0257}'],     // new-folder / md-folder-plus
  git: ['⑂', '\uea68', '\ue702'],           // source-control / dev-git
  test: ['⚗', '\uea79', '\uf0c3'],          // beaker / flask
  build: ['⚙', '\ueaf8', '\uf013'],         // gear
  fetch: ['⇣', '\ueac2', '\uf019'],         // cloud-download / download
  script: ['λ', '\ueac4', '\uf121'],        // code
  shell: ['$', '\uea85', '\uf120'],         // terminal
} as const

type Kind = keyof typeof ICONS

const COMMANDS: Record<string, Kind> = {
  cat: 'read', head: 'read', tail: 'read', less: 'read', more: 'read', bat: 'read', batcat: 'read',
  wc: 'read', nl: 'read', stat: 'read', file: 'read', jq: 'read', awk: 'read', diff: 'read', cmp: 'read',
  ls: 'list', tree: 'list', eza: 'list', exa: 'list',
  cd: 'directory', pushd: 'directory', popd: 'directory',
  find: 'search', fd: 'search', fdfind: 'search', grep: 'search', egrep: 'search', fgrep: 'search', rg: 'search',
  vi: 'edit', vim: 'edit', nvim: 'edit', nano: 'edit', apply_patch: 'edit', patch: 'edit', tee: 'edit',
  rm: 'remove', rmdir: 'remove', unlink: 'remove',
  cp: 'copy', mv: 'move', mkdir: 'create', touch: 'create',
  git: 'git', gh: 'git',
  pytest: 'test', 'py.test': 'test', jest: 'test', vitest: 'test', mocha: 'test', ctest: 'test',
  make: 'build', gmake: 'build', cmake: 'build', ninja: 'build', tsc: 'build', esbuild: 'build',
  curl: 'fetch', wget: 'fetch',
}

/** Split only at unquoted shell separators; quoted arguments stay together. */
function* commands(source: string): Generator<{ words: string[]; separator: string; start: number; end: number }> {
  let words: string[] = []
  let start = 0
  let word = ''
  let started = false
  let quote = ''
  // A heredoc's end word, from `<<EOF`, `<<-EOF` or `<< EOF` (never `<<<`),
  // wherever on the line it was written: its body starts on the next line.
  let heredoc: string | undefined
  let wantsEnd = false
  const flush = () => {
    if (started) {
      if (wantsEnd) {
        heredoc = word
        wantsEnd = false
      } else if (/^<<(?!<)-?/.test(word)) {
        const end = word.replace(/^<<-?/, '')
        if (end === '') wantsEnd = true
        else heredoc = end
      }
      words.push(word)
    }
    word = ''
    started = false
  }
  // Labels need only the start, even for a very large heredoc or script.
  const text = source.slice(0, 4096)
  // A heredoc's body is input, not commands: skip to the line that ends it
  // (or to the end of what was read, where a long body was cut short).
  const afterHeredoc = (from: number): number => {
    const end = heredoc
    heredoc = undefined
    if (end === undefined) return from
    for (let at = from; at < text.length;) {
      const stop = text.indexOf('\n', at)
      const line = text.slice(at, stop < 0 ? text.length : stop)
      if (line.trim() === end) return stop < 0 ? text.length : stop + 1
      if (stop < 0) break
      at = stop + 1
    }
    return text.length
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '\\' && quote !== "'") {
      const next = text[i + 1]
      if (next === '\n') { i++; continue }
      if (next !== undefined) { word += next; started = true; i++; continue }
    }
    if (quote !== '') {
      if (ch === quote) quote = ''
      else word += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue }
    if (ch === '#' && !started) {
      while (i < text.length && text[i] !== '\n') i++
      i--
      continue
    }
    // `2>&1`, `>&2` and `&>file` redirect; their `&` separates nothing.
    if (ch === '&' && text[i + 1] !== '&' && (text[i - 1] === '>' || text[i - 1] === '<' || text[i + 1] === '>')) {
      word += ch
      started = true
      continue
    }
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      flush()
      const separator = (ch === '&' || ch === '|') && text[i + 1] === ch ? ch + text[++i] : ch
      const resume = ch === '\n' ? afterHeredoc(i + 1) : i + 1
      if (words.length > 0) yield { words, separator, start, end: i + 1 }
      words = []
      i = resume - 1
      start = resume
    } else if (/\s/.test(ch)) {
      flush()
    } else {
      word += ch
      started = true
    }
  }
  flush()
  if (words.length > 0) yield { words, separator: '', start, end: text.length }
}

/** A display-only label: omit leading cd setup, retaining the original syntax. */
export function commandLabel(source: string): string {
  let start = 0
  for (const part of commands(source)) {
    // Be conservative around substitutions, whose contents may contain shell
    // separators of their own. Never hide a standalone cd or a failure branch.
    if (part.words[0] !== 'cd' || !['&&', ';', '\n'].includes(part.separator)
      || /\$\(|`/.test(source.slice(part.start, part.end))) break
    if (source.slice(part.end).trim() === '') break
    start = part.end
  }
  return source.slice(start).replace(/\\\r?\n/g, ' ').trim().split('\n')[0]?.trim() ?? ''
}

const basename = (word: string) => word.split('/').pop() ?? word
const ASSIGNMENT = /^[A-Za-z_][A-Za-z_0-9]*=/

/** Strip common execution wrappers, including their option arguments. */
function executable(words: string[]): string[] {
  let i = 0
  while (i < words.length) {
    if (ASSIGNMENT.test(words[i]!)) { i++; continue }
    const name = basename(words[i]!)
    if (!['env', 'sudo', 'command', 'builtin', 'exec', 'time', 'nohup', 'timeout', 'gtimeout', 'nice'].includes(name)) break
    i++
    while (words[i]?.startsWith('-')) {
      const option = words[i++]!
      if (option === '--') break
      // These ask about a command without executing it.
      if (name === 'command' && /^-[vV]+$/.test(option)) return ['command']
      const takesValue = name === 'env' ? ['-u', '--unset', '-C', '--chdir']
        : name === 'sudo' ? ['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-D', '--chdir']
        : name === 'exec' ? ['-a'] : name === 'nice' ? ['-n', '--adjustment']
        : name === 'timeout' || name === 'gtimeout' ? ['-k', '--kill-after', '-s', '--signal'] : []
      if (takesValue.includes(option)) i++
    }
    // `timeout 30 npm test`: its duration is not the command.
    if ((name === 'timeout' || name === 'gtimeout') && i < words.length) i++
  }
  return words.slice(i)
}

// What opens a loop or a branch, before the command it runs.
const KEYWORDS = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '('])
// What closes one: nothing ran there.
const CLOSERS = new Set(['done', 'fi', 'esac', '}', ')'])
// Setup that says nothing about what a command line is for, when more follows.
const PREAMBLE = new Set(['set', 'export', 'unset', 'echo', 'printf', 'source', '.', 'true', ':', 'sleep', '[', '[[', 'test', 'for', 'case', 'trap', 'shopt', 'setopt'])
const INTERPRETERS = /^(?:python(?:\d+(?:\.\d+)?)?|node|deno|tsx|ts-node|ruby|perl|php|osascript|swift|bash|sh|zsh)$/

/** A command's words without its leading `do`, `then`, `while`…, and its wrappers. */
function operation(words: string[]): string[] {
  let i = 0
  while (i < words.length && KEYWORDS.has(words[i]!)) i++
  return executable(words.slice(i))
}

/** Whether a command is only setup: assignments, a directory change, an echo, a loop's head. */
function isPreamble(words: string[], kind: Kind): boolean {
  if (kind === 'directory' || words.length === 0) return true
  return kind === 'shell' && PREAMBLE.has(basename(words[0]!))
}

function kindOf(words: string[]): Kind {
  const name = basename(words[0] ?? '')
  const args = words.slice(1)
  // `npx vitest run`: the tool it runs says what it is for.
  if (/^(?:npx|bunx|pnpx|uvx)$/.test(name)) {
    const tool = args.findIndex(arg => !arg.startsWith('-'))
    const kind = tool < 0 ? 'shell' : kindOf(args.slice(tool))
    // `npx playwright test`: an unknown tool still says when it tests.
    return kind !== 'shell' ? kind : args[tool + 1] === 'test' ? 'test' : 'script'
  }
  // `cat > file <<EOF` and `cat a b > all` write a file; they read nothing for the reader.
  if ((name === 'cat' || name === 'echo' || name === 'printf')
    && args.some((arg, i) => /^>>?[^&>]/.test(arg) || ((arg === '>' || arg === '>>') && args[i + 1] !== undefined))) return 'edit'
  if (name === 'sed' || name === 'gsed') {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!
      if (arg === '--') break
      if (/^--in-place(?:=|$)|^-[^-ef]*i/.test(arg)) return 'edit'
      if (/^--(?:expression|file)$|^-[^-]*[ef]$/.test(arg)) i++
    }
    return 'read'
  }
  if (/^(?:npm|pnpm|yarn|bun|npx|bunx|cargo|go|make|gmake|cmake)$/.test(name)) {
    let i = 0
    while (args[i]?.startsWith('-')) {
      const option = args[i++]!
      if (['--prefix', '--cwd', '--dir', '-C', '--workspace', '-w', '--filter'].includes(option)) i++
    }
    if (args[i] === 'run' || args[i] === 'run-script' || args[i] === 'exec') i++
    const task = args[i] ?? ''
    if (/^(?:test|tests|test:.*|test-.*|pytest|jest|vitest|mocha|ctest)$/.test(task)) return 'test'
    if (/^(?:build|build:.*|build-.*|compile|tsc|esbuild)$/.test(task)) return 'build'
    if (/^(?:install|i|ci|add)$/.test(task) && !/^(?:make|gmake|cmake|go)$/.test(name)) return 'fetch'
  }
  if (/^(?:pip\d*|brew|uv)$/.test(name) && args.some(arg => arg === 'install' || arg === 'sync')) return 'fetch'
  if (/^python(?:\d+(?:\.\d+)?)?$/.test(name) && args[0] === '-m' && ['pytest', 'unittest'].includes(args[1] ?? '')) return 'test'
  if (name === 'node' && args.includes('--test')) return 'test'
  if (Object.prototype.hasOwnProperty.call(COMMANDS, name)) return COMMANDS[name]!
  // An interpreter running a file, a heredoc or a one-liner: a script.
  return INTERPRETERS.test(name) || /^(?:bun|uv)$/.test(name) ? 'script' : 'shell'
}

/**
 * What a command line is for: its first operation after any setup (directory
 * changes, assignments, echoes, a loop's head), never argument text.
 */
function kindOfLine(command: string): Kind {
  let kind: Kind = 'shell'
  for (const { words, separator } of commands(command)) {
    const run = operation(words)
    if (run.length === 0 && words.every(word => ASSIGNMENT.test(word) || KEYWORDS.has(word))) {
      // `OUT=/tmp/x; …`: only assignments. With nothing after it, a plain shell line.
      if (['&&', ';', '\n'].includes(separator)) continue
      break
    }
    if (CLOSERS.has(run[0] ?? '')) continue
    kind = kindOf(run)
    if (!isPreamble(run, kind) || !['&&', ';', '\n'].includes(separator)) break
  }
  return kind
}

export function commandIcon(command: string, mode: IconMode = 'unicode'): string {
  if (mode === 'none' || command.trim() === '') return ''
  return ICONS[kindOfLine(command)][mode === 'nerd-bold' ? 2 : mode === 'nerd' ? 1 : 0]
}

// Stages that only trim or reorder what the stage before them printed.
const TRIMMERS = new Set(['head', 'tail', 'sort', 'uniq', 'cut', 'tr', 'column', 'fold', 'nl', 'tee', 'less', 'more'])
const GIT_CONTENT = new Set(['diff', 'show', 'log', 'blame', 'grep', 'ls-files', 'ls-tree', 'cat-file', 'reflog'])

/** Whether one command prints content: a file, matches, a listing, a diff, a log. */
function printsContent(words: string[]): boolean {
  const name = basename(words[0] ?? '')
  const args = words.slice(1)
  // A count is an answer, not content.
  if (name === 'wc') return false
  if (name === 'git' || name === 'gh') {
    const subcommand = args.filter(arg => !arg.startsWith('-'))
    if (name === 'gh') return subcommand[0] === 'api' || ['view', 'list', 'diff', 'status', 'checks'].includes(subcommand[1] ?? '')
    if (args.some(arg => /^--(?:stat|shortstat|numstat)\b/.test(arg))) return false
    if (subcommand[0] === 'status') return args.some(arg => /^(?:-s|-sb|--short|--porcelain)/.test(arg))
    return GIT_CONTENT.has(subcommand[0] ?? '')
  }
  const kind = kindOf(words)
  return kind === 'read' || kind === 'search' || kind === 'list'
}

/**
 * Whether a command's output ends in content rather than a verdict: its last
 * pipeline prints a file, matches, a listing, a diff or a log, so its last
 * line is just where that happened to stop. `| head -20` only trims it.
 */
export function endsInContent(command: string): boolean {
  let isContent = false
  let isPiped = false
  for (const { words, separator } of commands(command)) {
    const run = operation(words)
    const isTrimmer = isPiped && TRIMMERS.has(basename(run[0] ?? ''))
    if (run.length > 0 && !CLOSERS.has(run[0]!) && !isTrimmer) isContent = printsContent(run)
    isPiped = separator === '|'
  }
  return isContent
}
