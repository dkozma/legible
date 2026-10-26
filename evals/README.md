# Evals

Labeled Change Sets, and a harness that runs them through Legible's real pipelines: the indexer and Fragment graph, the Walkthrough planner and validator, Scope and Risk through the Judge, and Domain Changes (engineering plan §14).

```sh
pnpm evals                                   # every case, deterministic fake runtime (no model, no network)
EVAL_RUNTIME=claude pnpm evals               # Claude: your `claude` login, or ANTHROPIC_API_KEY
EVAL_RUNTIME=openai pnpm evals               # OpenAI: OPENAI_API_KEY
EVAL_RUNTIME=claude EVAL_MODEL=claude-haiku-5-5 pnpm evals   # one model for every tier
EVAL_JUDGE=jev pnpm evals                    # judgments on TypeSafe (TYPESAFE_API_KEY, EVAL_JEV_MODEL)
EVAL_JUDGE=decisions pnpm evals              # judgments on OpenAI Decisions (OPENAI_API_KEY)
EVAL_CASE=refunds-ts pnpm evals              # one case
EVAL_BUDGET_USD=1 pnpm evals                 # spend cap per case (default $2)
```

Each run prints a table and writes `results/<date>-<runtime>.{json,md}`. Commit the results of runs that change a prompt version, a model's status in the catalog, or a Judge threshold.

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
