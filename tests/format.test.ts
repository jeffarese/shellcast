import { expect, test } from 'claude-code/testing'

import { bar, detectProgress, duration, exitCodeOf, exitMeaning, gistOf, lastLine, parseNotifications, shimmer, shortPaths, sparkline, tailLines, tidy, toneParts } from '../hooks/format'

test('tail lines strip escapes and keep only the last frame of a progress line', () => {
  const raw = '\x1b[32mok\x1b[0m first\r\ndownloading 10%\rdownloading 55%\rdownloading 90%\n\n'
  expect(tailLines(raw, 5)).toEqual(['ok first', 'downloading 90%'])
  expect(tailLines('a\nb\nc\nd', 2)).toEqual(['c', 'd'])
  // Blank lines past the first look widen it; a single line has no newline at all.
  expect(tailLines('a\nb\nc' + '\n'.repeat(20), 2)).toEqual(['b', 'c'])
  expect(tailLines('abc', 3)).toEqual(['abc'])
  // Fewer lines than asked, with a newline right at the scan floor: once looped forever.
  expect(tailLines('\nonly', 40)).toEqual(['', 'only'])
  expect(tailLines('x'.repeat(10) + '\n' + 'yy\n'.repeat(5461), 9000)).toHaveLength(5462)
})

test('progress reads a percentage or a count from the newest lines only', () => {
  expect(detectProgress(['building', 'compiled 42%'])?.label).toBe('42%')
  expect(detectProgress(['Step 3/7 : RUN make'])?.label).toBe('3/7')
  expect(detectProgress(['[12/40] Linking'])?.label).toBe('12/40')
  expect(detectProgress(['50% done', 'still going', 'nearly'])).toBeUndefined()
  expect(detectProgress(['see src/a/b.ts'])).toBeUndefined()
})

test('bars and sparklines fill the width they are given', () => {
  const half = bar(0.5, 20)
  expect(half.filled.length + half.empty.length).toBe(20)
  const glow = shimmer(7, 30)
  expect(glow.before.length + glow.lit.length + glow.after.length).toBe(30)
  expect(sparkline([0, 1, 4, 8], 8)).toBe('▁▁▄█')
})

test('durations, exit codes and notifications parse', () => {
  expect(duration(4_200)).toBe('4.2s')
  expect(duration(185_000)).toBe('3m 05s')
  expect(exitCodeOf('Exit code 2\nboom')).toBe(2)
  expect(exitCodeOf('Permission denied')).toBeUndefined()
  expect(exitCodeOf('<tool_use_error>oops\nError: Exit code 2</tool_use_error>')).toBe(2)
  const notes = parseNotifications(
    '<task-notification>\n<task-id>b1x2y3z4w</task-id>\n<status>completed</status>\n' +
      '<summary>Background command "npm run dev" completed (exit code 0)</summary>\n</task-notification>',
  )
  expect(notes).toEqual([{ taskId: 'b1x2y3z4w', status: 'completed', exitCode: 0 }])
})

test('a gist is the newest result line, else the last line that is not boilerplate', () => {
  // vitest, jest, pytest, eslint: the line that counts outcomes, wherever it sits near the end.
  expect(gistOf([' Test Files  2 passed (2)', '      Tests  73 passed (73)', '   Start at  10:02:11', '   Duration  1.21s']))
    .toBe('Tests 73 passed (73)')
  expect(gistOf(['Tests:       2 failed, 71 passed, 73 total', 'Snapshots:   0 total', 'Time:        2.31 s', 'Ran all test suites.']))
    .toBe('Tests: 2 failed, 71 passed, 73 total')
  expect(gistOf(['collected 12 items', '', '============ 12 passed in 0.42s ============'])).toBe('12 passed in 0.42s')
  expect(gistOf(['✖ 2 problems (2 errors, 0 warnings)', '', ' ELIFECYCLE  Command failed with exit code 1.'])).toBe('✖ 2 problems (2 errors, 0 warnings)')
  // No result line: the last line, skipping a runner's trailer and bare rules.
  expect(gistOf(['transforming...', '✓ built in 4.61s'])).toBe('✓ built in 4.61s')
  expect(gistOf(['boom', 'npm ERR! code 1', 'npm ERR! A complete log of this run can be found in: /x'])).toBe('boom')
  expect(gistOf(['done', '=========='])).toBe('done')
  // Nothing but boilerplate still beats nothing; a far-off result line does not outrank the end.
  expect(gistOf(['npm ERR! code 1'])).toBe('npm ERR! code 1')
  expect(gistOf(['3 passed', 'a', 'b', 'c', 'd', 'e', 'Deployed to https://example.test'])).toBe('Deployed to https://example.test')
  expect(gistOf([])).toBeUndefined()
  expect(gistOf(['', '  '])).toBeUndefined()
})

