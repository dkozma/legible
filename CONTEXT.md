# Legible

_Legible is a working name._ A desktop tool for understanding and supervising code changes — primarily changes written by an AI agent on the user's own branch, secondarily other people's pull requests — so the user keeps an accurate mental model of how the code works and catches incorrect logic or wrongly-codified business rules.

## Language

### Modes

**Author mode**:
Reviewing a change on a branch the user owns and can push to (typically agent-written). **Change Requests** are applied as local edits.
_Avoid_: Self-review, local mode

**Reviewer mode**:
Reviewing a change on a branch the user cannot (or should not) push to, such as a teammate's pull request. **Change Requests** become suggestion comments, never pushes.
_Avoid_: PR mode, remote mode

### Models

**Provider**:
A company whose models Legible can run agent work on: Anthropic (Claude, the default) or OpenAI. A user may configure one or both.
_Avoid_: Vendor, backend, LLM

**Model Tier**:
One of three capability levels (strong, mid, fast). Every kind of agent work is assigned a tier, and each tier is mapped to one Provider and model of the user's choosing. Tiers need not share a Provider.
_Avoid_: Model size, quality level

### Reviews

**Review**:
The user's ongoing work on one branch or **Pull Request**, persisting across **Iterations**. Holds the **Notes**, **Asks**, **Findings**, **Conversations**, viewed state, and **Walkthrough** for that work.
_Avoid_: Session, workspace

**Iteration**:
One **Head** within a **Review** — a **Snapshot**, a pushed commit, or an accepted **Revision**. Each Iteration defines a **Change Set** against the Review's **Base**.
_Avoid_: Version, round, revision (a Revision is a proposal; an Iteration is a reviewed state)

**Interdiff**:
The difference between two consecutive **Iterations**' Heads — "what changed since I last looked."
_Avoid_: Incremental diff, delta

### Changes

**Change Set**:
The unit being reviewed: a **Base** revision and a **Head** revision of one repository. Every source (pull/merge request, ref comparison, local working tree) reduces to a Change Set.
_Avoid_: Diff, PR, patch (a diff is how a Change Set is displayed, not the thing itself)

**Base** / **Head**:
The "before" and "after" revisions of a **Change Set**.
_Avoid_: Old/new, left/right, source/target

**Snapshot**:
A frozen **Head** captured from a working tree, including uncommitted edits, so the **Change Set** under review doesn't move while the user reviews it. A newer working-tree state is offered as a refresh, never applied silently.
_Avoid_: Live view, watch

**Pull Request**:
A GitHub pull request or GitLab merge request backing a **Change Set**; the only source that carries **Remote Comments**.
_Avoid_: MR (use Pull Request for both hosts)

**Intent**:
What a **Change Set** was supposed to accomplish: its goal and the business requirements it should codify. Sourced from a Pull Request description, the originating agent transcript, or text the user provides.
_Avoid_: Spec, requirements doc, description

**Inferred Intent**:
An **Intent** reconstructed by the agent from the code alone when none was supplied, shown to the user for correction. A wrong Inferred Intent is itself a review signal.

**Agent Transcript**:
The record of the AI agent session that produced a **Change Set** — the user's prompts, plans, and corrections. A source of **Intent**.
_Avoid_: Chat log, session history

### Relationships

**Symbol**:
A named code definition — function, method, class, type, module-level constant — in either **Base** or **Head**.

**Connection**:
A directed relationship between two **Symbols** (calls, references a type, imports, implements/overrides). Connections can themselves be added or removed by a **Change Set** — "no longer calls X" is a Connection change.
_Avoid_: Edge, link, dependency

**Ambiguous Connection**:
A **Connection** whose target could not be determined with confidence among several candidate **Symbols**. Shown with every candidate, never silently guessed.

**Language Tier**:
How much the tool understands a language, determined by its available grammar: Full (Symbols and Connections), Structural (Symbols only), or Text (lines only).

**Trail**:
The user's back/forward navigation history across **Symbols** and **Steps** within a review.
_Avoid_: History, breadcrumbs (breadcrumbs are how a Trail is displayed)

### Understanding

