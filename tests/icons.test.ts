import { expect, test } from 'claude-code/testing'

import { commandIcon, commandLabel, iconMode } from '../hooks/icons'

test('compact labels omit directory setup while preserving command syntax', () => {
  const cases: [string, string][] = [
    ['cd /long/worktree/dashboard && git status --short', 'git status --short'],
    ["cd '/a path/with; punctuation' && python3 - <<'EOF'\nprint(1)\nEOF", "python3 - <<'EOF'"],
    ['cd a\\;b && cd src && NODE_ENV=test npm test', 'NODE_ENV=test npm test'],
    ['cd project; rg "a && b" src | head -20', 'rg "a && b" src | head -20'],
    ['cd project\nnpm test', 'npm test'],
    ['cd project && \\\n npm test', 'npm test'],
    ['cd "$HOME/project" && ls', 'ls'],
    ['cd project', 'cd project'],
    ['cd project &&', 'cd project &&'],
    ['cd project || echo failed', 'cd project || echo failed'],
    ['echo "cd project && npm test"', 'echo "cd project && npm test"'],
    ['cd $(pwd) && npm test', 'cd $(pwd) && npm test'],
    ['git status && cd project && npm test', 'git status && cd project && npm test'],
  ]
  for (const [source, label] of cases) expect(commandLabel(source)).toBe(label)
})

test('the outline set matches the preview for common operations', () => {
  const cases: [string, string][] = [
    ['cat README.md', '\uea7b'], ['ls -la', '\ueb84'], ['cd ~/workspace', '\ueaf7'],
    ['find . -type f', '\uea6d'], ['rg "render" src/', '\uea6d'],
    ["sed -i 's/old/new/' file.ts", '\uea73'], ['rm temporary.log', '\uea81'],
    ['cp config.json backup', '\uebcc'], ['mv old.ts new.ts', '\uebcb'],
    ['mkdir assets', '\uea80'], ['git status', '\uea68'], ['npm test', '\uea79'],
    ['npm run build', '\ueaf8'], ['curl https://example.com', '\ueac2'], ['python script.py', '\uea85'],
  ]
  for (const [command, glyph] of cases) expect(commandIcon(command, 'nerd')).toBe(glyph)
})

test('labels handle wrappers, paths and directory setup without executing anything', () => {
  for (const command of [
    'cd project && npm test', 'cd project; pnpm run test:unit', 'cd project\nyarn test',
    'cd project && cd packages/app && bun test', 'NODE_ENV=test npm test',
    'env -u DEBUG CI=1 npm test', 'sudo -u root -- /usr/bin/npm test',
    'command -- npm test', 'exec npm test', 'time npm test',
    'npm --prefix app run test:unit', 'pnpm --filter web test', 'npx vitest run',
    'cargo test', 'go test ./...', 'make test', 'python3 -m pytest',
    '# first comment\ncd project && \\\n npm test',
  ]) expect(commandIcon(command)).toBe('⚗')
  expect(commandIcon('"/usr/bin/cat" "a file.txt"')).toBe('▤')
  expect(commandIcon('env PATH=/bin /bin/ls')).toBe('≡')
  expect(commandIcon('cd project || rm temporary.log')).toBe('↳')
})

test('quoted separators, comments and argument text do not become commands', () => {
  expect(commandIcon('cat "a && rm file" | grep test')).toBe('▤')
  expect(commandIcon("cd 'a; b' && ls")).toBe('≡')
  expect(commandIcon('cd a\\;b && ls')).toBe('≡')
  expect(commandIcon('cd a # npm test\nls')).toBe('≡')
  expect(commandIcon('echo "npm test; rm file"')).toBe('$')
  expect(commandIcon('python script.py npm test')).toBe('$')
  expect(commandIcon('command -v rm')).toBe('$')
  expect(commandIcon('custom-script --test')).toBe('$')
  expect(commandIcon('constructor')).toBe('$')
})

test('sed reads get a document and in-place edits a pencil', () => {
  for (const command of [
    "sed -n '1,80p' file", "sed 's/old/new/' file", "sed -e '-i' file",
    "sed --expression='-i' file", "sed -f-input.sed file", "sed -- '-i' file",
  ]) expect(commandIcon(command)).toBe('▤')
  for (const command of [
    "sed -i 's/old/new/' file", "sed -i.bak 's/old/new/' file", "sed -ni '1p' file",
    "sed -i '' 's/old/new/' file", "gsed --in-place=.bak 's/old/new/' file",
  ]) expect(commandIcon(command)).toBe('✎')
})

test('icons can be disabled and unset or invalid modes use Unicode', () => {
  expect(commandIcon('cat file', 'none')).toBe('')
  expect(commandIcon('')).toBe('')
  expect(commandIcon('   ', 'nerd')).toBe('')
  expect(iconMode(undefined)).toBe('unicode')
  expect(iconMode('unexpected')).toBe('unicode')
  expect(iconMode(' NERD ')).toBe('nerd')
  expect(iconMode(' NERD-BOLD ')).toBe('nerd-bold')
  expect(iconMode('none')).toBe('none')
})
