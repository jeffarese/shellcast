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
  shell: ['$', '\uea85', '\uf120'],         // terminal
} as const

type Kind = keyof typeof ICONS

const COMMANDS: Record<string, Kind> = {
  cat: 'read', head: 'read', tail: 'read', less: 'read', more: 'read', bat: 'read', batcat: 'read',
  ls: 'list', tree: 'list', eza: 'list', exa: 'list',
  cd: 'directory', pushd: 'directory', popd: 'directory',
  find: 'search', fd: 'search', fdfind: 'search', grep: 'search', egrep: 'search', fgrep: 'search', rg: 'search',
  vi: 'edit', vim: 'edit', nvim: 'edit', nano: 'edit', apply_patch: 'edit', patch: 'edit',
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
  const flush = () => {
    if (started) words.push(word)
    word = ''
    started = false
  }
  // Labels need only the start, even for a very large heredoc or script.
  const text = source.slice(0, 4096)
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
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      flush()
      const separator = (ch === '&' || ch === '|') && text[i + 1] === ch ? ch + text[++i] : ch
      if (words.length > 0) yield { words, separator, start, end: i + 1 }
      words = []
      start = i + 1
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
    if (!['env', 'sudo', 'command', 'builtin', 'exec', 'time', 'nohup'].includes(name)) break
    i++
    while (words[i]?.startsWith('-')) {
      const option = words[i++]!
      if (option === '--') break
      // These ask about a command without executing it.
      if (name === 'command' && /^-[vV]+$/.test(option)) return ['command']
      const takesValue = name === 'env' ? ['-u', '--unset', '-C', '--chdir']
        : name === 'sudo' ? ['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '--close-from', '-D', '--chdir']
        : name === 'exec' ? ['-a'] : []
      if (takesValue.includes(option)) i++
    }
  }
  return words.slice(i)
}

function kindOf(words: string[]): Kind {
  const name = basename(words[0] ?? '')
  const args = words.slice(1)
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
  }
  if (/^python(?:\d+(?:\.\d+)?)?$/.test(name) && args[0] === '-m' && ['pytest', 'unittest'].includes(args[1] ?? '')) return 'test'
  return Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name]! : 'shell'
}

/** Use the first operation after leading directory changes, never argument text. */
export function commandIcon(command: string, mode: IconMode = 'unicode'): string {
  if (mode === 'none' || command.trim() === '') return ''
  let kind: Kind = 'shell'
  for (const { words, separator } of commands(command)) {
    kind = kindOf(executable(words))
    if (kind !== 'directory' || !['&&', ';', '\n'].includes(separator)) break
  }
  return ICONS[kind][mode === 'nerd-bold' ? 2 : mode === 'nerd' ? 1 : 0]
}
