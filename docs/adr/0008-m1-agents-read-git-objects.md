# In M1, agents read code only through Legible's tools over git objects

The engineering plan gives read-only Claude agents the built-in Read, Grep and Glob tools, working in per-Review Base and Head worktrees. M1 instead gives agents only Legible's own tools (`read_file`, `list_files`, `search`, `git_log`, `git_blame`, `get_change_set_summary`), which read blobs and trees straight from git by commit: `cat-file`, `ls-tree`, `grep` and `blame` against the Base or Head commit. The agent's working directory is an empty scratch folder. Every Iteration's Head is already a commit (a Snapshot commit for working trees), so no checkout is needed, the user's `git worktree list` stays clean, and Base and Head can't drift from what the viewer shows.

This also makes the two runtimes identical: the OpenAI runtime (M3) only ever gets Legible-defined function tools, so Claude now gets exactly the same ones. Built-in tools are disabled (`tools: []`), only Legible's tools are pre-approved, and `permissionMode: 'dontAsk'` denies everything else, with `settingSources: []` and `strictMcpConfig` per ADR 0004.

## Consequences

- No worktrees until M4, when Change Requests need a writable Revision worktree.
- Agents can't run Claude Code's built-in Grep or Glob, which are tuned for that model. If evals show they find code noticeably better, Head and Base worktrees can be added back for Claude alone without changing the permission model.
