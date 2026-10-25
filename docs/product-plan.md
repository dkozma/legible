# Legible — Product Plan

_Working name. Status: v1 planning. Companion docs: [Engineering Plan](./engineering-plan.md), [Glossary](../CONTEXT.md), [ADRs](./adr/)._

Terms in **bold** are defined in [CONTEXT.md](../CONTEXT.md). Use them exactly.

---

## 1. The problem

AI agents now write large, plausible-looking changes faster than humans can understand them. The failure mode isn't syntax errors — agents are good at those — it's the human **losing their mental model** of the system: incorrect business rules quietly codified, extra behavior nobody asked for, and approvals of code nobody really read.

Existing review tools are organized around files in alphabetical order and around finding bugs. Neither matches how people understand change, nor what matters most when supervising an agent.

## 2. Who it's for

**Primary: a developer supervising an AI agent's work on their own branch (Author mode).** They own the code, didn't write it, and need to understand it well enough to stand behind it.

**Secondary: a developer reviewing someone else's Pull Request (Reviewer mode).** Same understanding needs; can't push, so Claude's edits become suggestions.

The first user is the author of this tool. Build for daily personal use, then generalize.

## 3. What we optimize for, in order

1. **Human understanding** of the **Change Set** and the effect it will have on the product/system.
2. **Domain understanding** — understanding and communicating what business/domain behavior changed.
3. **Surfacing Unrequested changes** — anything the code does beyond, or differently from, the **Intent**. Agents often do extra things in unexpected ways; this must be impossible to miss.
4. **Bugs and regressions** the change may introduce. _(Lower: agents are already good at this.)_
5. **Divergence from established patterns** in the codebase or docs. _(Lowest: agents are already good at this too.)_

When features compete for screen space, attention, or build time, the lower-priority goal yields.

## 4. Cognitive-load principles

Grounded in code-review and cognitive-psychology research (SmartBear/Cisco, Google, and Microsoft review studies; eye-tracking studies of review; vigilance, rest, and working-memory research; Locke & Latham on goal-setting; Dunlosky et al. on learning techniques).

| Principle | How Legible applies it |
|---|---|
| Small chunks are the strongest lever (~200–400 LOC) | **Steps**, **Chapters**, and **Sittings** divide any Change Set into finishable pieces |
| Advance organizer before reading | Every Review opens on the **Change Brief** |
| Orient before judging | Brief → Walkthrough; no line-level judgment required on first pass |
| Start with what matters, not alphabetical order | Dependency-ordered **Walkthrough**; **Risk** visually marked everywhere |
| Separate refactors from behavior | **Structural** vs **Behavioral** changes; verified-structural collapsed |
| Externalize working memory | **Scratchpad** (Invariants, To-checks); Connections panel for delocalized logic |
| Worked examples for unfamiliar domains | **Scenario trace** |
| Self-explanation beats re-reading | Self-explanation prompts (v1.1) |
| Approve only what you read | Coverage tracking and honest coverage statements (v1.1) |
| Structure substitutes for depleted attention | Focused single-concern passes with fading checklists (v1.1) |
| Rest restores vigilance; task-switching doesn't | Optional pace and break nudges; defer high-risk Steps when fatigued (v1.1) |
| Meaningful feedback over gamification | Track record of what reviews caught (later). No points, no streaks |

## 5. Modes

- **Author mode** — the user can push. **Change Requests** produce **Revisions** that, once accepted, are committed to the branch (one commit per accepted Revision by default; setting to leave uncommitted).
- **Reviewer mode** — the user can't (or shouldn't) push. Accepted Revision hunks become suggestion comments in the **Pending Review**. Legible never pushes to someone else's branch.

Mode is inferred from push permission and overridable.

## 6. The core flow

```
Open a source ──► Review created ──► Change Brief ──► Walkthrough (by Sitting)
   (PR URL,           (Snapshot if        (Intent, Domain      Step by Step: diff, Connections,
    two refs,          working tree)       Changes, Scope,      Explanations, Notes, Asks,
    working tree)                          Risk, Gaps)          Scratchpad
                                                                     │
          ┌──────────────────────────────────────────────────────────┘
          ▼
   Submit Batch of Asks ──► Questions answered in parallel
                        └─► Change Requests ──► Revision ──► review & accept (whole/partial)
                                                                  │
   Optional Agent Review (Review Plan → Lenses → Verification → Findings)
                                                                  │
   Publish Pending Review (Reviewer mode)  /  commit (Author mode) ──► next Iteration ──► Interdiff
```

