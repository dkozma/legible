// The Judge's part of the Change Brief (engineering plan §9.3): Scope per Step
// (`step-scope`), requirements no code implements (`requirement-covered`),
// confirmed Risk areas (`risk-signal`), and Domain Changes the Pull Request
// description leaves out (`description-states-domain-change`).

import {
  confident,
  type BackendName,
  type JudgeAnswer,
  type JudgeRequest,
  type Judgment,
} from "@legible/judge"
import type { DomainChange, Intent, Scope, Step } from "@legible/domain"

import type { PlannerFragment } from "../walkthrough/fragments"
import { RISK_AREAS, type RiskArea } from "./risk"

/** Steps as the Judge sees them: numbered, named, with their files and changed Symbols. */
export function describeSteps(
  steps: Step[],
  fragments: Map<string, PlannerFragment>,
): string {
  return steps
    .map((s, i) => {
      const files = [...new Set(s.fragments.map((f) => f.path))].slice(0, 6)
      const symbols = [
        ...new Set(
          s.fragments.flatMap(
            (f) => fragments.get(f.fragmentId)?.symbols ?? [],
          ),
        ),
      ].slice(0, 8)
      return [
        `Step ${i + 1}: ${s.name} (${s.layer}, +${s.additions} −${s.deletions})`,
        s.narrative ? `  ${s.narrative}` : null,
        `  files: ${files.join(", ")}`,
        symbols.length ? `  changes: ${symbols.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    })
    .join("\n")
}

const intentText = (intent: Pick<Intent, "goal" | "requirements">) =>
  `Intent: ${intent.goal}\n${intent.requirements.map((r) => `${r.id}: ${r.statement}`).join("\n")}`

/** One request for Scope, requirement coverage and Risk signals over the same evidence. */
export function understandingRequest(
  intent: Pick<Intent, "goal" | "requirements"> | null,
  steps: Step[],
  fragments: Map<string, PlannerFragment>,
  riskAreas: Map<string, RiskArea[]>,
): JudgeRequest {
  const judgments: Judgment[] = []
  if (intent && intent.requirements.length) {
    steps.forEach((s, i) =>
      judgments.push({
        kind: "choice",
        name: `scope:${s.id}`,
        instructions: `How does Step ${i + 1} ("${s.name}") relate to the Intent? Pick the requirement it directly fulfills; "supporting" if it is needed to deliver a requirement without fulfilling one itself (a migration, a refactor the feature needs, its tests); "unrequested" if it goes beyond or differs from what the Intent asks.`,
        options: [
          ...intent.requirements.map((r) => ({
            value: r.id,
            description: r.statement,
          })),
          {
            value: "supporting",
            description: "Needed to deliver a requirement",
          },
          {
            value: "unrequested",
            description: "Not asked for by the Intent",
          },
        ],
      }),
    )
    for (const r of intent.requirements)
      judgments.push({
        kind: "predicate",
        name: `covered:${r.id}`,
        instructions: `Does any Step implement requirement ${r.id}: "${r.statement}"?`,
      })
  }
  steps.forEach((s, i) => {
    for (const area of riskAreas.get(s.id) ?? [])
      judgments.push({
        kind: "predicate",
        name: `risk:${s.id}:${area}`,
        instructions: `Does Step ${i + 1} ("${s.name}") change ${RISK_AREAS[area].question}?`,
      })
  })
  const evidence = [
    intent ? intentText(intent) : "No Intent.",
    describeSteps(steps, fragments),
  ].join("\n\n")
  return { input: evidence, judgments }
}

export interface UnderstandingJudged {
  scope: Map<
    string,
    { scope: Scope; requirementIds: string[]; likely: boolean }
  >
  uncovered: string[]
  /** Areas the Judge confirmed per Step; unconfirmed detections keep the detector's word. */
  riskAreas: Map<string, RiskArea[]>
}

export function readUnderstanding(
  steps: Step[],
  intent: Pick<Intent, "requirements"> | null,
  detected: Map<string, RiskArea[]>,
  answers: JudgeAnswer[],
  backend: BackendName,
): UnderstandingJudged {
  const by = new Map(answers.map((a) => [a.name, a]))
  const scope = new Map<
    string,
    { scope: Scope; requirementIds: string[]; likely: boolean }
  >()
  for (const s of steps) {
    const a = by.get(`scope:${s.id}`)
    if (!a || a.kind !== "choice") continue
    const sure = confident("step-scope", a, backend)
    const req = intent?.requirements.find((r) => r.id === a.choice)
    scope.set(s.id, {
      scope: req
        ? "requested"
        : a.choice === "supporting"
          ? "supporting"
          : "unrequested",
      requirementIds: req ? [req.id] : [],
      likely: !sure,
    })
  }
  const uncovered: string[] = []
  for (const r of intent?.requirements ?? []) {
    const a = by.get(`covered:${r.id}`)
    // Below threshold the catalog says escalate; until M5's agent check, only a confident "no" counts.
    if (
      a?.kind === "predicate" &&
      a.probability < 0.5 &&
      confident("requirement-covered", a, backend)
    )
      uncovered.push(r.id)
  }
  const riskAreas = new Map<string, RiskArea[]>()
  for (const s of steps) {
    const kept = (detected.get(s.id) ?? []).filter((area) => {
      const a = by.get(`risk:${s.id}:${area}`)
      if (!a || a.kind !== "predicate") return true
      // Below threshold, fall back to the detector, which found it.
      if (!confident("risk-signal", a, backend)) return true
      return a.probability >= 0.5
    })
    riskAreas.set(s.id, kept)
  }
  return { scope, uncovered, riskAreas }
}

/** Whether the Pull Request title and description state each Domain Change. */
export function descriptionRequest(
  description: { title: string; body: string },
  changes: Pick<DomainChange, "id" | "statement">[],
): JudgeRequest {
  return {
    input: `Pull request title: ${description.title}\n\nDescription:\n${description.body || "(empty)"}`,
    judgments: changes.map((c) => ({
      kind: "predicate",
      name: `stated:${c.id}`,
      instructions: `Does the pull request title or description tell a reader about this change in behavior, in any words: "${c.statement}"?`,
    })),
  }
}

export function readDescription(
  changes: DomainChange[],
  answers: JudgeAnswer[],
  backend: BackendName,
): DomainChange[] {
  const by = new Map(answers.map((a) => [a.name, a]))
  return changes.map((c) => {
    const a = by.get(`stated:${c.id}`)
    if (!a || a.kind !== "predicate") return c
    return {
      ...c,
      inDescription: a.probability >= 0.5,
      inDescriptionLikely: !confident(
        "description-states-domain-change",
        a,
        backend,
      ),
    }
  })
}
