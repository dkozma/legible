# Typed judgments go through a pluggable Judge, not ad-hoc LLM calls

Many pipeline steps don't need generated text. They need a typed judgment over options we already have: which **Scope** a Step has, whether a **Domain Change** appears in the PR description, which conditional **Lenses** apply, whether two **Findings** are duplicates, which candidate a call site resolves to. All of these go through one `Judge` interface. A judgment is a choice, a predicate (yes/no), or a score, and it returns a probability or a confidence. Three backends implement it:

1. **TypeSafe Jev** (optional; the user's TypeSafe key)
2. **OpenAI Decisions API** (optional; the user's OpenAI key; `POST /v1/decisions`)
3. **Claude with structured output** (always available; fast tier, self-reported confidence)

System One–style judgment models are faster, cheaper, and better calibrated for this shape of work than a general LLM. But both are hosted services needing separate keys, so Legible can't depend on either. Claude is always the fallback, and pipelines never know which backend answered.

## Consequences

- A Claude-powered app sends code to non-Anthropic services when the user enables them. Each backend is off by default, and Settings and the README name exactly what is sent and where.
- Confidence thresholds are per judgment *and* per backend, tuned on the eval set. One backend's probabilities aren't assumed to mean the same as another's.
- Judgments that need multi-step investigation with tools (Lenses, Verification, Scenario traces, Invariant checks) or that produce text (Explanations, narratives, Domain Change wording, Revisions) stay with Claude.