**Explanation**:
A short, fixed-shape account of a **Symbol**, range, **Step**, or **Connection**: what it did on **Base** (Before), what it does on **Head** (After), the behavioral difference (What changed, including Connection changes and fit with the **Intent**), and optionally up to two risks (Watch out). Expanding an Explanation turns it into a **Question** thread.
_Avoid_: Summary, description

### Scratchpad

**Scratchpad**:
The user's private external memory for a **Review**, holding **Invariants** and **To-checks**. User-owned: the agent may suggest entries, but only the user adds them.
_Avoid_: Notebook, notes (a Note is a human-directed comment)

**Invariant**:
A rule the user believes must always hold (e.g. "refunded total never exceeds paid total"). The agent can be asked to check an Invariant against **Head**.
_Avoid_: Assertion, rule, constraint

**To-check**:
Something the user intends to verify later, optionally anchored to code. Unresolved To-checks resurface before a **Sitting** ends or a **Pending Review** is published, and can be promoted to an **Ask**.
_Avoid_: TODO, open question (a Question is an Ask)

### Agent Review

**Agent Review**:
A multi-agent analysis of a **Change Set**: a set of **Lenses** run in parallel, followed by **Verification**, producing **Findings**.
_Avoid_: Code review (ambiguous with the human activity), scan, audit

**Lens**:
One specialized reviewer perspective within an **Agent Review** — e.g. Correctness & Bugs, Intent Conformance, Altitude & Design, Code Quality, Tests, Security, Performance, Data Model & Migrations, API Contract, Frontend. Some Lenses always run; others run only when the **Change Set** contains relevant **Layers** or signals.
_Avoid_: Reviewer, agent, check

**Review Plan**:
The proposed set of **Lenses** for an **Agent Review**, with an estimated cost, shown to the user for adjustment before the review runs.

**Finding**:
A single issue raised by a **Lens**: an **Anchor**, a severity (critical, warning, nit), a title, a rationale, and optionally a suggested fix. A Finding can be dismissed, or turned into a **Note** or a **Change Request**.
_Avoid_: Issue, comment, lint, warning (warning is a severity)

**Verification**:
The pass in which each **Finding** is independently challenged against the code; a Finding ends as confirmed, plausible, or disproved. Disproved Findings are hidden by default but kept.
_Avoid_: Validation, triage

### Conversation

**Conversation**:
An unanchored, read-only dialogue with the agent about the **Change Set** or the wider repository, kept with the review. Its answers cite code as **Anchors**; it never edits code — suggested edits must be turned into a **Change Request**.
_Avoid_: Chat, Q&A (a Question is anchored; a Conversation is not)

### Comments and Asks

**Anchor**:
The line or line range on **Base** or **Head** that a comment or **Ask** is attached to. Anchors are re-matched by content when a **Snapshot** refreshes; unmatched anchors become outdated, never deleted.
_Avoid_: Position, location

**Remote Comment**:
A comment that lives on the **Pull Request** host (GitHub/GitLab), written by anyone.
_Avoid_: PR comment, review comment

**Note**:
A human-directed comment the user writes locally. Notes stay private until published as **Remote Comments** in a **Pending Review**.
_Avoid_: Local comment, draft

**Pending Review**:
The set of unpublished **Notes** that are published together with a verdict (approve, request changes, comment) to a **Pull Request**.

**Ask**:
A comment addressed to the AI agent (whichever **Provider** serves it), anchored to code and carrying its own instructions and context. Either a **Question** or a **Change Request**.
_Avoid_: Prompt, AI comment, instruction

**Question**:
A read-only **Ask** seeking an explanation; answered inline as a thread on the Ask.

**Change Request**:
An **Ask** that requests a code modification. Its result is delivered as part of a **Revision**, never applied directly.
_Avoid_: Fix request, edit

**Batch**:
A group of **Asks** submitted together. Its Questions are answered independently and in parallel; its Change Requests are carried out together, in order, as one agent run producing one **Revision**.

