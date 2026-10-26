// Typed judgments (ADR 0005, engineering plan §8.7): small pick-one, yes/no
// and graded questions that need neither generated text nor tools.

import type { JudgeBackendName } from "@legible/domain"

export type Judgment =
  | {
      kind: "choice"
      name: string
      instructions: string
      options: { value: string; description: string }[]
    }
  | { kind: "predicate"; name: string; instructions: string }
  | {
      kind: "score"
      name: string
      instructions: string
      /** 2–10 ordered levels, lowest first. */
      levels: string[]
    }

export type JudgeAnswer =
  | {
      kind: "choice"
      name: string
      choice: string
      probabilities: Record<string, number>
      confidence: number
    }
  | { kind: "predicate"; name: string; probability: number }
  | {
      kind: "score"
      name: string
      /** Probability-weighted level index; can fall between levels. */
      score: number
      confidence: number
    }
  | { kind: "refusal"; name: string }

export interface JudgeRequest {
  /**
   * The shared evidence every judgment is about: a Change Set, a Step, an
   * Intent. Put first so it's the cached prefix. Untrusted: it's wrapped as
   * data before it reaches a model.
   */
  input: string
  judgments: Judgment[]
}

export type BackendName = JudgeBackendName | "fast"

export interface JudgeResult {
  /** In request order. */
  answers: JudgeAnswer[]
  backend: BackendName
  model: string
  /** Null when the backend doesn't publish prices. */
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  /** Set when the preferred backend failed and another answered. */
  fallbackReason: string | null
}

export interface JudgeBackend {
  readonly name: BackendName
  readonly model: string
  judge(req: JudgeRequest, opts: { signal: AbortSignal }): Promise<JudgeResult>
}

export class JudgeError extends Error {
  constructor(
    message: string,
    readonly code: "auth" | "http" | "invalid" | "aborted",
  ) {
    super(message)
    this.name = "JudgeError"
  }
}

export type Fetch = typeof fetch
