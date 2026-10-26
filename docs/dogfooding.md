# Dogfooding M1

M1 is the first build meant for daily use. It reads agent-written changes in a viewer built for understanding them, and explains any range or file with Claude. Terms in **bold** are defined in [CONTEXT.md](../CONTEXT.md).

## What's in M1

- **Sources.** A local working tree, including uncommitted and untracked files, captured as a **Snapshot** against the merge-base with your base branch. Two refs compared with three-dot semantics. A GitHub pull request or GitLab merge request, read-only, fetched into a blobless cache clone.
- **Iterations.** When the working tree, branch or Pull Request moves, a banner offers a refresh. Legible never refreshes on its own. Earlier **Iterations** stay viewable from the titlebar.
- **Diff viewer.** Unified and split layouts, syntax highlighting on both sides, word-level changes, rename and move detection, and an overview ruler. Lockfiles, generated, vendored and binary files are collapsed. **Structural** Fragments that are provably whitespace- or formatting-only are collapsed with a badge. The viewer is virtualized and keyboard-first, with viewed marks per file and a progress bar.
- **Explanations.** Before · After · What changed · Watch out, for a selection, a hunk, or a whole file, on the fast tier (Claude Haiku 5.5 by default). They're cached by content, so the same code with the same Intent and model is never paid for twice.
- **Settings.** Claude through your own Claude Code, an Anthropic API key, Bedrock, Vertex, or Foundry. A model per tier, a spend cap per Explanation, host accounts, editor, theme.

Not yet: the Walkthrough, Change Brief and Intent (M3), Connections (M2), Notes, Asks and Revisions (M4), and Agent Review (M5). The Pull Request description is shown as the Intent line above the diff, and Explanations use it as Intent.

## Run it

You need git 2.40 or newer and Node 22.13 or newer with pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm dev                     # opens the app with hot reload
pnpm dev ~/code/my-repo      # …and opens that repository's working tree (use an absolute path)
```

To build an app you can keep in `/Applications`:

```sh
pnpm dist:mac                # release/Legible-0.0.0-arm64.dmg (Apple Silicon)
```

Without signing credentials the build is unsigned. The first time, open it with right-click → Open.

### Releases

Signed, notarized builds come from the Release workflow. In the repository's Actions tab, choose **Release → Run workflow** on `main`. It picks the next version (`YYYY.MDD.N`, [ADR 0012](./adr/0012-calendar-versions.md)), tags the commit, and uploads the DMG to a draft GitHub Release. Publish the draft to make it downloadable and to offer it to installed copies. They check at launch, download in the background, and install when you quit. It needs the `MAC_CERTS`, `MAC_CERTS_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` secrets. Builds are Apple Silicon only for now.

### From the terminal

Put [`bin/legible`](../bin/legible) on your PATH:

```sh
ln -s "$PWD/bin/legible" /usr/local/bin/legible
legible                                  # the repository you're in
legible ~/code/other-repo
legible https://github.com/acme/app/pull/482
```

If Legible is already running, the Review opens in the existing window. You can also drop a folder on the Dock icon.

## Connect Claude

Settings → Providers. The default is **Use my Claude Code**: Legible runs your installed, signed-in `claude` and never touches its credentials. It uses your claude.ai sign-in even if your shell exports `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN`: Legible removes them before running `claude`, which would otherwise bill the key. To bill a key, choose **Anthropic API key** instead. Legible reads your login shell's environment at startup, so variables your shell profile exports (`CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, proxies) apply even when you open it from the Dock. If it says Claude Code isn't signed in, the message names the `claude` it ran and the folder it looked in. Run `claude` once in a terminal and press Recheck, or set the path your terminal uses (`which claude`). If Legible can't find `claude` (GUI apps on macOS don't see your shell's PATH), paste its path. `which claude` prints it.

Usage-based alternatives are under the same card. API keys go to the macOS Keychain and reach Claude only as environment variables.