test('live rows follow the newest visible line, tidied', () => {
  expect(lastLine(['a', '  [3/9]   bundling', '', ''])).toBe('[3/9] bundling')
  expect(lastLine([])).toBeUndefined()
  expect(tidy('--- a/file.ts')).toBe('a/file.ts')
  expect(tidy('git push --force')).toBe('git push --force')
})

test('result counts above zero are toned; zero counts and other words are not', () => {
  expect(toneParts('Tests: 2 failed, 71 passed, 73 total')).toEqual([
    { text: 'Tests: ' }, { text: '2 failed', tone: 'error' }, { text: ', ' }, { text: '71 passed', tone: 'success' }, { text: ', 73 total' },
  ])
  expect(toneParts('✖ 3 problems (1 error, 2 warnings)')).toEqual([
    { text: '✖ ' }, { text: '3 problems', tone: 'error' }, { text: ' (' }, { text: '1 error', tone: 'error' }, { text: ', ' },
    { text: '2 warnings', tone: 'warning' }, { text: ')' },
  ])
  expect(toneParts('12 passed, 0 failed')).toEqual([{ text: '12 passed', tone: 'success' }, { text: ', 0 failed' }])
  expect(toneParts('✓ built in 4.61s')).toEqual([{ text: '✓ built in 4.61s' }])
  expect(toneParts('')).toEqual([{ text: '' }])
})

test('signal exit codes are named; ordinary ones and those the shell explains are not', () => {
  expect(exitMeaning(137)).toBe('killed')
  expect(exitMeaning(130)).toBe('interrupted')
  expect(exitMeaning(1)).toBeUndefined()
  expect(exitMeaning(127)).toBeUndefined()
})

test('content has no gist: a read, a numbered line, JSON or brackets end where they happened to stop', () => {
  // The command says its output is content, whatever the last line looks like.
  expect(gistOf(['export function header() {', '  return out'], 'content')).toBeUndefined()
  // The line itself gives it away.
  expect(gistOf(['src/a.ts:12:export function pluralize() {', '293: stepCount ? pluralize(stepCount, "step") : "",'])).toBeUndefined()
  expect(gistOf(['456-  }', '457-}'])).toBeUndefined()
  expect(gistOf(['  "ok": true', '}'])).toBeUndefined()
  expect(gistOf(['render();', '});'])).toBeUndefined()
  expect(gistOf(['{"id": "replied", "kind": "notify"}'])).toBeUndefined()
  expect(gistOf(["{'window_id': 12415, 'title': ''}"])).toBeUndefined()
  // A result line is a verdict wherever it is found, even after a read.
  expect(gistOf(['Tests 3 failed | 131 passed (134)', '  return out'], 'content')).toBe('Tests 3 failed | 131 passed (134)')
  // Times, dates, counts and plain sentences are not numbered source lines.
  expect(gistOf(['10:02:11 server ready'])).toBe('10:02:11 server ready')
  expect(gistOf(['2026-11-17 backup complete'])).toBe('2026-11-17 backup complete')
  expect(gistOf(['42'])).toBe('42')
  expect(gistOf(['env keys: []'])).toBe('env keys: []')
  expect(gistOf(['removed worktree 19'])).toBe('removed worktree 19')
})