**Revision**:
A proposed new **Head** produced by carrying out a **Batch**'s Change Requests, presented as its own **Change Set** (Base = the prior Head) for the user to accept in whole or in part. In **Author mode** acceptance commits to the branch; in **Reviewer mode** it yields suggestion comments.
_Avoid_: Patch, fix, agent edit

### Orientation

**Change Brief**:
The orientation page that opens every **Review**: the **Intent**, a map of touched components, the **Domain Changes**, **Risk** hotspots, **Unrequested** Steps, any **Description Gap**, and how to test. Read before any code.
_Avoid_: Summary, overview, PR description

**Domain Change**:
A change in business or domain behavior, stated in the domain's own language (e.g. "refunds are now allowed up to 60 days after purchase, was 30"), linked to the code that implements it.
_Avoid_: Feature, behavior change (too broad — a Domain Change is specifically about business rules)

**Description Gap**:
A **Domain Change** present in the code but absent from the **Pull Request** title or description. Surfaced with suggested wording the author can add.

**Scope**:
How a **Step** relates to the **Intent**: **Requested** (directly fulfills it), **Supporting** (needed to deliver a requested change, e.g. a migration), or **Unrequested** (goes beyond or differs from what was asked). Unrequested Steps are always visually distinct.
_Avoid_: Scope creep (that's one cause of Unrequested), drift

**Risk**:
How dangerous a **Step** is to get wrong — low, elevated, or critical — based on what it touches (auth, payments, migrations, deletions, concurrency, public APIs), its blast radius across **Connections**, and **Findings**. Critical and elevated Steps carry a distinct visual treatment wherever they appear.
_Avoid_: Severity (that's for Findings), priority

**Structural Change** / **Behavioral Change**:
Every change fragment is one or the other. Structural changes (rename, move, extract, formatting) alter shape without altering behavior; when mechanically verified equivalent they are collapsed. Behavioral changes alter what the code does.
_Avoid_: Refactor (informal), cosmetic change

### Walkthrough

**Walkthrough**:
An ordered sequence of **Steps** that covers every changed line of a **Change Set** exactly once, arranged so each Step builds only on what came before it.
_Avoid_: Tour, file list

**Step**:
One logical unit of a **Walkthrough**: a group of change fragments (possibly split from a single hunk) addressing one concern, with a short narrative tied to the **Intent**. Tests belong to the Step whose behavior they verify.
_Avoid_: Section, hunk, file

**Layer**:
The architectural tier a **Step** lives in — data model, backend logic, API surface, client data, presentation, or chores (config, tooling, dependencies). Layers order Steps when dependencies don't.
_Avoid_: Tier, category

**Chapter**:
A group of **Steps** forming one independent feature slice, used only when a **Change Set** contains more than one feature.
_Avoid_: Part, section

**Sitting**:
A contiguous run of **Steps** sized for one focused review session (~300–400 changed lines, ~45 minutes), cut at Step boundaries. Progress is tracked per Sitting.
_Avoid_: Session, chunk, batch (a Batch is a group of Asks)

## Example dialogue

> **Dev:** The agent finished the refunds work — I opened a **Review** on the branch. It took a **Snapshot** since I hadn't committed.
>
> **Domain expert:** What does the **Change Brief** say changed for customers?
>
> **Dev:** Two **Domain Changes**: refunds allowed up to 60 days (was 30), and partial refunds on shipped orders. But the second one isn't in the PR description — it's flagged as a **Description Gap**. And there's an **Unrequested** **Step**: the agent also changed how the audit log is written.
>
> **Domain expert:** That audit change worries me. Is it risky?
>
> **Dev:** It's marked critical **Risk**, and the **Connections** panel shows `refundOrder` no longer calls `auditLog()`. I left a **Change Request** **Ask** on it — "restore the audit call" — plus a **Question** on the 60-day boundary check, and submitted both as one **Batch**.
>
> **Domain expert:** So the code's already fixed?
>
> **Dev:** Not yet — the Change Request produces a **Revision**. I'll review that as its own Change Set, accept it, and it becomes the next **Iteration**. Then I only read the **Interdiff**. I also added an **Invariant** to my **Scratchpad** — "refunded total never exceeds paid total" — and asked the agent to check it holds across Head.