Agents in Legible can only read code at Base and Head through Legible's own tools. They get no shell, can't edit files or use the network, and never load the reviewed repository's `.claude` settings, hooks or MCP servers ([ADR 0004](./adr/0004-agents-ignore-repo-claude-settings.md), [ADR 0008](./adr/0008-m1-agents-read-git-objects.md)).

## Connect hosts

Public repositories open without an account. For private ones, add the host in Settings → Hosts & accounts. **Reuse gh CLI login** asks `gh auth token` each time and never copies the credentials. A pasted personal access token is stored in the Keychain and needs read access only. GitHub Enterprise and self-managed GitLab work the same way: enter the hostname.

## A typical loop

1. The agent finishes on `feature/x`. Run `legible` in the repository.
2. Skim the file tree. Collapsed lockfiles and "structural" files can wait.
3. `n` / `p` move between files and `j` / `k` between hunks. Press `e` on anything you don't fully understand; drag across line numbers first to explain a specific range. `⇧E` explains the whole file.
4. Press `v` to mark a file viewed. It collapses, and the progress bar moves.
5. Ask the agent for changes in your terminal. When the working tree moves, Legible offers **Refresh**, and viewed marks carry over for files whose contents didn't change.

## Keyboard

| Keys | Action |
|---|---|
| `j` / `k` | Next / previous hunk |
| `n` / `p` | Next / previous file |
| `e` | Explain the selection, or the hunk at the top of the view |
| `⇧E` | Explain the current file |
| `v` | Mark the current file viewed |
| `⌥S` | Split / unified |
| `w` | Hide whitespace-only changes |
| `o` | Open the current line in your editor |
| `⇧R` | Refresh the Snapshot or fetch new commits |
| `⌘[` / `⌘]` | Trail back / forward (jumps from the palette, tree and Explanations) |
| `⌘K` | Command palette: files and actions |
| `⌘,` | Settings |
| `?` | All shortcuts |

Click a line number to select a line. Shift-click or drag to extend the selection. `esc` clears it.

## Where things live

Everything is local, in `~/Library/Application Support/Legible/` on macOS:

- `legible.db`: Reviews, Iterations, viewed state, cached Explanations, and a record of every agent run with its cost.
- `secrets.json`: API keys and tokens, encrypted with the Keychain.
- `repos/`: blobless cache clones for Pull Requests.

In your own repositories, Snapshots are commits under `refs/legible/snapshots/`. They never touch your index, stash or branches. Delete them with `git for-each-ref --format='%(refname)' refs/legible | xargs -n1 git update-ref -d`.

## Develop

```sh
pnpm typecheck && pnpm lint && pnpm test      # unit tests, including the provider schema lint
pnpm format                                  # oxfmt: Prettier's defaults, no semicolons
pnpm --filter @legible/desktop test:e2e      # Electron end-to-end, fake agent (xvfb-run on Linux)
npx vitest run --config vitest.live.config.ts  # live checks: a real Claude Explanation and a public GitLab MR
node fixtures/make-refund-repo.mjs /tmp/refunds  # the M0 design fixture as a real repository
```

`LEGIBLE_FAKE_AGENT=1` answers every Explanation with canned text, and `LEGIBLE_USER_DATA=<dir>` uses a throwaway data folder.

Layout follows the [engineering plan](./engineering-plan.md#3-repository-layout): `apps/desktop` holds Electron main, preload and the renderer entry. The `packages/` are `domain`, `ipc`, `ui`, `store`, `git`, `diff`, `hosts`, `agent-runtime` and `pipelines`. The UI is React with Tailwind CSS v4, themed with the M0 tokens ([ADR 0010](./adr/0010-tailwind-css.md)). The renderer is sandboxed and talks to main only through the typed, zod-validated contract in `packages/ipc`. Agents run in a separate utility process.

## Known rough edges

- The first Explanation after launch takes a second or two longer while Claude Code starts.
- Watching a working tree polls every six seconds on Linux. On macOS it uses file events.
- On a very large Change Set the first open takes a few seconds, while every file is diffed and highlighted. After that, scrolling and switching layouts are immediate.

File issues as you hit them. They're the M2–M3 backlog.
