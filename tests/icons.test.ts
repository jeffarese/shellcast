import { expect, test } from 'claude-code/testing'

import { commandIcon, commandLabel, endsInContent, iconMode } from '../hooks/icons'

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
    ['npm run build', '\ueaf8'], ['curl https://example.com', '\ueac2'], ['python script.py', '\ueac4'],
    ['herdr-app status', '\uea85'],
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
  expect(commandIcon('python script.py npm test')).toBe('λ')
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

test('interpreters running a file, a heredoc or a one-liner are scripts', () => {
  for (const command of [
    'python3 scripts/count.py --days 7', "python3 - <<'EOF'\nprint(1)\nEOF", 'node build/check.mjs', 'bash scripts/release.sh',
    "sh -c 'echo hi'", 'osascript -e "tell application \\"Finder\\" to activate"', 'perl -pe s/a/b/ file', 'npx tsx tools/gen.ts',
    'uv run python tools/score.py', 'bun scripts/seed.ts',
  ]) expect(commandIcon(command)).toBe('λ')
  expect(commandIcon('python3 script.py', 'nerd-bold')).toBe('\uf121')
  // What an interpreter runs can still say more than that it is a script.
  expect(commandIcon('python3 -m pytest tests')).toBe('⚗')
  expect(commandIcon('node --test')).toBe('⚗')
  expect(commandIcon('npx playwright test')).toBe('⚗')
  expect(commandIcon('npx tsc --noEmit')).toBe('⚙')
})

test('setup before the first real operation does not decide the icon', () => {
  const cases: [string, string][] = [
    ['OUT=/tmp/x; grep -rn TODO src', '⌕'],
    ['S="/a b/scratch" && R=/repo; sed -n 1,40p "$R/a.ts"', '▤'],
    ['echo "== tests"; npm test', '⚗'],
    ['set -euo pipefail\nexport CI=1\nnpm run build', '⚙'],
    ['for f in a.ts b.ts; do sed -n 1,5p "$f"; done', '▤'],
    ['if [ -f dist/app.js ]; then rm dist/app.js; fi', '⌫'],
    ['sleep 2; curl -s localhost:3000/health', '⇣'],
    ['timeout 120 npx vitest run ipc', '⚗'],
    ['nice -n 10 make build', '⚙'],
    // Setup alone is still what the line does.
    ['OUT=/tmp/x', '$'], ['echo done', '$'], ['cd project', '↳'], ['export CI=1; echo ready', '$'],
    // Only setup that falls through: a pipe or a branch keeps the first command.
    ['echo "a b" | grep a', '$'],
  ]
  for (const [command, glyph] of cases) expect(commandIcon(command)).toBe(glyph)
})

test('writing a file with cat, echo or tee is an edit; installing is a download', () => {
  expect(commandIcon("cat > notes/plan.md <<'EOF'\n# Plan\nEOF")).toBe('✎')
  expect(commandIcon('cat a.txt b.txt >> all.txt')).toBe('✎')
  expect(commandIcon('echo "v2" > VERSION')).toBe('✎')
  expect(commandIcon('tee build.log')).toBe('✎')
  expect(commandIcon('echo oops >&2')).toBe('$')
  expect(commandIcon('cat notes.md 2>/dev/null')).toBe('▤')
  for (const command of ['npm install', 'pnpm add zod', 'npm ci', 'pip install -r requirements.txt', 'brew install jq', 'uv sync'])
    expect(commandIcon(command)).toBe('⇣')
  expect(commandIcon('make install')).toBe('⚙')
})

test("a heredoc's body is input, never commands", () => {
  // The body would otherwise read as `rm` or `git` lines.
  expect(commandIcon("OUT=/tmp/x\npython3 - <<'EOF'\nrm = 1\ngit = 2\nEOF")).toBe('λ')
  expect(commandIcon("cat <<EOF | grep a\nnpm test\nEOF\nls")).toBe('▤')
  expect(commandIcon("echo start; python3 - << 'PY'\nimport os\nPY\nnpm test")).toBe('λ')
  // A here-string is not a heredoc: the next line still runs.
  expect(endsInContent('grep -c a <<< "$text"\nls -la')).toBe(true)
  expect(endsInContent("python3 - <<'EOF'\nprint(open('a').read())\nEOF\nsed -n 1,9p a.ts")).toBe(true)
  expect(endsInContent("sed -n 1,9p a.ts\npython3 - <<'EOF'\ncat = 1\nEOF")).toBe(false)
})

test('output ends in content when the last pipeline reads, searches, lists, or prints a diff or log', () => {
  for (const command of [
    'sed -n 40,80p src/header.ts', 'cd app && grep -rn "pluralize" src | head -20', 'ls -la dist',
    'npm test; sed -n 1,20p coverage/summary.txt', 'cat ~/.config/app/keys.json | head -80', 'find dist -type f | sort',
    'for f in a.ts b.ts; do sed -n 1,5p "$f"; done', 'git diff HEAD~1 -- src/a.ts', 'git log --oneline -5', 'git status --short',
    'gh pr view 462 --json reviews', 'gh api repos/o/r/pulls', 'jq .scripts package.json', 'python3 gen.py | grep -n TODO',
    'grep -rn TODO src 2>&1 | head -5', 'ls missing 2>/dev/null; ls -la dist 2>&1',
  ]) expect(endsInContent(command)).toBe(true)
  for (const command of [
    'npm test', 'sed -n 1,40p a.ts; npm test', 'python3 scripts/count.py', 'grep -rn TODO src | wc -l', 'wc -l src/a.ts',
    'git diff --stat', 'git status', 'git commit -m fix', 'gh pr merge 12 --squash', 'cat a.ts | python3 summarize.py',
    'grep -q TODO src/a.ts && echo found', "sed -i '' s/a/b/ file.ts", 'make build',
  ]) expect(endsInContent(command)).toBe(false)
})
