import { expect, test } from 'claude-code/testing'

import { bar, detectProgress, duration, exitCodeOf, exitMeaning, gistOf, lastLine, parseNotifications, shimmer, sparkline, tailLines, tidy, toneParts } from '../hooks/format'

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