## 7. Features

### 7.1 Sources and Change Sets

- Open from: a GitHub PR / GitLab merge request URL; two refs (`main...feature`, local or remote); a local working tree including staged and uncommitted changes.
- Every source reduces to a **Change Set** (**Base** + **Head**). For Pull Requests and ref comparisons, Base is the merge-base (GitHub "three-dot" semantics).
- Working trees are captured as a **Snapshot**. When the working tree changes, a banner offers "New changes since snapshot — refresh?" It never refreshes silently.

### 7.2 Reviews, Iterations, Interdiff

- A **Review** persists across **Iterations** (Snapshots, pushed commits, accepted Revisions).
- On a new Iteration, the default view is the **Interdiff** (if the previous Iteration was viewed); the full Change Set is one click away.
- Carried forward across Iterations: viewed state per Step (reset only if that Step's content changed); Notes, Asks, and Findings (re-anchored by content, else marked outdated, never deleted); Walkthrough structure (rebuilt but stable where code is unchanged).
- Agent Review reruns incrementally — only affected Lenses — and checks whether earlier Findings were resolved. Full rerun on demand.
- All data local. Export a Review to Markdown or JSON.

### 7.3 Intent

- Sources: Pull Request title/description and linked issue; **Agent Transcript** import from local Claude Code sessions (original prompt, plans, user corrections); pasted text.
- With no Intent, Legible produces an **Inferred Intent** and asks the user to correct it. A wrong Inferred Intent is itself a signal worth noticing.
- Future: install agent hooks that record edit provenance (the agent's reasoning per edit, à la git-ai / Entire) and attach it to the hunks it produced.

### 7.4 Change Brief

The orientation page every Review opens on:

- **Intent** (with source shown, editable).
- **Domain Changes** — business-rule changes in domain language, each linked to its implementing code. _"Refunds are now allowed up to 60 days after purchase (was 30)."_
- **Description Gap** — Domain Changes absent from the PR title/description, with suggested wording. Reviewer mode: one click drafts a Note asking the author to add them. Author mode: "Update PR description" (confirmed before publishing).
- **Unrequested** Steps, listed prominently.
- **Risk** hotspots (critical and elevated Steps).
- Component map of touched areas (by Layer).
- How to test (from the PR, or suggested).
- Size and Sitting estimate ("~3 Sittings, ~2 hours").

### 7.5 Walkthrough

- An ordered list of **Steps** covering every changed line exactly once, in dependency order (definitions before uses), then by **Layer** (data model → backend logic → API surface → client data → presentation → chores).
- Each Step: a name, a 1–3 sentence narrative tied to the Intent, its **Scope** (Requested / Supporting / Unrequested), its **Risk**, and its fragments (hunks split at Symbol boundaries where needed).
- Tests attach to the Step whose behavior they verify.
- **Chapters** appear only when a Change Set contains multiple independent features.
- **Sittings** cut the Walkthrough into ~300–400 changed lines / ~45-minute sessions at Step boundaries; progress per Sitting.
- **Structural** fragments verified to be behavior-preserving are collapsed with a badge.
- Dependency order is always the default. Risk is shown through visual treatment, not reordering. Opening a Step out of order shows a compact "you'll need to know" strip of its prerequisites.
- The user can merge, split, and move Steps; edits persist with the Review.
- Alternative views of the same Change Set: **File tree** and **Findings**.

### 7.6 Diff viewer

- Split and unified views; word- and character-level intra-line highlighting; tree-sitter syntax highlighting on both sides.
- Expand context incrementally or to the enclosing Symbol.
- Detects moved code and renamed files; hides whitespace-only changes; collapses generated files and lockfiles by default.
- Virtualized: a 5,000-line file or a 200-file Change Set scrolls smoothly.
- Gutter markers for Notes, Remote Comments, Asks, and Findings; an overview ruler on the scrollbar showing the same markers plus Risk and Unrequested regions, VS Code–style.
- Viewed checkmarks per Step and per file; progress bar.
- Keyboard-first: `j/k` hunks, `n/p` Steps, `c` Note, `a` Ask, `e` Explain, `⌘K` command palette, `⌘[ / ⌘]` Trail. `⌘`-click any identifier to jump to its definition.
- No in-place editing in v1. "Open in editor" (VS Code, Cursor, `$EDITOR`) at the current line.

### 7.7 Relationships

- A **Symbol** graph of Head (plus Base for changed or deleted Symbols). **Connections**: calls / called-by, type references, imports, implements/overrides.
- **Connection changes** are first-class: "`refundOrder` no longer calls `auditLog()`."
- Scope: changed Symbols plus 1-hop neighbors, including unchanged code; expand further on demand.
- **Connections panel** beside the code: "Uses →" and "← Used by", each with a change badge; hover preview; optional mini-graph for the current Step.
- **Trail**: browser-style back/forward (`⌘[ / ⌘]`) with breadcrumbs.
- **Ambiguous Connections** show every candidate with a "?" badge, never silently guessed. Optional Jev disambiguation (off by default; user's TypeSafe key) reduces them; high-confidence picks show as "likely".
- **Language Tiers** follow tree-sitter grammar availability: Full (grammar + tags query), Structural (grammar only), Text (no grammar). All grammars that ship tags queries are bundled.

### 7.8 Explanations

- Available on a Symbol, a selected range, a Step, or a Connection ("how does A use B?").
- Fixed shape: **Before** (Base; omitted for new code) · **After** (Head) · **What changed** (behavioral difference, Connection changes, fit with Intent) · **Watch out** (0–2 items, only if warranted).
- Concise by default (~5 lines per section); "Go deeper" turns it into a Question thread.
- Cached per Symbol per Head; lazily generated, optional background pre-generation for changed Symbols (off by default).

### 7.9 Comments, Asks, Batches, Revisions

- **Remote Comments** shown in place; reply and resolve threads from Legible.
- **Notes** — local, private until published in a **Pending Review** with a verdict (approve / request changes / comment).
- **Asks** — anchored, addressed to Claude, each carrying its own instructions and context (selected lines, enclosing Symbol, relevant Connections).
  - **Questions** — answered in parallel, inline as threads.
  - **Change Requests** — carried out together, in order, in one agent run in an isolated worktree, producing one **Revision**.
- A **Batch** collects Asks for submission together; a Batch tray shows pending Asks before submitting.
- A **Revision** opens as its own Change Set (Base = prior Head). Accept whole or per-hunk. Author mode: commit. Reviewer mode: suggestion comments.
- Every write to the host (publish review, reply, resolve, update description) is confirmed explicitly.

### 7.10 Scratchpad

- User-owned private memory per Review; Claude suggests entries, the user adds them.
- **Invariants** — rules that must hold. "Check this Invariant" runs a narrowly targeted analysis across Head.
- **To-checks** — deferred items, optionally anchored. Unresolved To-checks resurface before a Sitting ends or a Pending Review is published; promote to an Ask in one click.

### 7.11 Scenario trace

- The user picks or describes a concrete case ("a refund request for a shipped order"). Claude traces it hop by hop through the changed code using the Symbol graph and renders a clickable sequence diagram. Each hop opens in the viewer and joins the Trail.

### 7.12 Agent Review

- **Review Plan** first: the selected **Lenses** and estimated cost; the user toggles Lenses, then runs.
- Lenses, in priority order:

| Lens | Runs when |
|---|---|
| Intent Conformance (drives Scope tagging) | always |
| Correctness & Bugs | always |
| Tests | non-trivial changes |
| Security | auth, user input, queries, secrets, network, filesystem, serialization, dependencies |
| Data Model & Migrations | a data-model Step exists |
| API Contract | an API-surface Step exists |
| Performance | loops over data, queries, rendering paths, caching, concurrency |
| Frontend | a presentation Step exists |
| Altitude & Design | always |
| Code Quality | always (nits collapsed by default) |

- Lenses run in parallel, one agent each, returning structured **Findings**.
- **Verification**: each Finding is independently challenged by a skeptical agent → confirmed / plausible / disproved. Disproved are hidden but kept. Duplicates across Lenses merge (and agreement raises confidence).
- Findings appear as gutter icons, overview-ruler ticks colored by severity, and in the Findings panel (sorted by Intent and domain impact first). Actions: dismiss (with optional reason), turn into Note, turn into Change Request.
- Spend cap per Agent Review; running cost meter.

### 7.13 Conversation

- Unanchored, read-only dialogue about the Change Set or the wider repo, saved with the Review.
- Agent sees Base and Head (read-only), the Symbol graph via tools, the Walkthrough, Findings, and Intent. Allowed: file reads, search, `git log`, `git blame`. No arbitrary shell.
- Every file/line citation is a clickable Anchor. Suggested edits must be turned into a Change Request.

### 7.14 Hosts and accounts

- github.com, GitHub Enterprise Server, gitlab.com, self-managed GitLab — all in v1.
- Sign-in order: reuse `gh` / `glab` CLI credentials → OAuth device flow → personal access token.
- Polls open Reviews (~60 s, conditional requests) for new pushes and Remote Comments.

### 7.15 Claude and settings

- **"Use my Claude Code"** — Legible drives the user's own installed, signed-in `claude`; Legible never touches credentials. **"API key"** — Anthropic, Bedrock, Vertex, or Foundry, stored in the OS keychain.
- Model tiers (overridable): strongest for Lenses, Verification, Change Requests, Scenario traces; mid-tier for Walkthrough, Brief, Domain Changes, Conversations; fast for Explanations and Scope tagging.
- Optional TypeSafe (Jev) key for Connection disambiguation.

## 8. Privacy and trust

- No telemetry; opt-in crash reports only.
- Code leaves the machine only to: the user's git host, Claude (via the user's chosen auth), and TypeSafe if Jev is enabled. The README states this plainly.
- Agents are read-only everywhere except the isolated Revision worktree. Legible never pushes, publishes, or comments without explicit confirmation.

## 9. Milestones

| # | Milestone | Outcome |
|---|---|---|
| **M0** | **UI design** — visual exploration in Claude Design, then a coded prototype in the real React stack with fixture Change Sets; becomes the M1 component library | Every core screen designed and clickable |
| **M1** | **Shell, viewer, Explanations** — Electron app; Change Sets from refs, working-tree Snapshots, and PR diffs (read); diff viewer, file tree, keyboard; Structural/Behavioral and move detection; AgentRuntime with both auth paths; Explanations | **Daily use begins** — read agent changes in a better viewer and click anything to explain it |
| **M2** | **Code structure** — tree-sitter Language Tiers, Symbols, Connections panel, Connection changes, Trail, ⌘-click | See how changes connect to the rest of the system |
| **M3** | **Understanding** — Intent (PR, Agent Transcript, Inferred), Walkthrough (Steps, Layers, Chapters, Sittings), Change Brief, Domain Changes, Scope, Risk, Description Gap | Priorities 1–3 delivered |
| **M4** | **The feedback loop** — Notes, Remote Comments (reply/resolve), Pending Review; Asks, Batches, Revisions with partial accept; Iterations and Interdiff; Scratchpad | Steer the agent's next round from inside Legible |
| **M5** | **Agent Review and deep tools** — Review Plan, Lenses, Verification, Findings; Invariant checks; Scenario traces; Conversations; Jev | Priorities 4–5 delivered |
| **v1.1** | Focused passes with fading checklists; self-explanation prompts; coverage tracking and honest coverage statements; pace and break nudges; tests-first toggle | |
| **Later** | Retrieval practice and spaced revisits; track record; linter/type-check integration; edit-provenance agent hooks; precise resolution (LSP/SCIP); sparse checkout for monorepos; other agents (Codex, Gemini CLI, local models) | |

## 10. Non-goals for v1

- In-place code editing (use "Open in editor").
- A hosted service, team sync, or multi-machine sync.
- Running the project's tests or arbitrary shell commands from agents.
- Gamification.
- Non-Claude agents (the interface allows them; none ship).

## 11. How we'll know it works

No telemetry, so success is judged by the author's own use and, later, user reports:

- Daily use from M1 on real agent-written branches.
- Unrequested changes and Description Gaps that would otherwise have shipped are caught.
- A ~1,000-line agent change can be understood in Sittings without re-reading.
- Disproved Findings stay a small fraction of all Findings (Verification is doing its job).
- The user can state the Domain Changes of a Review from memory after finishing it.

## 12. Landscape

Adjacent tools surfaced during planning (verify before launch): **Reviewly** (open-source Tauri PR desktop app with AI walkthrough), **Review** (MIT desktop app with rule-based AI reviewers and visible rule coverage), **Peck** (macOS menu-bar plain-language PR explanations), **mrge** (logical grouping of changes). None centers Domain Changes, Unrequested-change detection, or cognitive-load structure.

## 13. Open questions and risks

- **Subscription auth path** must be confirmed with Anthropic before public release (see [ADR 0002](./adr/0002-agent-runtime-and-claude-auth.md)).
- **Name** — "Legible" is a working name; trademark search before public launch. Product name must not include "Claude Code".
- **Jev data handling** — TypeSafe's data retention isn't documented; disclose before users enable it.
- **Domain Change accuracy** — the highest-value output is also the hardest to get right; needs an evaluation set of real agent PRs early (M3).
- **Cost** on large Change Sets — Review Plan estimates and spend caps must be trustworthy.

## 14. License

Apache-2.0, with DCO sign-off for contributions.

---

## Appendix A — M0 design brief (for Claude Design)

**Product:** Legible, a desktop app (macOS first) for understanding AI-agent-written code changes and Pull Requests. Keyboard-first, information-dense but calm, in the lineage of Linear and VS Code. Dark and light themes.

**Design priorities:** (1) understanding over bug-hunting; (2) reduce cognitive load — one concern at a time, clear progress, finishable chunks; (3) Unrequested changes and Risk must be unmistakable at a glance without being alarming.

**Screens to design:**

1. **Change Brief** — Intent (with source and edit), Domain Changes (each linking to code), Description Gap callout, Unrequested Steps, Risk hotspots, component map by Layer, how to test, Sitting estimate, "Start Sitting 1".
2. **Review workspace** — left: Walkthrough (Chapters → Steps, with Scope and Risk markers, viewed state, Sitting boundaries and progress); center: diff viewer (split/unified, syntax highlighting, collapsed structural fragments, gutter markers, overview ruler); right: Connections panel / Explanation / Scratchpad (tabbed or stacked).
3. **Visual language for Scope and Risk** — Requested / Supporting / Unrequested; low / elevated / critical. Must work in the Walkthrough list, the gutter, the overview ruler, the file tree, and the Brief.
4. **Explanation card** — Before / After / What changed / Watch out; "Go deeper".
5. **Connections panel and Trail** — Uses / Used by with change badges, Ambiguous ("?") and "likely" states, Connection-change rows ("no longer calls"), breadcrumbs, back/forward.
6. **Asks and the Batch tray** — composing an Ask on a range (Question vs Change Request), the tray of pending Asks, submission, inline Question answers.
7. **Revision review** — a Revision as its own Change Set with per-hunk accept, and the accept → commit (Author) / suggestions (Reviewer) outcome.
8. **Agent Review** — Review Plan (Lenses, cost), running state (parallel Lenses with progress), Findings panel, Finding detail with Verification status and actions.
9. **Scratchpad** — Invariants (with "check" and result), To-checks (anchored, resurfacing prompt).
10. **Pending Review publish** — Notes list, verdict, confirmation.
11. **Iteration banner and Interdiff toggle.**
12. **Command palette** and keyboard-shortcut overlay.
13. **Settings** — Claude auth (Use my Claude Code status / API key), model tiers, hosts and accounts, Jev toggle with privacy note, spend caps.

**Fixtures to design against:** a ~600-line agent-written "refund window + partial refunds" feature spanning migration → service → API → client store → UI, including one Unrequested audit-log change and one Description Gap; a ~3,000-line multi-Chapter Change Set; a PR with existing Remote Comment threads.
