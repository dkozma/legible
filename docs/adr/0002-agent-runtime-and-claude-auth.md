# AgentRuntime over the Claude Agent SDK, with two auth paths

> **Partially superseded by [ADR 0006](./0006-multiple-model-providers.md):** OpenAI is now a second Provider in v1. The Claude authentication rules below still apply.

All Claude work (Explanations, Questions, Lenses, Verification, Change Requests, Conversations) goes through an internal **AgentRuntime** interface, implemented in v1 by the Claude Agent SDK (TypeScript). The interface is shaped so other agents (Codex CLI, Gemini CLI, local models) could be added later, but only Claude ships in v1.

Users authenticate one of two ways, chosen in Settings:

1. **Use my Claude Code** — the SDK is pointed (`pathToClaudeCodeExecutable`) at the user's own installed, unmodified `claude` binary, which they have signed into themselves with their own subscription. The app never reads, stores, proxies, or prompts for Claude.ai credentials and offers no login UI — only a detected/signed-in status.
2. **API key** — Anthropic Console, Bedrock, Vertex, or Foundry credentials, stored via the OS keychain (Electron `safeStorage`) and passed to the agent process only as environment variables.

This follows Anthropic's policy that Agent SDK–based products use API-key auth and must not offer Claude.ai login or "collect, store, or intermediate" Claude.ai credentials, while relying on the documented allowance that end users may sign into the unmodified Claude Code binary with their own subscription. We deliberately do **not** capture `claude setup-token` / `CLAUDE_CODE_OAUTH_TOKEN` in-app (a user's own shell export passes through untouched).

## Consequences

- **Before public release, confirm with Anthropic** that the SDK driving the user's own binary qualifies. If not, swap the subscription path's AgentRuntime transport to drive `claude -p --output-format stream-json` directly; no feature code changes.
- The product name must not include "Claude Code" ("Powered by Claude" is fine).
- Every agent run carries a spend cap (`maxBudgetUsd`) and reports estimated cost.
- Default model tiers: strongest model for Lenses, Verification, Change Requests, and Scenario traces; mid-tier for Walkthrough planning, Change Brief, Domain Changes, and Conversations; fast model for Explanations and Scope tagging. All user-overridable.
