// The two external backends: TypeSafe's Jev and OpenAI's Decisions API. Both
// are off by default; Settings show exactly what each one receives.

import {
  type Fetch,
  type JudgeAnswer,
  type JudgeBackend,
  JudgeError,
  type JudgeRequest,
  type JudgeResult,
  type Judgment,
} from "./types"

/** Waits before each retry of a 429 or 5xx, unless Retry-After says otherwise. */
const RETRY_DELAYS_MS = [1_000, 4_000]
/** A longer Retry-After isn't worth waiting for: the fast tier answers instead. */
const MAX_RETRY_WAIT_MS = 20_000

async function post(
  fetchImpl: Fetch,
  url: string,
  apiKey: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
  service: string,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        signal,
      })
    } catch (e) {
      if (signal.aborted) throw new JudgeError("Cancelled", "aborted")
      throw new JudgeError(
        `Couldn't reach ${service}: ${(e as Error).message}`,
        "http",
      )
    }
    if (res.status === 401 || res.status === 403)
      throw new JudgeError(`${service} rejected the API key.`, "auth")
    if (res.ok) return res.json()
    const delay = retryDelay(res, attempt)
    if (delay === null) {
      const text = (await res.text().catch(() => "")).slice(0, 300)
      const tries = attempt ? ` after ${attempt + 1} tries` : ""
      throw new JudgeError(
        `${service} answered ${res.status}${tries}: ${text}`,
        "http",
      )
    }
    await res.body?.cancel().catch(() => {})
    await wait(delay, signal)
  }
}

/**
 * How long to wait before trying again, or null to give up. Only 429 and 5xx
 * are retried, once per entry in RETRY_DELAYS_MS. Retry-After, in seconds or
 * as a date, replaces the backoff when it's present.
 */
function retryDelay(res: Response, attempt: number): number | null {
  if (res.status !== 429 && res.status < 500) return null
  const backoff = RETRY_DELAYS_MS[attempt]
  if (backoff === undefined) return null
  const header = res.headers.get("retry-after")?.trim()
  if (!header) return backoff
  const seconds = Number(header)
  const ms = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(header) - Date.now()
  if (Number.isNaN(ms)) return backoff
  if (ms > MAX_RETRY_WAIT_MS) return null
  return Math.max(0, ms)
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(new JudgeError("Cancelled", "aborted"))
    if (signal.aborted) return cancelled()
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop)
      resolve()
    }, ms)
    const stop = () => {
      clearTimeout(timer)
      cancelled()
    }
    signal.addEventListener("abort", stop, { once: true })
  })
}

/**
 * An answer missing a number, or with one out of range, is a refusal: read as
 * 0 it would be a confident "no".
 */
function sane(j: Judgment, a: JudgeAnswer): JudgeAnswer {
  const p = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1
  const ok =
    a.kind === "refusal" ||
    (a.kind === "predicate" && p(a.probability)) ||
    (a.kind === "choice" &&
      j.kind === "choice" &&
      j.options.some((o) => o.value === a.choice) &&
      p(a.confidence)) ||
    (a.kind === "score" && Number.isFinite(a.score) && p(a.confidence))
  return ok ? a : { kind: "refusal", name: j.name }
}

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : Number.NaN

/** Rough token count, for choosing Jev's long-context mode. */
const tokens = (s: string) => Math.ceil(s.length / 4)

// ---- TypeSafe Jev ------------------------------------------------------------

export const JEV_URL = "https://api.typesafe.ai/v1/systemone"

/**
 * TypeSafe Jev. Questions are keyed by name; Noul answers yes/no, Choice
 * picks one of up to 255 criteria, Score grades on up to 10 ordered levels.
 * Jev publishes no price, so runs record no cost.
 */
