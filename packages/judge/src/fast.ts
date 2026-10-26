// The fallback backend: the fast tier's model answers every judgment in one
// structured-output run, with a self-reported confidence. Always available.

import {
  type AgentResult,
  type AgentTask,
  type ToolContext,
  UNTRUSTED_RULE,
  untrusted,
} from "@legible/agent-runtime"
import { z } from "zod"

import type {
  JudgeAnswer,
  JudgeBackend,
  JudgeRequest,
  JudgeResult,
  Judgment,
} from "./types"

export const JUDGE_PROMPT_VERSION = "judge-v1"

/** Judgments per run, so the output schema stays small. */
const PER_RUN = 40

export const JUDGE_SYSTEM = `You answer typed questions about evidence from a code review: a Change Set, its Intent, or its Steps. Answer every question in the required structure.

- A yes/no question: "answer" is true or false.
- A choice: "choice" is exactly one of the listed values.
- A graded question: "level" is the index of the level, 0 for the first.
- "confidence" is your probability, from 0 to 1, that the answer is right. Be calibrated: 0.5 means a coin flip.

Judge only from the evidence. When it doesn't settle a question, give your best answer with a low confidence.

${UNTRUSTED_RULE}`

const confidence = z
  .number()
  .describe("Probability from 0 to 1 that this answer is right")

function fieldFor(j: Judgment) {
  if (j.kind === "predicate")
    return z.object({ answer: z.boolean(), confidence })
  if (j.kind === "choice")
    return z.object({
      choice: z.enum(j.options.map((o) => o.value) as [string, ...string[]]),
      confidence,
    })
  return z.object({
    level: z
      .number()
      .int()
      .describe(`0 to ${j.levels.length - 1}, an index into the levels`),
    confidence,
  })
}

export function judgmentSchema(judgments: Judgment[]) {
  return z.object(
    Object.fromEntries(judgments.map((j, i) => [`q${i + 1}`, fieldFor(j)])),
  )
}

function describe(j: Judgment, key: string): string {
  if (j.kind === "predicate") return `${key} (yes/no): ${j.instructions}`
  if (j.kind === "choice")
    return `${key} (choice): ${j.instructions}\n${j.options.map((o) => `  - ${o.value}: ${o.description}`).join("\n")}`
  return `${key} (graded): ${j.instructions}\n${j.levels.map((l, i) => `  ${i}: ${l}`).join("\n")}`
}

export function judgeTask(
  req: JudgeRequest,
  context: ToolContext,
): AgentTask<Record<string, Record<string, unknown>>> {
  return {
    kind: "judgment",
    modelTier: "fast",
    system: JUDGE_SYSTEM,
    // The evidence goes first so repeated judgments over it share a cached prefix.
    prompt: `${untrusted("evidence", req.input)}\n\nQuestions:\n${req.judgments.map((j, i) => describe(j, `q${i + 1}`)).join("\n\n")}`,
    tools: [],
    access: "read-only",
    output: judgmentSchema(req.judgments),
    context,
    maxTurns: 2,
    effort: "low",
  }
}

const clamp = (n: unknown) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0

function toAnswer(j: Judgment, raw: Record<string, unknown> | undefined) {
  if (!raw) return { kind: "refusal", name: j.name } satisfies JudgeAnswer
  const c = clamp(raw.confidence)
  if (j.kind === "predicate")
    return {
      kind: "predicate",
      name: j.name,
      probability: raw.answer === true ? c : 1 - c,
    } satisfies JudgeAnswer
  if (j.kind === "choice") {
    const choice = String(raw.choice)
    const rest = (1 - c) / Math.max(1, j.options.length - 1)
    return {
      kind: "choice",
      name: j.name,
      choice,
      probabilities: Object.fromEntries(
        j.options.map((o) => [o.value, o.value === choice ? c : rest]),
      ),
      confidence: c,
    } satisfies JudgeAnswer
  }
  const level = Math.min(
    j.levels.length - 1,
    Math.max(0, Math.round(Number(raw.level) || 0)),
  )
  return {
    kind: "score",
    name: j.name,
    score: level,
    confidence: c,
  } satisfies JudgeAnswer
}

export type RunTask = <T>(
  task: AgentTask<T>,
) => Promise<AgentResult<T> & { fallbackReason: string | null }>

export class FastTierBackend implements JudgeBackend {
  readonly name = "fast" as const
  model = "fast tier"

  constructor(
    private readonly run: RunTask,
    private readonly context: ToolContext,
  ) {}

  async judge(req: JudgeRequest): Promise<JudgeResult> {
    const answers: JudgeAnswer[] = []
    let costUsd = 0
    let inputTokens = 0
    let outputTokens = 0
    let fallbackReason: string | null = null
    for (let i = 0; i < req.judgments.length; i += PER_RUN) {
      const batch = req.judgments.slice(i, i + PER_RUN)
      const r = await this.run(
        judgeTask({ input: req.input, judgments: batch }, this.context),
      )
      this.model = r.model
      fallbackReason ??= r.fallbackReason
      costUsd += r.costUsd
      inputTokens += r.inputTokens
      outputTokens += r.outputTokens
      batch.forEach((j, k) =>
        answers.push(toAnswer(j, r.output?.[`q${k + 1}`])),
      )
    }
    return {
      answers,
      backend: this.name,
      model: this.model,
      costUsd,
      inputTokens,
      outputTokens,
      fallbackReason,
    }
  }
}