test('paths are written the short way: relative, under ~, and the session scratch folder as …', () => {
  const places = { cwd: '/Users/dev/workspace/app', home: '/Users/dev' }
  expect(shortPaths('sed -n 1,40p /Users/dev/workspace/app/src/a.ts', places)).toBe('sed -n 1,40p src/a.ts')
  expect(shortPaths('cat "/Users/dev/.config/app/keys.json"', places)).toBe('cat "~/.config/app/keys.json"')
  expect(shortPaths('sh /private/tmp/claude-502/-Users-dev-workspace-app/08b4b7e3-4618-438b-a2f5-3e9a02b4dbd8/scratchpad/run.sh', places))
    .toBe('sh …/scratchpad/run.sh')
  expect(shortPaths('OUT=/tmp/claude-501/-work/08b4b7e3-4618-438b-a2f5-3e9a02b4dbd8/out; ls $OUT', undefined)).toBe('OUT=…/out; ls $OUT')
  // Only where a path starts, and never a different folder that shares the prefix.
  expect(shortPaths('ls /Users/dev/workspace/app-old/src /backup/Users/dev/workspace/app/src', places)).toBe('ls ~/workspace/app-old/src /backup/Users/dev/workspace/app/src')
  expect(shortPaths('ls /Users/dev/workspace/app', places)).toBe('ls ~/workspace/app')
  expect(shortPaths('npm test', { cwd: '/', home: '' })).toBe('npm test')
})

test('a failure is never content: a compiler or linter error keeps its line', () => {
  // Numbered the way a search's matches are, and the reason the command failed.
  expect(gistOf(['# example.com/app', './main.go:12:5: undefined: x'], 'error')).toBe('./main.go:12:5: undefined: x')
  expect(gistOf(['a.py:12: error: Incompatible types in assignment'], 'error')).toBe('a.py:12: error: Incompatible types in assignment')
  expect(gistOf(["src/cart.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'."], 'error'))
    .toBe("src/cart.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'.")
  expect(gistOf(['{"error": "not found", "status": 404}'], 'error')).toBe('{"error": "not found", "status": 404}')
  // Brackets alone still say nothing: the line before them does.
  expect(gistOf(['SyntaxError: Unexpected token', '    at parse (a.js:3:1)', '}'], 'error')).toBe('at parse (a.js:3:1)')
  // The same lines after a command that succeeded are where a search stopped.
  expect(gistOf(['./main.go:12:5: undefined: x'])).toBeUndefined()
  // A result line and a runner's boilerplate behave as before.
  expect(gistOf(['./main.go:12:5: undefined: x', 'Found 1 error.'], 'error')).toBe('Found 1 error.')
  expect(gistOf(['./main.go:12:5: undefined: x', 'make: *** [build] Error 2'], 'error')).toBe('./main.go:12:5: undefined: x')
})

test('warning words are toned on any result line; failure words on a failed one', () => {
  const tones = (text: string, isFailure = false) => toneParts(text, isFailure).filter(part => part.tone !== undefined).map(part => `${part.tone}:${part.text}`)
  // A command that ended well but complained.
  expect(tones('warning: `app` (bin) generated 3 warnings')).toEqual(['warning:warning', 'warning:3 warnings'])
  expect(tones('npm warn deprecated inflight@1.0.6: This module is not supported')).toEqual(['warning:warn', 'warning:deprecated'])
  expect(tones('WARNING: You are using pip version 21.0')).toEqual(['warning:WARNING'])
  // Why a command failed.
  expect(tones('fatal: not a git repository (or any of the parent directories): .git', true)).toEqual(['error:fatal'])
  expect(tones('zsh: command not found: pnpmm', true)).toEqual(['error:not found'])
  expect(tones("TypeError: Cannot read properties of undefined (reading 'id')", true)).toEqual(['error:TypeError'])
  expect(tones('git@github.com: Permission denied (publickey).', true)).toEqual(['error:denied'])
  expect(tones('Build failed with 2 errors', true)).toEqual(['error:failed', 'error:2 errors'])
  expect(tones('FAIL src/cart.test.ts > totals', true)).toEqual(['error:FAIL'])
  // On a command that ended well, a failure word only where it labels the line.
  expect(tones('Added error handling to the parser')).toEqual([])
  expect(tones('retried the failed upload')).toEqual([])
  expect(tones('error: could not write the cache, continuing')).toEqual(['error:error'])
  expect(tones('ERROR 2 rows skipped')).toEqual(['error:ERROR'])
  // Denials, and words inside paths, file names, flags and key=value pairs, say nothing.
  for (const text of ['No errors found', '0 errors, 0 warnings', 'finished without warnings', 'Updated src/error-handling.ts', 'wrote logs/error.log',
    'node --no-warnings build.mjs', 'pend=1 failed=[] unresolved=0', 'copied warning.svg']) expect(tones(text, true)).toEqual([])
})
