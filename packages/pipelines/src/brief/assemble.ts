// Assembling the Change Brief from the Walkthrough and the judged parts.

import type {
  ChangeBrief,
  ComponentFile,
  DomainChange,
  FileChange,
  Layer,
  RiskLevel,
  Step,
  Walkthrough,
} from "@legible/domain"

import type { PlannerFragment } from "../walkthrough/fragments"
import type { UnderstandingJudged } from "./judgments"
import { riskFor, type RiskArea, stepReach } from "./risk"

const RISK_ORDER: RiskLevel[] = ["low", "elevated", "critical"]
const maxRisk = (a: RiskLevel, b: RiskLevel) =>
  RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b

/** Scope and Risk onto the Walkthrough's Steps. Without an Intent, Scope stays unknown. */
export function applyJudged(
  w: Walkthrough,
  judged: UnderstandingJudged | null,
  detected: Map<string, RiskArea[]>,
  fragments: Map<string, PlannerFragment>,
): Walkthrough {
  const steps = w.steps.map((s): Step => {
    const scope = judged?.scope.get(s.id)
    const areas = judged?.riskAreas.get(s.id) ?? detected.get(s.id) ?? []
    return {
      ...s,
      scope: scope?.scope ?? null,
      scopeLikely: scope?.likely ?? false,
      requirementIds: scope?.requirementIds ?? [],
      risk: riskFor(areas, stepReach(s, fragments)),
    }
  })
  return { ...w, steps }
}

/** Touched files by Layer, Layers in Walkthrough order, each file with its riskiest Step. */
export function componentMap(
  steps: Step[],
  files: FileChange[],
): ChangeBrief["components"] {
  const byFile = new Map<string, ComponentFile & { layer: Layer }>()
  const layers: Layer[] = []
  for (const s of steps)
    for (const f of s.fragments) {
      const file = files.find((x) => x.id === f.fileId)
      const c = byFile.get(f.fileId)
      if (c) {
        c.risk = maxRisk(c.risk, s.risk.level)
        if (!c.stepIds.includes(s.id)) c.stepIds.push(s.id)
        continue
      }
      if (!layers.includes(s.layer)) layers.push(s.layer)
      byFile.set(f.fileId, {
        fileId: f.fileId,
        path: f.path,
        risk: s.risk.level,
        structural: file
          ? file.structural !== null ||
            (file.fragments.length > 0 &&
              file.fragments.every((x) => x.kind === "structural"))
          : f.kind === "structural",
        stepIds: [s.id],
        layer: s.layer,
      })
    }
  return layers.map((layer) => ({
    layer,
    files: [...byFile.values()]
      .filter((c) => c.layer === layer)
      .map(({ layer: _l, ...c }) => c),
  }))
}

export interface BriefInput {
  walkthrough: Walkthrough
  files: FileChange[]
  domainChanges: DomainChange[]
  /** Null without a Pull Request description to compare against. */
  gapSuggestion: string | null
  hasDescription: boolean
  uncoveredRequirementIds: string[]
  howToTestFromSource: string[]
  howToTestSuggested: string[]
  domainChangesError?: string | null
  costUsd: number
}

export function assembleBrief(input: BriefInput): ChangeBrief {
  const missing = input.domainChanges
    .filter((d) => d.inDescription === false)
    .map((d) => d.id)
  return {
    reviewId: input.walkthrough.reviewId,
    iterationId: input.walkthrough.iterationId,
    domainChanges: input.domainChanges,
    descriptionGap: input.hasDescription
      ? {
          domainChangeIds: missing,
          suggestion: missing.length ? input.gapSuggestion : null,
        }
      : null,
    uncoveredRequirementIds: input.uncoveredRequirementIds,
    components: componentMap(input.walkthrough.steps, input.files),
    howToTest: {
      fromSource: input.howToTestFromSource,
      suggested: input.howToTestSuggested,
    },
    domainChangesError: input.domainChangesError ?? null,
    costUsd: input.costUsd,
    createdAt: new Date().toISOString(),
  }
}
