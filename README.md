# shellcast

Live inline cards for every shell command Claude runs, right in the Claude Code transcript. No side panel.

I got tired of my agent's shells being reduced to this:

<p align="center">
  <img src="assets/before.png" alt="Claude Code's footer: auto mode on · 1 shell, 2 monitors · 1 agent" width="560">
</p>

What is that shell doing? Is it stuck? How far along is it? shellcast puts every shell command Claude runs right in the transcript as a live card, and keeps long background jobs in sight while the agent goes on writing. Quick commands stay as one-line rows with their own icons. Completed tool blocks collapse into a summary of the work and an icon strip, keeping the whole sequence easy to scan:

<p align="center">
  <strong>Stock Claude Code (left) · shellcast (right)</strong><br>
  <a href="assets/side-by-side.mp4"><img src="assets/side-by-side.gif" alt="Synchronized before and after: stock Claude Code on the left; shellcast on the right with descriptive tool summaries, command icons, compact writes, and a live build card" width="100%"></a>
</p>

<p align="center"><sub>The same prompt, tool calls, file contents, and eight-second build, with synchronized scripted replies. A search, a file read, and nine shell commands collapse into descriptive blocks with their icons intact; three Write summaries stay compact. Icons use <code>SHELLCAST_ICONS=nerd-bold</code>.</sub></p>

<p align="center"><sub>Open the <a href="assets/side-by-side.mp4">full-size comparison</a>, individual <a href="assets/before.mp4">before</a> / <a href="assets/after.mp4">after</a> videos, or the <a href="assets/compact-writes.mp4">short icons + writes demo</a>.</sub></p>

While a command is running you can see its output, progress and throughput. Once it finishes, the card folds into a single line:

```
✔ ⚗ Run the test suite  ⎿ Tests  73 passed (73)              5.3s · 13 lines  ▸ details
✔ ⚙ Production build  ⎿ ✓ built in 4.61s                      5.3s · 6 lines  ▸ details
✘ $ Lint the codebase  ⎿ ✖ 2 problems (2 errors, 0 warnings)  exit 1 · 1.8s  ▸ details
```

## Install

In a Claude Code terminal session:

```
/plugin install shellcast --marketplace jeffarese/shellcast
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). It starts working right away. No restart needed.

## What it shows

| State | Card |
| --- | --- |
| **Starting** | A quiet one-line row with a spinner. Commands that finish within about 1.5 s never open a card, so quick `ls` and `git status` calls don't flash. |
| **Running** | Framed card: spinner, elapsed time, syntax-highlighted command, the last 3 output lines as they stream (always 3 rows, so it doesn't grow as output arrives), and a meter below them. The meter is a real progress bar when the output prints `45%` or `[3/10]`, and a shimmer otherwise. Under it: bytes, lines, a throughput sparkline, and a timeout warning past half the limit. |
| **Done** | A one-liner: `✔`, the description, the last line of output (the command, on the main screen), duration and line count. Chips appear for git commits, pushes and PRs, edited files, saved output, unsandboxed runs and timeouts. |
| **Completed block** | Consecutive successful tools collapse into a description such as `✔ Searched for 1 pattern, read 1 file, ran 7 shell commands`, followed by their icons and elapsed time when observed. Repeated icons get a count. Long summaries wrap to keep the description and icons visible. In fullscreen, `▸ details` restores the individual rows; each shell still has its own output toggle. Active blocks, failures, interruptions and pending results stay visible. |
| **Failed** | The same one-liner in red, with `✘` and the exit code. A call you declined shows as `⊘ not run`, not as a failure. |
| **Background** | The live card is pinned above the prompt for as long as the shell runs, so it never scrolls away while the agent keeps writing: command, last 3 lines, a progress bar when the output reports one, and stats. It has a fixed height, so nothing jumps; the prompt only moves when a background shell starts or ends. In the transcript the call stays a single `◉ … pinned ↓` row until the completion notice turns it into `✔ exit 0`, `✘ exit 1` or `■ stopped`. With more shells than room, the extra ones get one live row each. The footer's `1 shell` also says what it is doing (`→ Run e2e suite 12/24 26s`), which stays visible if you collapse the pinned card with `[-]`. |
| **Details** | In the fullscreen layout, `▸ details` on any card opens the full command, stdout and stderr, timing, task id and output file. |

On the terminal's main screen (not fullscreen), individual rows keep Claude Code's own `⎿` result block, and collapsed groups show a ctrl+o hint. Claude Code's expanded transcript and verbose mode retain every individual row. The desktop app, VS Code and mobile keep their native rows.

Successful `Write` calls in the terminal keep just the `Write(path)` header and `Wrote N lines to path` summary, without the source preview. Errors and writes awaiting owner review keep their native results.

### Command icons

A muted command icon sits between the status indicator and the title, including running, failed and background rows. Reading, listing, navigating, searching, editing, deleting, copying, moving, creating, Git, tests, builds and downloads each have their own icon.

Set `SHELLCAST_ICONS` before starting Claude Code:

| Value | Icons |
| --- | --- |
| `unicode` (default) | Plain symbols such as `▤` for reading, `≡` for listing and `↳` for navigation. |
| `nerd` | Set A: thin Codicons outlines. |
| `nerd-bold` | Set B: bolder Font Awesome symbols, with a Git logo and folder-plus icon. |
| `none` | Status indicators only. |

Both Nerd Font sets need a [Nerd Font](https://www.nerdfonts.com/) selected in your terminal; the **Nerd Font Mono** variant keeps the icon column one cell wide.

```sh
SHELLCAST_ICONS=nerd-bold claude
```

To keep the preference, add `export SHELLCAST_ICONS=nerd-bold` to your shell configuration, or set `env.SHELLCAST_ICONS` in `~/.claude/settings.json` for all Claude sessions. Use `nerd` to switch back to A. The font choice is explicit, rather than inferred from which fonts are installed.

Labels come from the command, not its description: `sed -n` gets a document and `sed -i` a pencil. Leading directory changes are skipped when another command follows (`cd project && npm test` gets a flask). Detection is best effort for shell scripts; unknown commands get a terminal icon. Icon selection never changes command execution.

## How live output works

Claude Code streams each shell's combined output to `<tmp>/claude-<uid>/<project>/<session>/tasks/b<id>.output`. A call claims the first such file that appears after it starts, and a 300 ms ticker reads it while the call runs: ANSI codes stripped, `\r` progress lines collapsed to their latest frame. shellcast only reads that folder. If it can't find it, cards still draw, just without the live tail.

## Develop

```
claude --plugin-dir /path/to/shellcast   # load from disk, reloads on save
claude plugin validate .                 # what the engine sees
claude plugin test .                     # tests/*.test.ts(x)
```

The demos are real Claude Code sessions in a throwaway sample project, recorded with a scripted stand-in for the model and simulated test/build output so both runs follow the same sequence. The file writes and shellcast rendering run normally.

Layout: `hooks/register.tsx` (the hooks), `hooks/card.tsx` (cards), `hooks/group.tsx` (collapsed tool blocks), `hooks/icons.ts` (command icons), `hooks/live.ts` (output tracking), `hooks/format.ts` (pure helpers), `types/index.d.ts` (the `$.state` contract).
