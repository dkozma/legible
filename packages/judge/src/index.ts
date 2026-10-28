// The Judge: one interface for typed judgments, answered by the first enabled
// external backend (TypeSafe Jev, OpenAI Decisions) or by the fast tier.
// Pipelines never know which backend answered (ADR 0005).

import { createHash } from "node:crypto"

import type {
  BackendName,
  JudgeAnswer,
  JudgeBackend,
  JudgeRequest,
  JudgeResult,
} from "./types"

export {
  FastTierBackend,
  JUDGE_PROMPT_VERSION,
  JUDGE_SYSTEM,
  judgeTask,
  judgmentSchema,
  type RunTask,
} from "./fast"
export { DECISIONS_MODEL, DecisionsBackend, JEV_URL, JevBackend } from "./http"
export * from "./types"

const LABEL: Record<BackendName, string> = {
  jev: "TypeSafe",
  decisions: "OpenAI Decisions",
  fast: "The fast tier",
}

export class Judge {
  /**
   * @param backends external backends in the user's order of preference
   * @param fallback the fast tier, used when none is enabled or all fail
   */
  constructor(
    private readonly backends: JudgeBackend[],
    private readonly fallback: JudgeBackend,
  ) {}

  /** The backend that will be asked first. */
  get preferred(): JudgeBackend {
    return this.backends[0] ?? this.fallback
  }

  async judge(
    req: JudgeRequest,
    opts: { signal: AbortSignal },
  ): Promise<JudgeResult> {
    const names = new Set(req.judgments.map((j) => j.name))
    if (names.size !== req.judgments.length)
      throw new Error("Judgment names must be unique within a request")
    if (req.judgments.length === 0)
      return {
        answers: [],
        backend: this.preferred.name,
        model: this.preferred.model,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        fallbackReason: null,
      }
    const failures: string[] = []
    for (const b of this.backends) {
      try {
        const r = await b.judge(req, opts)
        return { ...r, fallbackReason: failures.join("; ") || null }
      } catch (e) {
        if (opts.signal.aborted) throw e
        failures.push(`${LABEL[b.name]} failed (${(e as Error).message})`)
      }
    }
    const r = await this.fallback.judge(req, opts)
    const reason = [
      ...failures,
      ...(r.fallbackReason ? [r.fallbackReason] : []),
    ]
    return {
      ...r,
      fallbackReason: reason.length
        ? `${reason.join("; ")}, so ${LABEL.fast.toLowerCase()} judged.`
        : null,
    }
  }
}

/** Cache key: the input, the judgments, and who answers them. */
export function judgeCacheKey(
  req: JudgeRequest,
  backend: BackendName,
  model: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify([req.input, req.judgments, backend, model]))
    .digest("hex")
}

// ---- Judgment catalog --------------------------------------------------------

export type BelowThreshold =
  /** Show the answer as "likely …". */
  | "likely"
  /** Ask an agent with tools instead. */
  | "escalate"
  /** Use the deterministic fallback. */
  | "fallback"
  /** Treat as yes (fail open). */
  | "include"

export interface CatalogEntry {
  usedBy: string
  belowThreshold: BelowThreshold
  /**
   * Minimum confidence per backend. Untuned: these are starting values until
   * Judge evals set them (evals/README.md). The fast tier's self-reported
   * confidence runs high, so its bar is higher.
   */
  thresholds: Record<BackendName, number>
}

const START: Record<BackendName, number> = {
  jev: 0.7,
  decisions: 0.7,
  fast: 0.8,
}

/** The v1 judgment catalog (engineering plan §8.7). */
export const JUDGMENT_CATALOG = {
  "step-scope": {
    usedBy: "Walkthrough Scope",
    belowThreshold: "likely",
    thresholds: START,
  },
  "requirement-covered": {
    usedBy: "Change Brief",
    belowThreshold: "escalate",
    thresholds: START,
  },
  "description-states-domain-change": {
    usedBy: "Description Gap",
    belowThreshold: "likely",
    thresholds: START,
  },
  "risk-signal": {
    usedBy: "Risk",
    belowThreshold: "fallback",
    thresholds: START,
  },
  "lens-applies": {
    usedBy: "Review Plan (M5)",
    belowThreshold: "include",
    thresholds: START,
  },
  "remote-comment-addressed": {
    usedBy: "Remote Comments (M4)",
    belowThreshold: "fallback",
    thresholds: START,
  },
  "fragment-layer": {
    usedBy: "Walkthrough planner hints",
    belowThreshold: "fallback",
    thresholds: START,
  },
  "test-subject": {
    usedBy: "Walkthrough planner",
    belowThreshold: "fallback",
    thresholds: START,
  },
  "findings-duplicate": {
    usedBy: "Agent Review dedupe (M5)",
    belowThreshold: "fallback",
    thresholds: START,
  },
  "domain-impact": {
    usedBy: "Sorting (M5)",
    belowThreshold: "fallback",
    thresholds: START,
  },
  "anchor-relocation": {
    usedBy: "Anchoring (M4)",
    belowThreshold: "fallback",
    thresholds: START,
  },
  "transcript-match": {
    usedBy: "Intent",
    belowThreshold: "likely",
    thresholds: START,
  },
  "ask-kind": {
    usedBy: "Ask composer (M4)",
    belowThreshold: "likely",
    thresholds: START,
  },
  "resolve-call-site": {
    usedBy: "Indexer (M5)",
    belowThreshold: "fallback",
    thresholds: START,
  },
} as const satisfies Record<string, CatalogEntry>

export type JudgmentName = keyof typeof JUDGMENT_CATALOG

/** How sure an answer is: a choice's or score's confidence, a predicate's distance from a coin flip. */
export function certainty(a: JudgeAnswer): number {
  if (a.kind === "refusal") return 0
  if (a.kind === "predicate") return Math.max(a.probability, 1 - a.probability)
  return a.confidence
}

/** Whether an answer clears its judgment's threshold for the backend that gave it. */
export function confident(
  judgment: JudgmentName,
  a: JudgeAnswer,
  backend: BackendName,
): boolean {
  return certainty(a) >= JUDGMENT_CATALOG[judgment].thresholds[backend]
}
