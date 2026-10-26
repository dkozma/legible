import type { FileChange, Step } from "@legible/domain"
import type { JudgeAnswer } from "@legible/judge"
import { describe, expect, it } from "vitest"

import {
  applyJudged,
  assembleBrief,
  assembleWalkthrough,
  descriptionRequest,
  detectRiskAreas,
  type PlannerFragment,
  readDescription,
  readUnderstanding,
  riskFor,
  toDomainChanges,
  understandingRequest,
} from "../src/index"

const frag = (
  n: number,
  over: Partial<PlannerFragment> = {},
): PlannerFragment => ({
  alias: `F${n}`,
  fragmentId: `f${n}`,
  fileId: `file${n}`,
  path: `src/f${n}.ts`,
  kind: "behavioral",
  baseRange: null,
  headRange: [1, 10],
  additions: 10,
  deletions: 0,
  test: false,
  collapsed: false,
  symbols: [],
  layerHint: "backend",
  testOf: [],
  callers: 0,
  blastRadius: 0,
  ...over,
})

const fragments = [
  frag(1, { path: "db/migrations/0008.sql", layerHint: "data_model" }),
  frag(2, {
    path: "src/refunds/RefundService.ts",
    symbols: ["RefundService.refundOrder (modified)"],
    callers: 6,
    blastRadius: 12,
  }),
  frag(3, { path: "src/ui/Dialog.tsx", layerHint: "presentation" }),
  frag(4, { path: "src/refunds/RefundService.test.ts", test: true }),
]
const byId = new Map(fragments.map((f) => [f.fragmentId, f]))
const text = new Map([
  [
    "f1",
    {
      removed: [],
      added: ["ALTER TABLE refunds ADD COLUMN amount_cents int;"],
    },
  ],
  [
    "f2",
    {
      removed: ["await auditLog('refund.issued')"],
      added: ["const amount = balance.remaining"],
    },
  ],
  ["f3", { removed: [], added: ["<p>{label}</p>"] }],
  ["f4", { removed: [], added: ["expect(refund(order)).toBe(5)"] }],
])

const w = assembleWalkthrough({
  reviewId: "r",
  iterationId: "i",
  fragments,
  planned: [
    {
      name: "Store amounts",
      narrative: "",
      layer: "data_model",
      feature: "Refunds",
      fragments: ["F1"],
    },
    {
      name: "Partial refunds",
      narrative: "",
      layer: "backend",
      feature: "Refunds",
      fragments: ["F2", "F4"],
    },
    {
      name: "Amount field",
      narrative: "",
      layer: "presentation",
      feature: "Refunds",
      fragments: ["F3"],
    },
  ],
  edges: [],
  kept: [],
  previousChapters: [],
  provider: null,
  model: null,
  promptVersion: "v",
  costUsd: 0,
})
const [store, partial, field] = w.steps as [Step, Step, Step]

describe("Risk", () => {
  it("detects sensitive areas from paths and changed lines", () => {
    expect(detectRiskAreas(store, byId, text)).toEqual([
      "payments",
      "migrations",
    ])
    expect(detectRiskAreas(partial, byId, text)).toEqual(["payments"])
    expect(detectRiskAreas(field, byId, text)).toEqual([])
  })

  it("raises the level with more areas and wider reach", () => {
    expect(riskFor([], { callers: 0, blastRadius: 0 }).level).toBe("low")
    expect(riskFor(["payments"], { callers: 0, blastRadius: 0 })).toEqual({
      level: "elevated",
      reasons: ["payments"],
    })
    expect(riskFor(["payments"], { callers: 6, blastRadius: 12 })).toEqual({
      level: "critical",
      reasons: ["payments", "6 callers"],
    })
    expect(riskFor(["deletes"], { callers: 0, blastRadius: 0 }).level).toBe(
      "low",
    )
  })
})

