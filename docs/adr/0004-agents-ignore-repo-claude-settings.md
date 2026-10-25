# Agents never load the reviewed repository's Claude settings

Agent runs start with no Claude Code setting sources: no `.claude/settings.json`, hooks, plugins, skills, or MCP config from the repository under review, nor from the user's global config. In Reviewer mode the repository is untrusted. A Pull Request could add a `.claude/settings.json` with hooks that run arbitrary commands the moment an agent starts in that worktree, and an agent tool that is "read-only" by policy is worthless if settings can grant more. Repository guidance files (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`) are still valuable context, so Legible reads them as plain text and passes them to the agents that need them, as untrusted data.

## Consequences

- Users' personal Claude Code customizations (their own skills, MCP servers) don't apply inside Legible's agents. A future, explicit opt-in could allow user-level (never project-level) settings in Author mode.
