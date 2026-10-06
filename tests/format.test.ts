import { expect, test } from 'claude-code/testing'

import { bar, detectProgress, duration, exitCodeOf, parseNotifications, shimmer, sparkline, tailLines } from '../hooks/format'

test('tail lines strip escapes and keep only the last frame of a progress line', () => {
  const raw = '\x1b[32mok\x1b[0m first\r\ndownloading 10%\rdownloading 55%\rdownloading 90%\n\n'
  expect(tailLines(raw, 5)).toEqual(['ok first', 'downloading 90%'])
  expect(tailLines('a\nb\nc\nd', 2)).toEqual(['c', 'd'])
  // Blank lines past the first look widen it; a single line has no newline at all.
  expect(tailLines('a\nb\nc' + '\n'.repeat(20), 2)).toEqual(['b', 'c'])
  expect(tailLines('abc', 3)).toEqual(['abc'])
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
