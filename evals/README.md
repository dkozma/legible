# Evals

Labeled Change Sets, and a harness that runs them through Legible's real pipelines: the indexer and Fragment graph, the Walkthrough planner and validator, Scope and Risk through the Judge, and Domain Changes (engineering plan §14).

```sh
pnpm evals                                   # every case, deterministic fake runtime (no model, no network)
EVAL_RUNTIME=claude pnpm evals               # Claude: ANTHROPIC_API_KEY, or your `claude` login without one
EVAL_RUNTIME=openai pnpm evals               # OpenAI: OPENAI_API_KEY
EVAL_RUNTIME=claude EVAL_MODEL=claude-haiku-5-5 pnpm evals         # one model for every tier
EVAL_RUNTIME=claude EVAL_JUDGE=jev pnpm evals        # judgments on TypeSafe (TYPESAFE_API_KEY, EVAL_JEV_MODEL)
EVAL_RUNTIME=claude EVAL_JUDGE=decisions pnpm evals  # judgments on OpenAI Decisions (OPENAI_API_KEY)
EVAL_CASE=refunds-ts pnpm evals              # one case
EVAL_RUNTIME=claude EVAL_BUDGET_USD=1 pnpm evals     # spend cap per case (default $2)
```

Keys come from your shell or the repository's `.env`; the shell wins. With `ANTHROPIC_API_KEY` in `.env`, Claude runs bill that key, not your `claude` login. `EVAL_JUDGE` and `EVAL_MODEL` need a model runtime: the fake runtime answers every judgment itself. A Judge backend still uses the runtime for the Walkthrough and for its fast-tier fallback. The run stops before any case if a setting would be ignored or a key is missing.

Each run prints a table and writes `results/<date>-<runtime>-<model>[-<judge>].{json,md}`, for example `2026-10-28-claude-defaults-jev.md`. The table doesn't say which Judge backend answered; `judgeBackend` in the JSON does, and starts with `fast:` when an external backend failed and the fast tier stood in; `judgeFallback` says why. Commit the results of runs that change a prompt version, a model's status in the catalog, or a Judge threshold.

## What's measured

| Metric | Meaning | Target |
|---|---|---|
| Coverage | Fragments in exactly one Step | 100%, always (the validator guarantees it) |
| Dependency violations | A Step using what a later Step changes, outside a cycle | 0, always |
| Grouping F1 | Pairs of labeled Fragments that share a Step in the labels and in the Walkthrough | — |
| Layers | Labeled paths whose Step has the labeled Layer | — |
| Unrequested recall / precision | Labeled Unrequested Fragments in Steps judged Unrequested | agreed after the first live run |
| Domain Change recall / precision | Labeled Domain Changes found, matched by content words (≥ 50% overlap) | — |
| Chapters | Chapters only when the labels say there are several features | — |
| Cost per 1k changed lines | Spend across the run | — |

`evals/test/harness.test.ts` runs every case on the fake runtime as part of `pnpm test`, so the coverage and dependency guarantees are checked in CI. The fake baseline groups by file, judges every Step Requested and finds no Domain Changes: it measures the harness, not a model.

**Model status.** A model is marked `recommended` in `packages/agent-runtime/src/catalog.ts` only after a live run here meets its tier's targets. Every OpenAI model starts `experimental`.

**Judge thresholds.** `JUDGMENT_CATALOG` in `packages/judge/src/index.ts` starts every backend at a fixed confidence threshold. Tune them per backend from runs with `EVAL_JUDGE`.

## Cases

Six synthetic cases so far, all small, in TypeScript, Python, Go, Rust and Java. Real agent-written Change Sets with hand labels come next; the M3 exit criterion asks for at least 20.

| Case | What it exercises |
|---|---|
| `refunds-ts` | The M0 refund fixture: six Layers, an Unrequested audit change, a moved helper, formatting-only and lockfile changes, an uncommitted test |
| `inventory-py` | A small feature through model, service, API and tests; an Unrequested cap on restocking |
| `ratelimit-go` | A rewrite inside one file plus its config; an unasked-for default change in the same lines |
| `two-features-ts` | Two independent features: the Walkthrough should have two Chapters |
| `ports-rs` | A new error variant and parser, and the code that uses them |
| `discounts-java` | A rule change whose scope quietly widens (discounts now apply to shipping) |

### Adding a case

Make `cases/<name>/` with:

- `case.json`: `description`, `intent` (`goal`, `requirements`), an optional `pullRequest` (`title`, `body`), `deleted` paths, and `labels`.
- `base/`: every file on Base. `head/`: only files added or changed on Head.

Labels point at code by path, optionally narrowed to Head lines (`"src/a.ts@12-20"`) or Base lines (`"src/a.ts@b4-9"`). A label matches every Fragment it overlaps. Label each Step's code as one list in `steps`; leave out code whose grouping doesn't matter. Put Unrequested labels only on code that is Unrequested as a whole: a Fragment can't be half Requested.

To label a real Pull Request, check it out as `base/` and `head/` (or write a `generator` script like `fixtures/make-refund-repo.mjs`), and keep anything private out of the repository.

## Connections eval (SCIP)

```sh
pnpm evals:connections                       # the shared corpus; writes results/<date>-connections-typescript.{md,json}
EVAL_LABEL=after-locals pnpm evals:connections   # …-connections-typescript-after-locals.{md,json}, beside the baseline
EVAL_CORPUS=hono pnpm evals:connections      # one corpus entry
EVAL_REPO=~/src/app pnpm evals:connections   # local mode: any repository of yours
EVAL_REPO=~/src/app EVAL_COMMITS=40 EVAL_INSTALL="npm ci --ignore-scripts" pnpm evals:connections
```

