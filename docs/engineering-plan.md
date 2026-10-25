# Legible — Engineering Plan

_Status: v1 planning. Companion docs: [Product Plan](./product-plan.md), [Glossary](../CONTEXT.md), [ADRs](./adr/)._

Code, types, and table names use the glossary terms in [CONTEXT.md](../CONTEXT.md) verbatim (`ChangeSet`, `Step`, `Ask`, `Revision`, …). If code and glossary disagree, fix one of them.

> Library versions and API details below reflect planning-time knowledge. At the start of each milestone, verify current APIs (Context7 / official docs) for Electron, the Claude Agent SDK, the OpenAI Agents SDK and Sign in with ChatGPT, web-tree-sitter, Octokit, and GitLab before writing code against them.

---

## 1. Architecture overview

```
┌──────────────────────────── Electron app ────────────────────────────────┐
│                                                                          │
│  Renderer (sandboxed, contextIsolation, no Node)                         │
│  React UI · diff renderer · state store                                  │
│        │  typed IPC (preload contextBridge, zod-validated contract)      │
│        ▼                                                                 │
│  Main process                                                            │
│  ├─ IPC router · window mgmt · job scheduler                             │
│  ├─ Store (SQLite)                                                       │
│  ├─ Git service (spawns `git`)                                           │
│  ├─ Host service (GitHub REST+GraphQL, GitLab REST)                      │
│  └─ Credential store (OS keychain via safeStorage)                       │
│        │ MessagePort                         │ MessagePort               │
│        ▼                                     ▼                           │
│  utilityProcess: Indexer              utilityProcess: Agent host         │
│  web-tree-sitter + WASM grammars      router → AgentRuntimes · Judge     │
│  diff engine · Symbols · Connections  pipelines · provider-neutral tools │
│  structural equivalence · highlighting   │ Claude SDK      │ OpenAI SDK  │
│                                          ▼ spawns          │ (HTTPS)     │
│                                    `claude` binary         │             │
│                                    (user's or bundled)     │             │
└──────────────────────────────────────────────────────────────────────────┘
        │                    │                 │                 │
   git remotes        GitHub / GitLab   Anthropic / Bedrock   OpenAI Responses
                           APIs         Vertex / Foundry      (+ Decisions; and
                                                              TypeSafe if on)
```

**Why two utility processes:** parsing and agent orchestration are both bursty and crash-prone. Isolating them keeps the main process (IPC, DB, windows) responsive and lets either restart without losing UI state.