export class JevBackend implements JudgeBackend {
  readonly name = "jev" as const

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async judge(
    req: JudgeRequest,
    opts: { signal: AbortSignal },
  ): Promise<JudgeResult> {
    const questions: Record<string, unknown> = {}
    for (const j of req.judgments) {
      questions[j.name] =
        j.kind === "predicate"
          ? { type: "noul", instructions: j.instructions }
          : j.kind === "choice"
            ? {
                type: "choice",
                instructions: j.instructions,
                criteria: Object.fromEntries(
                  j.options.map((o) => [o.value, o.description]),
                ),
              }
            : {
                type: "score",
                instructions: j.instructions,
                criteria: j.levels,
              }
    }
    // A request holds 64k tokens, 32k for the state plus the longest question; past that, long-context mode.
    const longest = Math.max(
      ...req.judgments.map((j) => tokens(JSON.stringify(j))),
    )
    const long = tokens(req.input) + longest > 30_000
    const raw = (await post(
      this.fetchImpl,
      JEV_URL,
      this.apiKey,
      { model: this.model, state: req.input, questions },
      long ? { "TypeSafe-Danger-Zone-Long-Context": "true" } : {},
      opts.signal,
      "TypeSafe",
    )) as {
      model?: string
      answers?: Record<string, Record<string, unknown>>
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const answers = req.judgments.map((j): JudgeAnswer => {
      const a = raw.answers?.[j.name]
      if (!a || a.type === "refusal") return { kind: "refusal", name: j.name }
      if (j.kind === "predicate")
        return { kind: "predicate", name: j.name, probability: num(a.noul) }
      if (j.kind === "choice") {
        const probabilities = (a.probabilities ?? {}) as Record<string, number>
        return {
          kind: "choice",
          name: j.name,
          choice: typeof a.choice === "string" ? a.choice : "",
          probabilities,
          confidence: num(a.confidence),
        }
      }
      return {
        kind: "score",
        name: j.name,
        score: num(a.score),
        confidence: num(a.confidence),
      }
    })
    return {
      answers: answers.map((a, i) => sane(req.judgments[i] as Judgment, a)),
      backend: this.name,
      model: raw.model ?? this.model,
      costUsd: null,
      inputTokens: num(raw.usage?.input_tokens) || 0,
      outputTokens: num(raw.usage?.output_tokens) || 0,
      fallbackReason: null,
    }
  }
}

// ---- OpenAI Decisions --------------------------------------------------------

export const DECISIONS_MODEL = "gpt-6-luna"
/** USD per million input tokens; output is free. */
const DECISIONS_INPUT_PRICE = 0.1
/** Questions per request. */
const DECISIONS_MAX_QUESTIONS = 400

/** OpenAI's Decisions API: predicate, choice and score questions over one input. */
export class DecisionsBackend implements JudgeBackend {
  readonly name = "decisions" as const
  readonly model = DECISIONS_MODEL

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseURL = "https://api.openai.com/v1",
  ) {}

  async judge(
    req: JudgeRequest,
    opts: { signal: AbortSignal },
  ): Promise<JudgeResult> {
    const answers: JudgeAnswer[] = []
    let inputTokens = 0
    let outputTokens = 0
    for (let i = 0; i < req.judgments.length; i += DECISIONS_MAX_QUESTIONS) {
      const batch = req.judgments.slice(i, i + DECISIONS_MAX_QUESTIONS)
      const raw = (await post(
        this.fetchImpl,
        `${this.baseURL}/decisions`,
        this.apiKey,
        {
          model: this.model,
          input: req.input,
          questions: batch.map((j) =>
            j.kind === "predicate"
              ? {
                  type: "predicate",
                  name: j.name,
                  instructions: j.instructions,
                }
              : j.kind === "choice"
                ? {
                    type: "choice",
                    name: j.name,
                    instructions: j.instructions,
                    choices: j.options,
                  }
                : {
                    type: "score",
                    name: j.name,
                    instructions: j.instructions,
                    levels: j.levels.map((label) => ({ label })),
                  },
          ),
        },
        {},
        opts.signal,
        "OpenAI Decisions",
      )) as {
        answers?: Record<string, unknown>[]
        usage?: { input_tokens?: number; output_tokens?: number }
      }
      inputTokens += num(raw.usage?.input_tokens) || 0
      outputTokens += num(raw.usage?.output_tokens) || 0
      const byName = new Map((raw.answers ?? []).map((a) => [a.name, a]))
      for (const j of batch) {
        const a = byName.get(j.name)
        if (!a || a.type === "refusal") {
          answers.push({ kind: "refusal", name: j.name })
        } else if (j.kind === "predicate") {
          answers.push({
            kind: "predicate",
            name: j.name,
            probability: num(a.probability),
          })
        } else if (j.kind === "choice") {
          const probabilities: Record<string, number> = {}
          for (const p of (a.probabilities ?? []) as {
            value?: unknown
            probability?: unknown
          }[])
            probabilities[String(p.value)] = num(p.probability) || 0
          answers.push({
            kind: "choice",
            name: j.name,
            choice: typeof a.choice === "string" ? a.choice : "",
            probabilities,
            confidence: num(a.confidence),
          })
        } else {
          answers.push({
            kind: "score",
            name: j.name,
            score: num(a.score),
            confidence: num(a.confidence),
          })
        }
      }
    }
    return {
      answers: answers.map((a, i) => sane(req.judgments[i] as Judgment, a)),
      backend: this.name,
      model: this.model,
      costUsd: (inputTokens * DECISIONS_INPUT_PRICE) / 1e6,
      inputTokens,
      outputTokens,
      fallbackReason: null,
    }
  }
}