Scores Connections against [SCIP](https://github.com/sourcegraph/scip): `scip-typescript` runs the TypeScript type checker over each commit and records what every name refers to. That gives every use in a changed file a correct answer to score `CodeIndex` against. It measures the resolver, not a model, so it needs no keys, but it does need installed dependencies and network access: it runs on demand, not in `pnpm evals`, `pnpm test` or CI. TypeScript only for now; Python and Go would use the same harness with another indexer.

For each commit and its parent, the eval builds the Change Set and `CodeIndex` the way `pnpm evals` does, and compares each use our outline finds in the changed files (`connectionsOn`, `at()`; not the `imports` kind, whose sites have no column) with SCIP at the same position. SCIP says one of:

| SCIP | Meaning | Right answer |
|---|---|---|
| local | a local variable, parameter or type parameter defined in that file | no Connection, unless it's a local function we also index as a Symbol |
| repo | defined in the repository | the Symbol whose name is at that definition, at one related by implementation (a constructor counts as its class), or where SCIP says the name is that symbol |
| external | no definition in the index (`lib.d.ts`, `node_modules`) | `external` |
| declaration | the name is being declared here | no Connection |
| unknown | no occurrence at that position | not scored |

| Metric | Meaning |
|---|---|
| Precision per status | Uses where our target is SCIP's, per ConnectionStatus that appears (`resolved`, `likely`, any new one), and per the outline's reference kind (`calls`, `read`, `references`, `implements`). For `ambiguous`: SCIP's target is a candidate. For `external`: SCIP has no definition either. |
| Connections on locals | Pattern A: any Connection, `external` included, made on a parameter or local, other than to the local's own Symbol |
| Wrongly external | Uses we marked external that SCIP resolves in the repository |
| Recall, indexed / all files | SCIP's uses of definitions we have a Symbol for, where we connected to that Symbol: counting definitions in files we indexed (the resolver), and in every file (what the neighbor limit costs) |
| Used by | For each changed Symbol: our Used by sites that SCIP confirms (precision, per status), and SCIP's references we list (recall) |

The report ends with the 20 most frequent false positives per bucket (each status with one target, Used by, wrongly external, locals) as `path:line name → ours vs SCIP`: what resolver changes are tuned on.

**Corpus.** `corpus/connections.json`: this repository's TypeScript commits (by sha), and the latest 30 non-merge TypeScript commits of [honojs/hono](https://github.com/honojs/hono) at a pinned revision (MIT; `tsc -p tsconfig.spec.json` passes; a simple pnpm workspace). Each entry has `source` (`"self"` or `{ url, rev }`), `commits` (a count or shas), `install`, `perCommitInstall` and optional `projects` (tsconfig files to index). This repository installs per commit, so `@legible/*` links point into that commit's packages; hono installs once at the pinned revision and links `node_modules` into each worktree. Install scripts are skipped: SCIP needs types, not binaries.

**Cache.** `evals/.cache/` (ignored by git): clones, a detached worktree per commit while it's indexed, and the SCIP indexes, by commit and scip-typescript version. A commit that fails to index is skipped and the report says why. Delete `evals/.cache/connections/<entry>/` to rebuild one entry.

**Local mode.** `EVAL_REPO=<path>` scores the latest `EVAL_COMMITS` (default 20) TypeScript commits of any repository on your machine, running `EVAL_INSTALL` once at its HEAD and linking `node_modules` in. Results go to `evals/.cache/results/` and are never committed.

**Time.** The first run of the shared corpus took about 9 minutes on a Mac with a warm pnpm store: 15 Legible commits and 30 hono commits, about 60 SCIP indexes at 7–12 s each, plus a `pnpm install` per Legible commit. A cached run takes about 25 s, all of it building Change Sets and scoring. Every scored use and Used by site also goes to `evals/.cache/sites/<result>.jsonl`, for digging past the examples.

**Checked by hand** (baseline, 2026-10-28): 10 sites scored correct and 10 scored as false positives, sampled at random, read against the code. All 10 correct ones were right. Nine false positives were real. Five were names bound in a function resolved to a same-named Symbol elsewhere in the file: locals in other test scopes (`middleware1`, `fnElement`), a destructured parameter (`on`), a shorthand property naming a local (`getContent`), and a type parameter `T` (`likely` to an unrelated `type T`). Four were guesses by name (`likely`): `.execute()` on a Kysely builder → `OpenAIAgentsRuntime.run.execute`, `opts.onEvent` → an unrelated object property, `this.emit` (a constructor parameter property) → a local `emit` in the indexer, and a destructured `onRetry` prop → `Props.onRetry`. The tenth (`let match` declared, then `match = () => …` assigned where our Symbol is) was a scoring artifact, fixed by also accepting a Symbol whose name SCIP says is the same symbol. Patterns A–C are all among the examples: A in `locals`, B in `likely`, C in `used by` (`FastTierBackend.judge` used by a call SCIP resolves to `JevBackend#judge()`). Plain calls to a top-level function in the same file score 98.6% `resolved` precision (3,468 of 3,516).

Alignment rules learned in the spike, which `score.ts` encodes: scip-typescript writes parameters as global symbols (`render().(format)`) and writes `local N` for names it reaches inside a `.d.ts` (zod's `z.enum`), so a local counts only when the document defines it; `new Order()` refers to the constructor, which counts as its class; overloads share one symbol, defined at the first signature; positions are UTF-16, like ours (`position_encoding` is unspecified). A member use of a constructor's parameter property (`this.fetchImpl` for `private fetchImpl`) names the parameter in SCIP; it isn't a local, and we have no Symbol for it, so it's not scored.

Commit a new result whenever a resolver change lands, with `EVAL_LABEL` naming the change.