**Decisions recorded:** [ADR 0001 — Electron](./adr/0001-electron-over-tauri.md), [ADR 0002 — AgentRuntime & auth](./adr/0002-agent-runtime-and-claude-auth.md), [ADR 0003 — partial clones & worktrees](./adr/0003-blobless-clones-and-worktrees.md), [ADR 0004 — agents never load repo settings](./adr/0004-agents-ignore-repo-claude-settings.md), [ADR 0005 — Judge interface](./adr/0005-judge-interface-for-typed-judgments.md), [ADR 0006 — multiple model providers](./adr/0006-multiple-model-providers.md).

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Shell | Electron | ADR 0001 |
| Language | TypeScript (strict) everywhere | |
| Build | Vite (via electron-vite or Electron Forge's Vite plugin) | Pick at M1 start |
| UI | React | |
| UI state | Zustand (client state) + TanStack Query over IPC (server-ish state) | |
| Virtualization | TanStack Virtual | Variable-height rows (inline threads) |
| Styling | CSS variables design tokens + CSS modules (or Tailwind if M0 prefers) | Tokens come out of M0 |
| DB | SQLite via better-sqlite3 + a typed query layer (Drizzle or Kysely) | Migrations versioned in repo |
| Parsing | web-tree-sitter + prebuilt WASM grammars | Language Tiers |
| Agents | Claude Agent SDK (default) and OpenAI Agents SDK, both behind `AgentRuntime` | ADR 0002, ADR 0006 |
| Typed judgments | `Judge` interface: TypeSafe JS SDK (Jev), OpenAI SDK (Decisions API), fast-tier structured output | ADR 0005; external backends optional |
| GitHub | Octokit (REST + GraphQL) | |
| GitLab | Thin typed REST client (or @gitbeaker) | |
| Diagrams | Mermaid (sequence diagrams for Scenario traces, mini-graphs) | |
| Tests | Vitest (unit), Playwright `_electron` (E2E), eval harness for AI pipelines | §12 |
| Lint/format | Biome (or ESLint + Prettier) | |
| Packaging | electron-builder: macOS notarized DMG, Windows/Linux beta; auto-update via GitHub Releases | |
| Monorepo | pnpm workspaces | |

## 3. Repository layout

```
legible/
├─ CONTEXT.md                      glossary (source of truth for names)
├─ docs/  product-plan.md  engineering-plan.md  adr/
├─ apps/
│  ├─ desktop/                     Electron main + preload + window bootstrap
│  └─ prototype/                   M0: browser-only app rendering packages/ui on fixtures
├─ packages/
│  ├─ domain/                      shared types & zod schemas (ChangeSet, Step, Ask, Finding…)
│  ├─ ipc/                         typed IPC contract (requests, events) + client/server helpers
│  ├─ ui/                          React components, design tokens, diff renderer, Storybook
│  ├─ store/                       SQLite schema, migrations, repositories
│  ├─ git/                         git CLI wrapper: clone cache, worktrees, Snapshots, diffs, apply
│  ├─ diff/                        line/word diff, fragments, move detection
│  ├─ indexer/                     tree-sitter, grammars, Symbols, Connections, equivalence, highlighting
│  ├─ hosts/                       github/, gitlab/ adapters behind a common Host interface
│  ├─ agent-runtime/               AgentRuntime interface, Claude + OpenAI impls, router, model catalog, tools, fake/replay
│  ├─ judge/                       Judge interface; Jev, OpenAI Decisions, fast-tier backends; judgment catalog
│  └─ pipelines/                   Intent, Walkthrough, Brief, Explanations, Asks, Revisions, Lenses…
│                                  (prompts + output schemas + orchestration, versioned)
├─ grammars/                       WASM grammars + tags/highlights queries, manifest with Language Tiers
├─ fixtures/                       scripts that generate deterministic fixture repos & Change Sets
└─ evals/                          labeled real-world Change Sets + scoring for AI pipelines
```

`packages/ui` must run in a plain browser against fixtures (M0) and inside Electron (M1+) — it depends only on `domain` and an injected data client, never on IPC directly.

## 4. Domain model and storage

One SQLite DB per user (`<appData>/legible/legible.db`). Large derived artifacts (parse caches) live on disk, content-addressed.

Core tables (abridged):

| Table | Key fields |
|---|---|
| `repos` | id, host, remote_url, cache_path, local_path (for local repos) |
| `reviews` | id, repo_id, source_kind (pull_request \| refs \| working_tree), pr_number, base_ref, head_ref, mode (author \| reviewer), created_at |
| `iterations` | id, review_id, seq, head_sha, kind (snapshot \| push \| revision), viewed_at |
| `change_sets` | id, base_sha, head_sha (iteration Change Sets and Revision Change Sets) |
| `files` / `fragments` | change_set_id, path, old_path, status; fragment = stable id, side ranges, kind (behavioral \| structural), structural_proof |
| `intents` | review_id, source (pull_request \| transcript \| user \| inferred), body, requirements_json, confirmed |
| `walkthroughs` / `chapters` / `steps` / `step_fragments` | step: name, narrative, layer, scope, risk, requirement_ids, order, user_edited |
| `sittings` | walkthrough_id, ordinal, step range, completed_at |
| `domain_changes` | review_id, iteration_id, statement, before, after, fragment_ids, in_description (bool) |
| `anchors` | id, change_set_id, side, path, start_line, end_line, fingerprint_json, status (live \| outdated) |
| `notes`, `pending_reviews` | anchor_id, body, published_remote_id |
| `remote_comments` | host thread/comment ids, anchor_id, author, body, resolved, etag |
| `asks`, `batches` | ask: kind (question \| change_request), anchor_id, instructions, context_json, status; batch: submitted_at, revision_id |
| `revisions` | batch_id, worktree_path, change_set_id, status (pending \| accepted \| partially_accepted \| rejected), commit_sha |
| `agent_reviews`, `lens_runs`, `findings` | finding: lens, anchor_id, severity, title, rationale, suggested_fix, verification (confirmed \| plausible \| disproved), dismissed_reason, merged_into |
| `explanations` | cache_key, target_kind, body_json, model, prompt_version |
| `scratchpad_items` | review_id, kind (invariant \| to_check), body, anchor_id, status, check_result_json |
| `conversations`, `messages` | review_id, role, content, cited_anchor_ids |
| `agent_runs` | task_kind, provider, model, tier, started/ended, cost_usd, tokens, status, error — every agent call, for cost meters and debugging |
| `settings`, `accounts` | non-secret config; secrets live only in the keychain |

**Identity rules.** Fragments, Symbols, and Steps get **stable content-derived ids** (hash of path + normalized content + enclosing Symbol) so that viewed state, Anchors, and Walkthrough structure survive Iterations where code didn't change.

## 5. Git layer (`packages/git`)

All git work shells out to the user's `git` (≥ 2.38 required; checked at startup). See [ADR 0003](./adr/0003-blobless-clones-and-worktrees.md).

- **Remote repos:** one cached clone per remote at `<appData>/legible/repos/<host>/<owner>/<name>.git`, created with `git clone --filter=blob:none --no-checkout`. PR heads are fetched via `refs/pull/<n>/head` (GitHub) or `refs/merge-requests/<n>/head` (GitLab).
- **Local repos:** no clone. Worktrees are added to the user's repo; Snapshots are private refs.
- **Base:** `git merge-base <target> <head>` (three-dot semantics). Recomputed per Iteration; a changed merge-base (rebase onto newer main) is shown to the user.
- **Worktrees per Review:** `git worktree add --detach` for Base and Head under `<appData>/legible/worktrees/<review>/{base,head}`. Read-only by agent policy (§8). Each Batch with Change Requests gets `…/revisions/<id>` on a throwaway branch `legible/revision/<id>`.
- **Snapshots:** capture the working tree without touching the user's index or stash: use a temporary `GIT_INDEX_FILE`, `git add -A` (respects `.gitignore`), `git write-tree`, `git commit-tree -p HEAD`, then `git update-ref refs/legible/snapshots/<id>`.
- **Change detection:** a debounced filesystem watcher (e.g. @parcel/watcher) on local working trees recomputes the tree hash; if it differs from the current Snapshot, emit `iteration-available`.
- **Accepting a Revision (Author mode):** verify the user's branch tip and working tree are unchanged since the Revision was based (else refuse with an explanation); apply the selected hunks (`git apply --index` from a filtered patch); commit with a generated message (default) or leave uncommitted (setting). The commit becomes a new Iteration.
- **Foreign-repo safety:** cached clones of other people's repos get `core.hooksPath` pointed at an empty directory and `core.fsmonitor=false`; never run repo scripts.
- **Cleanup:** worktrees for closed/merged Reviews pruned after N days (`git worktree remove` + `prune`); disk-usage view in Settings.

## 6. Diff engine (`packages/diff`)

- **File pairing and renames** from `git diff --raw -z -M -C` between Base and Head trees.
- **Line diff** computed in-process with a histogram diff over blob contents (consistent output we control, rather than parsing `git diff` patches). **Word/char diff** within changed line pairs.
- **Fragments:** hunks are split at Symbol boundaries (from the indexer) so one hunk spanning two functions becomes two fragments. Fragments are the atomic unit Steps are built from.
- **Move detection:** hash normalized lines into blocks (min ~3 non-trivial lines) across all files; matched deleted/added blocks become "moved" pairs, rendered as moves.
- **Whitespace-only, generated, and lockfile** detection (`.gitattributes linguist-generated`, known lockfile names, header markers) → collapsed by default.
- **Interdiff:** a Change Set between consecutive Iteration Heads, with fragment ids mapped to the previous Iteration's for carry-over.

## 7. Indexer (`packages/indexer`, utilityProcess)

### 7.1 Grammars and Language Tiers

- `grammars/manifest.json` lists each language: file globs, WASM grammar, `highlights.scm`, optional `tags.scm`, optional `locals.scm`, and derived **Language Tier** (Full if tags present, Structural if grammar only).
- Bundle every grammar that ships a tags query (~25 mainstream languages) plus structural grammars for config formats (JSON, YAML, TOML, SQL, HCL). Pin grammar versions to a single web-tree-sitter ABI; a CI check loads every grammar.
- A generic "definitions" query per Structural-tier language yields Symbols without Connections.

### 7.2 Parse cache

Parse results are keyed by **blob OID + grammar version**, so identical files across Base, Head, and Iterations are parsed once. Stored on disk (msgpack) with an LRU bound.

### 7.3 Symbols and Connections

- **Symbols** from tags `@definition.*` captures: kind, name, qualified name (container chain), range, signature text.
- **Base ↔ Head matching:** by path + qualified name; then signature similarity for renames; unmatched = added/removed.
- **References** from `@reference.*` captures (calls, types, imports, implementations).
- **Scope of indexing:** parse all changed files fully; then find candidate referencing files cheaply with `git grep -w` on changed Symbol names in Head, and parse only those. Expanding beyond 1 hop repeats on demand. Whole-repo indexing is avoided by default.
- **Connection changes:** diff the outgoing reference sets of matched Base/Head Symbols → added/removed Connections.

### 7.4 Resolution pipeline (name → definition)

1. **Deterministic rules:** language-specific import/module resolution where tractable (TS/JS relative imports and `tsconfig` paths, Python relative/package imports, Go package paths, Rust `use` paths, Java/Kotlin packages), same-file and lexical scope (`locals.scm`), receiver type when syntactically evident, arity filter.
2. **Judge (`resolve-call-site`, §8.7):** the remaining ambiguous call sites go out as one batched Judge request per indexing pass, with one choice question per call site. The input is the call-site snippet, the file's imports and path, and each candidate's signature and path; the options are the candidates plus "none of these". Results are cached by call-site content hash. This step runs only when an external Judge backend (Jev or OpenAI Decisions) is enabled. Without one, the fast-tier model isn't used here; the volume is too high, so those call sites simply stay ambiguous.
3. **Confidence gate:** ≥ threshold (start 0.85, tune on evals) → resolved, marked "likely"; below → **Ambiguous Connection** with candidates ranked by probability.
4. **Precise resolver slot:** a `Resolver` interface so an LSP/SCIP-backed resolver can later override per language.

### 7.5 Structural equivalence

For each Base/Head fragment pair: parse both, normalize (drop whitespace/comments, canonicalize literals' formatting, alpha-rename local bindings), hash the subtree. Equal hash → **Structural Change** with a proof tag (`formatting`, `rename-local`, `move`, `extract`). A rename of an exported Symbol is structural only if every reference in the Change Set is updated consistently. Anything unproven stays **Behavioral** — the model may *suggest* structural, but only the proof collapses code.

### 7.6 Highlighting

Tree-sitter highlight queries produce compact token arrays per line (`[startCol, len, scopeId]`), sent to the renderer; the renderer never parses.

## 8. AgentRuntime and agents (`packages/agent-runtime`, utilityProcess)

### 8.1 Interface

```ts
interface AgentRuntime {
  provider: 'anthropic' | 'openai';
  run<T>(task: AgentTask<T>, opts: RunOptions): Promise<AgentResult<T>>;
  status(): Promise<RuntimeStatus>;          // e.g. "Claude Code detected, signed in"
  models(): Promise<ModelInfo[]>;            // feeds the model catalog (§8.6)
}

interface AgentTask<T> {
  kind: TaskKind;                            // 'explanation' | 'question' | 'lens' | ...
  modelTier: 'strong' | 'mid' | 'fast';      // resolved to { provider, model } by the router (§8.6)
  system: string;                            // versioned prompt
  prompt: string;
  cwd: string;                               // Base, Head, or Revision worktree
  tools: ToolGrant;                          // which Legible tools + which built-ins
  access: 'read-only' | 'revision-write';
  output?: ZodType<T>;                       // structured output schema
}

interface RunOptions {
  signal: AbortSignal;
  budgetUsd: number;
  onEvent?: (e: AgentEvent) => void;         // streaming text, tool calls, progress
}
```

v1 has two implementations ([ADR 0006](./adr/0006-multiple-model-providers.md)). Feature code never imports either directly. It submits tasks to the router.

**`ClaudeSdkRuntime`** (default) uses the Claude Agent SDK's `query()`:

- Auth per ADR 0002: "Use my Claude Code" sets `pathToClaudeCodeExecutable` to the user's resolved `claude`; "API key" passes credentials via `env` (spread `process.env` — the SDK's `env` replaces, not merges).
- Structured output via `outputFormat: { type: 'json_schema', schema }` with zod → JSON Schema draft-07. Handle the structured-output retry-exhausted failure explicitly.
- `maxBudgetUsd` per run; cost and usage from the result (`total_cost_usd`, `modelUsage`) recorded in `agent_runs`.
- Cancellation via `AbortController`; interactive tasks use streaming input so they can be interrupted.

**`OpenAIAgentsRuntime`** uses the OpenAI Agents SDK (TypeScript) over the Responses API:

- Auth: **Continue with ChatGPT** (OIDC + PKCE through OpenAI's Sign in with ChatGPT open-source client flow, using a registered client id and no client secret; a loopback redirect to the app; tokens in the keychain, refreshed by the runtime) or an **OpenAI API key**. Plan-backed tokens are used only for the Responses API requests the program allows.
- Every tool is a Legible-defined function tool (§8.2). There are no hosted or built-in tools (no web search, code interpreter, or file search), so the permission policy is enforced entirely in Legible's code.
- Structured output via the SDK's zod output type with strict JSON schema.
- Cost from Responses API `usage` × the model price table; budgets are enforced by the runtime, which aborts when the projected spend exceeds the cap.
- Conversation continuity via the SDK's session/previous-response mechanism.
- Cancellation via `AbortSignal`.

The Codex SDK was considered and rejected for this runtime: it brings its own coding agent and sandbox rather than Legible's tools, and its MCP server mode has been removed.

**`FakeRuntime` / `ReplayRuntime`** replay recorded runs for tests and the M0 prototype.

### 8.2 Legible tools (provider-neutral)

Tools are defined once in `packages/agent-runtime/tools/` as `{ name, description, input: ZodSchema, readOnly, handler }`. Adapters expose them as an in-process MCP server (`createSdkMcpServer`) for Claude and as function tools for OpenAI. Each is granted per task.

**Read tools:** `get_change_set_summary`, `list_fragments`, `get_fragment`, `read_file(side, path, range)`, `list_files(side, glob)`, `search(side, pattern)`, `get_symbol`, `find_references`, `get_connections(symbol, direction, depth)`, `get_connection_changes`, `get_intent`, `get_step`, `get_findings`, `git_log(path?, range?)`, `git_blame(path, range)`.

**Write tools** (only for `revision-write`, OpenAI runtime): `edit_file(path, oldText, newText)`, `write_file(path, content)`. These are constrained to the Revision worktree in the handler itself. The Claude runtime uses Claude Code's built-in Edit/Write, which are tuned for that model, with the same path restriction enforced by `canUseTool`.

`git_log`/`git_blame`/`search` are Legible tools rather than Bash, so agents get the capability without a shell.

### 8.3 Permission policy

| Access | Claude runtime | OpenAI runtime | Enforcement |
|---|---|---|---|
| `read-only` | Read, Grep, Glob + Legible read tools | Legible read tools | Claude: `allowedTools` allowlist + `canUseTool` denies the rest; OpenAI: only granted function tools exist. Neither has a shell, network, or web tools |
| `revision-write` | the above + built-in Edit, Write | the above + Legible `edit_file`, `write_file` | Writes outside the Revision worktree are denied (`canUseTool` / tool handler); no shell; no network tools |

Agents never load the repository's `.claude/` settings, hooks, plugins, or MCP config (`settingSources` empty) — see [ADR 0004](./adr/0004-agents-ignore-repo-claude-settings.md). Repo guidance files (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`) are read as plain text and supplied as context to the Lenses that need them.

**Prompt injection:** PR descriptions, Remote Comments, Agent Transcripts, and code are untrusted. They are passed in clearly delimited data blocks, agents have no exfiltration path (no network or shell tools), and the only writes possible are inside a Revision worktree the user reviews before accepting.

### 8.4 Scheduling

A priority queue in the agent host with a global concurrency cap (default 6, configurable):

1. Interactive: Explanations, Questions, Conversation turns
2. Foreground batch: Change Request runs, Scenario traces, Invariant checks
3. Background: Walkthrough/Brief generation, Lens runs, Verification, pre-generated Explanations

Each Review has a spend cap; the Review Plan's estimate is computed from context size × model price table before running. Concurrency is also capped per provider, and rate-limit responses back off per provider without stalling the other.

### 8.5 Prompts and schemas

Each pipeline's prompt + output schema lives in `packages/pipelines/<pipeline>/` with a `PROMPT_VERSION`. Optional per-provider overrides (`prompt.openai.md`) are allowed only when evals show a gap. Cache keys include provider, model, and prompt version, so prompt changes invalidate exactly the right cached outputs.

**Schemas** must satisfy both providers' structured-output rules: every field required (nullable instead of optional), `additionalProperties: false`, no unsupported keywords. A CI lint converts each zod schema into both providers' JSON Schema dialects and fails on anything one of them rejects.

### 8.6 Model catalog and tier routing

- **Catalog:** the union of `models()` across connected runtimes, joined with a curated `models.json` shipped with Legible. That file records context window, tool-use and structured-output support, price, and eval status (`recommended` / `experimental`). Models absent from `models.json` show as experimental with unknown price.
- **Tier map:** a setting `{ strong, mid, fast } → { provider, model }`, plus optional per-`TaskKind` overrides. Defaults: Claude models for every tier when Anthropic is connected; OpenAI models when only OpenAI is.
- **Router:** resolves each task to a runtime and model, and checks that the model supports the task's needs (tools, structured output, context size). If it doesn't, the task falls back to the tier's default and the user is told why.
- **Provider affinity:** a Conversation, and a Batch's Change Request run, are pinned to the provider they started on.
- **Cross-check Verification** (setting, available when both providers are connected): Verification runs on the provider that didn't produce the Finding.
- **Fast-tier Judge fallback:** the fallback Judge backend (§8.7) uses the fast tier's model, whichever provider that is.

### 8.7 Judge (`packages/judge`)

The Judge handles typed judgments that don't need generated text or tool-driven investigation ([ADR 0005](./adr/0005-judge-interface-for-typed-judgments.md)).

```ts
type Judgment =
  | { kind: 'choice';    name: string; instructions: string; options: { value: string; description: string }[] }
  | { kind: 'predicate'; name: string; instructions: string }
  | { kind: 'score';     name: string; instructions: string; levels: string[] };   // 2–10 ordered levels

interface Judge {
  judge(req: { input: JudgeInput; judgments: Judgment[] }, opts: { signal: AbortSignal }):
    Promise<JudgeAnswer[]>;   // choice + probabilities + confidence | probability | score + confidence | refusal
}
```

**Backends**, selected in Settings in this order of preference, with the first enabled one winning per judgment kind:

| Backend | API | Notes |
|---|---|---|
| TypeSafe Jev | `POST https://api.typesafe.ai/v1/systemone` (Choice / Noul / Score) | ≤ 255 options per choice; long input needs the `TypeSafe-Danger-Zone-Long-Context` header; pricing, latency, and retention undocumented at planning time |
| OpenAI Decisions | `POST /v1/decisions`, `client.decisions.create(...)`, model `gpt-6-luna` (choice / predicate / score) | 1–400 questions per request; input billed ($0.10 / 1M uncached at planning time), output free; prompt caching on shared input (≥ 1,024-token prefix); ZDR for eligible customers |
| Fast-tier model | Structured output on whichever provider serves the fast tier (§8.6) | Always available; one run per request with all judgments in one schema; self-reported confidence |

**Rules**

- **Batch over shared input.** Group judgments over the same Change Set, Step, or Finding set into one request. Put the large shared evidence first (it's the cached prefix) and keep per-question text short.
- **Thresholds per judgment and per backend**, stored in the judgment catalog and tuned on evals. Below threshold, a judgment is either shown as uncertain ("likely Unrequested") or escalated to an agent run with tools, depending on the catalog entry.
- **Cache by** hash(input, judgment definitions, backend, backend model).
- **Untrusted input:** the same delimiting rules as agents (§8.3). Judges have no tools, so there's no action surface.

**Judgment catalog (v1)**

| Judgment | Kind | Used by | Below threshold |
|---|---|---|---|
| `step-scope` | choice: each requirement id, `supporting`, `unrequested` | Walkthrough / Scope | show as "likely …"; Intent Conformance Lens re-checks |
| `requirement-covered` | predicate per requirement | Change Brief | escalate to an agent run |
| `description-states-domain-change` | predicate per Domain Change | Description Gap | treat as a gap with "possibly stated" |
| `risk-signal` | predicate per sensitive area per Step | Risk | fall back to deterministic detectors |
| `lens-applies` | predicate per conditional Lens | Review Plan | include the Lens (fail open) |
| `remote-comment-addressed` | predicate per thread per new Iteration | Remote Comments | no badge |
| `fragment-layer` | choice over Layers | Walkthrough planner hints | use path heuristics |
| `test-subject` | choice over candidate Steps | Walkthrough planner | attach by imports/naming |
| `findings-duplicate` | predicate per candidate pair | Agent Review dedupe | keep both |
| `domain-impact` | score per Finding / Domain Change | sorting | sort by severity |
| `anchor-relocation` | choice over candidate locations + none | Anchoring §11 | mark outdated |
| `transcript-match` | choice over candidate sessions + none | Intent §9.1 | ask the user |
| `ask-kind` | choice: question / change request | Ask composer | ask the user |
| `resolve-call-site` | choice over candidate Symbols + none | Indexer §7.4 | Ambiguous Connection (external backends only) |

## 9. Pipelines (`packages/pipelines`)

### 9.1 Intent

1. Collect sources: PR title/body/linked issue (host), Agent Transcript (below), user text.
2. **Agent Transcript import:** find agent session files whose project path matches the repo or worktree, whose timestamps overlap the Change Set's commits or Snapshot, and whose branch matches if that's recorded. v1 reads Claude Code sessions (`~/.claude/projects/`) and Codex CLI sessions (`~/.codex/sessions/`). Each source is an adapter, so others can be added. Extract user prompts, plan outputs, and user corrections. Both formats are internal and undocumented, so parse defensively, detect versions, and fail soft ("couldn't read transcript").
3. Mid-tier model produces a structured Intent: `{ goal, requirements: [{ id, statement }] }`. With no sources → **Inferred Intent** from the code, flagged for user confirmation.

### 9.2 Walkthrough planner

1. **Deterministic prep:** fragments; Symbol dependency edges between fragments (fragment A defines what B uses ⇒ A before B); Layer hints from path/framework heuristics (migrations/, schema, models → data model; routes/controllers/handlers → API; components/, *.tsx views → presentation; etc.); test ↔ subject links (imports + naming).
2. **Large Change Sets:** partition fragments into clusters by connected components of the dependency graph; run step 3 per cluster, then a merge pass that assigns Chapters.
3. **LLM grouping (mid tier, structured output):** input = fragment summaries with ids, edges, hints, Intent requirements. Output = Steps `{ name, narrative, layer, scope, requirementIds, fragmentIds[] }` in proposed order.
4. **Validation (deterministic):** every fragment in exactly one Step (missing → re-prompt once, then an "Other changes" Step; duplicates → keep first); stable topological sort using the LLM order as priority so dependency constraints always hold; tests attached to their subject's Step.
5. **Sittings:** greedy pack of Steps into ~300–400 changed lines (structural-collapsed lines weighted low), never splitting a Step.
6. **Stability across Iterations:** Steps whose fragment ids are unchanged keep name, order, and viewed state; only changed regions are re-planned.

### 9.3 Change Brief, Domain Changes, Scope, Risk, Description Gap

- **Domain Changes (strong tier):** from Behavioral fragments + Intent → `[{ statement, before, after, fragmentIds }]` in domain language.
- **Scope:** the Judge's `step-scope` judgment per Step, against the Intent's requirement ids, plus `requirement-covered` per requirement to find requirements with no implementing code. Re-checked by the Intent Conformance Lens when an Agent Review runs.
- **Risk:** deterministic detectors (paths, identifiers, APIs) and the Judge's `risk-signal` predicates per sensitive area (auth, payments, crypto, migrations, deletes, concurrency, public API surface), combined with blast radius (transitive Used-by count), give a base level. A model adjustment with a stated reason follows, and critical Findings raise the level.
- **Description Gap:** the Judge's `description-states-domain-change` predicate for each Domain Change against the PR title and description. Missing ones get suggested wording, generated by the fast tier.

### 9.4 Explanations

Fast tier. Context = Base and Head text of the target, its Connection changes, enclosing Step narrative, Intent. Output `{ before?, after, whatChanged, watchOut[] (≤2) }`. Cache key = hash(target content Base+Head, Connection changes, model, prompt version).

### 9.5 Asks, Batches, Revisions

- **Context pack per Ask:** anchored lines (both sides), enclosing Symbol(s), 1-hop Connections, the Step narrative, the user's instructions.
- **Questions:** one read-only run each, in parallel; answers stream into the Ask thread.
- **Change Requests:** one `revision-write` run in a fresh Revision worktree, with the Batch's Change Requests as an ordered, numbered list (each with its own context pack). The run must report per-Ask status (done / partially / couldn't) in structured output. The resulting diff (Head → Revision worktree) becomes the Revision's Change Set, opened in the viewer.
- **Reviewer mode:** accepted Revision hunks are converted to host suggestion syntax (GitHub ` ```suggestion ` blocks; GitLab ` ```suggestion:-N+M `) and added as Notes in the Pending Review. Hunks that can't map to a single-side line range become a regular Note with a patch.

### 9.6 Agent Review

1. **Review Plan:** deterministic Lens selection from Layers and signal detectors, plus the Judge's `lens-applies` predicates, which fail open. Then a cost estimate, which the user adjusts.
2. **Lens runs (strong tier, read-only, parallel):** each Lens gets the Change Set summary, Intent, Walkthrough, repo guidance text, and Legible tools. Output `Finding[]` (anchor by fragment id + line range, severity, title, rationale, suggestedFix?).
3. **Dedupe:** same file + overlapping ranges + similar titles → candidate pairs; the Judge's `findings-duplicate` predicate confirms merges. Merged Findings record contributing Lenses.
4. **Verification (strong tier, parallel, grouped per file):** a skeptical agent tries to disprove each Finding using the tools → confirmed / plausible / disproved with reason.
5. **Incremental reruns:** each Lens run records the fragment ids it covered; on a new Iteration only Lenses whose relevant fragments changed rerun, and prior Findings are re-verified as resolved/unresolved.

### 9.7 Scratchpad, Scenario trace, Conversation

- **Invariant suggestions:** derived from Intent + Domain Changes (mid tier); user accepts.
- **Invariant check:** a single targeted read-only run → `{ holds: 'yes' | 'no' | 'unclear', evidence: Anchor[], explanation }`.
- **Scenario trace (strong tier):** agent walks the Symbol graph with tools → `{ hops: [{ symbolId, anchor, action }] }` → rendered as a Mermaid sequence diagram whose nodes navigate (and join the Trail).
- **Conversation:** multi-turn, read-only, session resumed via the SDK's session id; citations parsed into Anchors.

## 10. Hosts (`packages/hosts`)

Common `Host` interface: `getPullRequest`, `listThreads`, `reply`, `resolveThread`, `createPendingReview`, `addPendingComment`, `submitReview`, `updateDescription`, `listCommits`, `permissions`.

- **Auth chain:** `gh auth token` / `glab` stored token (only read when the user adds an account and approves) → OAuth device flow (GitHub OAuth app without client secret; GitLab OAuth application with device grant) → PAT. Tokens stored via `safeStorage`.
- **GitHub:** GraphQL for review threads (thread resolution, pending reviews with comments, submit); REST for diffs, commits, permissions, description updates. GHES = same adapters with a custom base URL.
- **GitLab:** REST discussions, draft notes (pending review), `bulk_publish`, approvals; self-managed via base URL.
- **Polling:** ~60 s per open Review with conditional requests (ETag / `If-None-Match`); backoff on rate-limit headers. New head commit ⇒ `iteration-available`; new threads ⇒ merge into `remote_comments`.
- **Addressed threads:** on each new Iteration, the Judge's `remote-comment-addressed` predicate runs for every unresolved thread whose Anchor changed. It powers a "likely addressed" badge and never resolves a thread automatically.
- **Every write** is invoked only from an explicit user confirmation in the UI.

## 11. Anchoring

An Anchor stores `side, path, startLine, endLine` plus a **fingerprint**: anchored lines' normalized text, 3 lines of context before/after, and the enclosing Symbol id.

Re-anchoring on a new Iteration or Snapshot:

1. Fragment id unchanged → same position.
2. Exact text match of anchored lines + context within the same file (path follows renames).
3. Fuzzy match (diff-match-patch–style) above a similarity threshold, preferring locations inside the same Symbol. When there are several plausible locations, the Judge's `anchor-relocation` choice picks one (with a "none" option).
4. Otherwise `outdated` — kept, shown in an "Outdated" group with its original code.

Remote Comments are mapped from host coordinates (GitHub line/side/commit; GitLab position objects) into Anchors on the matching Iteration.

## 12. Diff renderer (`packages/ui/diff`)

- **Row model:** the visible document is a flat array of rows — file header, Step header, line pair (split) or line (unified), collapsed region, inline thread (Note/Ask/Remote Comment/Finding), Explanation card. Rows are derived from Change Set + Walkthrough + view settings in a memoized selector.
- **Virtualization:** TanStack Virtual with measured variable heights for inline threads; line rows fixed-height for fast scroll math.
- **Gutters:** fixed lanes — line numbers, change marker, comment/Ask lane, Finding lane, Scope/Risk lane.
- **Overview ruler:** a canvas mapped to full document height, drawing Risk regions, Unrequested regions, Findings by severity, comments, and the viewport window; click/drag to scroll.
- **Text:** monospaced, pre-tokenized spans from the indexer; intra-line word diff overlays.
- **Budgets:** 60 fps scrolling on 20k rows; < 150 ms to switch Steps; < 300 ms first paint for a 2,000-line file; memory stable across long sessions.
- **Keyboard:** a single command registry drives shortcuts, the command palette, and the shortcut overlay.

## 13. Security and privacy

- Renderer: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, strict CSP, no remote content; all Markdown (PR bodies, comments, agent output) rendered through a sanitizer; links open externally after confirmation.
- IPC: every request and event validated against zod schemas in `packages/ipc`; the renderer can't name arbitrary paths or commands — only domain operations.
- Secrets: keychain only (`safeStorage`); never logged; never written to SQLite. Claude.ai credentials are never read (ADR 0002). ChatGPT sign-in tokens are stored only in the keychain and used only for Responses API requests (ADR 0006).
- Agents: §8.3 permission policy; ADR 0004.
- Foreign repos: hooks disabled, no repo scripts executed.
- Judge backends: TypeSafe and OpenAI are off by default; enabling one shows exactly what is sent (code snippets, PR text, Intent) before saving the key.
- No telemetry; opt-in crash reporting only. README documents every outbound destination.

## 14. Testing and evaluation

- **Unit (Vitest):** git operations against generated fixture repos; diff/fragment/move detection; structural-equivalence proofs; Walkthrough validator (coverage + topological guarantees as property tests); Anchoring; Sitting packing; IPC schema round-trips.
- **Integration:** pipelines run against `ReplayRuntime` recordings for determinism; host adapters against recorded HTTP fixtures.
- **E2E (Playwright `_electron`):** open a fixture repo → Brief → Walkthrough → Ask → Revision → accept.
- **AI evals (`evals/`):** a growing set of real agent-written Change Sets with hand labels — Step grouping, Layer, Scope (esp. Unrequested), Domain Changes, Description Gaps, seeded bugs. Scored metrics: fragment coverage (must be 100%), dependency violations (must be 0 after validation), Unrequested recall, Domain Change recall/precision (judged), Finding precision after Verification, cost per 1k changed lines. Run on every prompt-version change; results committed. **Judge evals** score every catalog judgment on each backend against the same labels (accuracy, calibration, latency, cost), and set the per-backend thresholds. **Model evals** run the pipeline evals for every candidate provider+model per tier; a model is marked `recommended` in `models.json` only when it meets the tier's targets.
- **Fixtures:** `fixtures/` scripts generate deterministic repos, including the M0 design fixtures (refund-window feature with an Unrequested audit change and a Description Gap; a ~3,000-line multi-Chapter Change Set; a PR with Remote Comment threads).

## 15. Milestones — engineering scope and exit criteria

### M0 — UI design
- Claude Design exploration of the screens in the Product Plan's design brief.
- `apps/prototype` + `packages/ui` + Storybook: real React components and the real virtualized diff renderer, driven by fixture data and `ReplayRuntime`.
- Design tokens (light/dark), Scope/Risk visual language, gutter and ruler density settled.
- **Exit:** every core screen is clickable on fixtures; 60 fps scroll on the 3,000-line fixture.

### M1 — Shell, viewer, Explanations (daily use begins)
- Electron app, IPC contract, SQLite store, settings.
- Git layer: local repos, ref comparisons, Snapshots + change banner, PR diffs read-only (GitHub + GitLab fetch of PR refs; `gh`/`glab` token reuse for read).
- Diff engine: fragments (line-based until M2), word diff, renames, moves, generated/lockfile collapse.
- Structural detection: formatting/whitespace proofs (AST-backed proofs arrive with M2's indexer).
- AgentRuntime with both Claude auth paths, provider-neutral tool definitions and schema lint from day one, tier router (Claude-only catalog), scheduler, cost meter; Explanations on ranges and files.
- Packaging: notarized macOS build, auto-update.
- **Exit:** the author reviews real agent branches in Legible daily; click any range → Explanation in < 5 s (fast tier).

### M2 — Code structure
- Indexer utilityProcess, grammar manifest + Language Tiers, parse cache, highlighting moved to tree-sitter.
- Symbols, Base↔Head matching, Connections, Connection changes, resolution rules, Ambiguous Connections.
- Symbol-boundary fragment splitting; AST-backed structural-equivalence proofs.
- Connections panel, ⌘-click, Trail; Explanations on Symbols and Connections.
- **Exit:** on fixture and real repos in ≥ 5 Full-tier languages, Connections panel loads < 500 ms after a Step opens.

### M3 — Understanding
- Intent pipeline incl. Agent Transcript import and Inferred Intent.
- Walkthrough planner + validator, Chapters, Sittings, Step editing.
- Change Brief: Domain Changes, Scope, Risk, Description Gap, component map, Sitting estimate.
- Evals harness live with ≥ 20 labeled Change Sets.
- `packages/judge` with the fast-tier backend plus the Jev and OpenAI Decisions backends; an early spike measures latency and cost on large Change Sets; thresholds come from Judge evals.
- `OpenAIAgentsRuntime`: Continue with ChatGPT (registered open-source client) and API key; model catalog across both providers; per-tier and per-task model picker; Cross-check Verification setting (used in M5); Codex CLI transcript adapter. Gated on model evals.
- **Exit:** 100% fragment coverage and 0 dependency violations on evals; Unrequested recall ≥ target agreed after first eval run.

### M4 — The feedback loop
- Full host integration: Remote Comments (reply/resolve), Notes, Pending Review publish (GitHub GraphQL, GitLab draft notes); OAuth device flow + PAT; GHES and self-managed GitLab; polling.
- Asks, Batch tray, parallel Questions, Change Request runs → Revisions, partial accept, commit-on-accept; Reviewer-mode suggestions.
- Iterations, Interdiff, carry-over of viewed state/Anchors/Walkthrough.
- Scratchpad (Invariants, To-checks, resurfacing); Description Gap actions.
- **Exit:** a full loop — Ask → Revision → accept → new Iteration → Interdiff — works on a real agent branch and a real GitHub PR and GitLab MR.

### M5 — Agent Review and deep tools
- Review Plan, parallel Lenses, dedupe, Verification, Findings panel/gutter/ruler, incremental reruns.
- Invariant checks, Scenario traces, Conversations.
- Call-site disambiguation through external Judge backends (`resolve-call-site`); `findings-duplicate`, `domain-impact`, `lens-applies` judgments.
- **Exit:** on evals, confirmed+plausible Finding precision ≥ target; full Agent Review of a 1,000-line Change Set completes in < 5 min within its spend cap.

## 16. Technical risks

| Risk | Mitigation |
|---|---|
| Subscription auth path not accepted by Anthropic | AgentRuntime transport swap to `claude -p --output-format stream-json` (ADR 0002); API key path always works |
| Agent Transcript format is internal and may change | Defensive parser, version detection, fail-soft; later replace with our own provenance hooks |
| Concurrent SDK `query()` calls not explicitly documented as supported | Validate early in M1 with a spike; scheduler cap; fall back to per-run processes |
| Sign in with ChatGPT program terms or eligibility change | API-key path always works; the OpenAI runtime is independent of how it authenticates |
| Quality differs across providers on the same prompts | Per-provider prompt overrides, model evals per tier, only `recommended` models offered by default |
| WASM grammar ABI drift | Pin grammars to one web-tree-sitter ABI; CI loads every grammar |
| LLM grouping drops/duplicates fragments or breaks order | Deterministic validator guarantees coverage and topology regardless of model output |
| Cost on large Change Sets | Clustered planning, caching by content hash, Review Plan estimates, hard spend caps |
| Large repos / monorepos | `git grep`-scoped indexing, blob-OID parse cache; sparse checkout later |
| Host API complexity (pending reviews, suggestion mapping) | Adapter-level recorded-fixture tests; suggestions fall back to patch Notes |
| Judge backends disagree or are poorly calibrated on code | Per-backend thresholds from evals; fast-tier fallback; uncertain results shown as "likely", never as fact |
| Prompt injection via PR content | No network/shell tools, delimited untrusted data, writes only in a reviewed Revision worktree |

## 17. Open technical questions

- electron-vite vs Electron Forge (decide at M1 start).
- Drizzle vs Kysely (decide at M1 start).
- Exact Sitting size and per-backend Judge thresholds: tune on evals.
- The default external Judge backend if a user enables both. Decide from Judge evals.
- Whether Domain Change extraction needs the strong tier or mid tier suffices — decide from M3 evals.