describe("Scope and coverage", () => {
  const intent = {
    goal: "Partial refunds",
    requirements: [
      { id: "R1", statement: "Refund part of an order" },
      { id: "R2", statement: "Email the customer" },
    ],
  }
  const detected = new Map([
    [store.id, ["migrations" as const]],
    [partial.id, ["payments" as const]],
  ])

  it("asks for Scope per Step, coverage per requirement, and each detected Risk area in one request", () => {
    const req = understandingRequest(intent, w.steps, byId, detected)
    expect(req.judgments.map((j) => j.name)).toEqual([
      `scope:${store.id}`,
      `scope:${partial.id}`,
      `scope:${field.id}`,
      "covered:R1",
      "covered:R2",
      `risk:${store.id}:migrations`,
      `risk:${partial.id}:payments`,
    ])
    expect(req.input).toContain("Step 2: Partial refunds")
  })

  it("reads the answers with thresholds", () => {
    const answers: JudgeAnswer[] = [
      {
        kind: "choice",
        name: `scope:${store.id}`,
        choice: "supporting",
        probabilities: {},
        confidence: 0.9,
      },
      {
        kind: "choice",
        name: `scope:${partial.id}`,
        choice: "R1",
        probabilities: {},
        confidence: 0.95,
      },
      {
        kind: "choice",
        name: `scope:${field.id}`,
        choice: "unrequested",
        probabilities: {},
        confidence: 0.4,
      },
      { kind: "predicate", name: "covered:R1", probability: 0.97 },
      { kind: "predicate", name: "covered:R2", probability: 0.05 },
      {
        kind: "predicate",
        name: `risk:${store.id}:migrations`,
        probability: 0.1,
      },
      {
        kind: "predicate",
        name: `risk:${partial.id}:payments`,
        probability: 0.6,
      },
    ]
    const judged = readUnderstanding(
      w.steps,
      intent,
      detected,
      answers,
      "decisions",
    )
    expect(judged.scope.get(store.id)).toEqual({
      scope: "supporting",
      requirementIds: [],
      likely: false,
    })
    expect(judged.scope.get(partial.id)).toEqual({
      scope: "requested",
      requirementIds: ["R1"],
      likely: false,
    })
    expect(judged.scope.get(field.id)).toMatchObject({
      scope: "unrequested",
      likely: true,
    })
    expect(judged.uncovered).toEqual(["R2"])
    // A confident "no" removes the area; an unsure answer keeps the detector's word.
    expect(judged.riskAreas.get(store.id)).toEqual([])
    expect(judged.riskAreas.get(partial.id)).toEqual(["payments"])

    const applied = applyJudged(w, judged, detected, byId)
    expect(applied.steps[1]?.risk.level).toBe("critical")
    expect(applied.steps[2]?.scope).toBe("unrequested")
  })
})

describe("Domain Changes and the Description Gap", () => {
  it("links Domain Changes to Fragments and Steps, and finds the gap", () => {
    const changes = toDomainChanges(
      {
        domainChanges: [
          {
            statement: "Refunds can be partial",
            before: null,
            after: "partial",
            fragments: ["F2"],
          },
          {
            statement: "Audit entries no longer name the operator",
            before: "operator recorded",
            after: "not recorded",
            fragments: ["F2", "F99"],
          },
          { statement: " ", before: null, after: "", fragments: [] },
        ],
        howToTest: [],
      },
      fragments,
      w.steps,
      true,
    )
    expect(changes.map((c) => [c.id, c.fragmentIds, c.stepIds])).toEqual([
      ["d1", ["f2"], [partial.id]],
      ["d2", ["f2"], [partial.id]],
    ])
    const req = descriptionRequest(
      {
        title: "Partial refunds",
        body: "Lets support refund part of an order.",
      },
      changes,
    )
    expect(req.judgments).toHaveLength(2)
    const read = readDescription(
      changes,
      [
        { kind: "predicate", name: "stated:d1", probability: 0.95 },
        { kind: "predicate", name: "stated:d2", probability: 0.02 },
      ],
      "jev",
    )
    const brief = assembleBrief({
      walkthrough: w,
      files: [] as FileChange[],
      domainChanges: read,
      gapSuggestion: "- Audit entries no longer record the operator.",
      hasDescription: true,
      uncoveredRequirementIds: [],
      howToTestFromSource: [],
      howToTestSuggested: ["Refund $5"],
      costUsd: 0.1,
    })
    expect(brief.descriptionGap).toEqual({
      domainChangeIds: ["d2"],
      suggestion: "- Audit entries no longer record the operator.",
    })
    expect(brief.components.map((c) => c.layer)).toEqual([
      "data_model",
      "backend",
      "presentation",
    ])
  })

  it("has no gap without a description", () => {
    const brief = assembleBrief({
      walkthrough: w,
      files: [],
      domainChanges: [],
      gapSuggestion: null,
      hasDescription: false,
      uncoveredRequirementIds: [],
      howToTestFromSource: [],
      howToTestSuggested: [],
      costUsd: 0,
    })
    expect(brief.descriptionGap).toBeNull()
  })
})
