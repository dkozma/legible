// Risk (engineering plan §9.3): deterministic detectors over paths, names and
// changed lines find sensitive areas; the Judge's `risk-signal` predicates
// confirm them; blast radius across Connections raises the level.

import type { Risk, RiskLevel, Step } from "@legible/domain"

import type { FragmentText, PlannerFragment } from "../walkthrough/fragments"

export const RISK_AREAS = {
  auth: {
    label: "auth",
    question: "authentication, sessions, permissions or credentials",
    weight: 2,
    pattern:
      /\b(auth\w*|login|logout|sign[_-]?in|password|passwd|session|jwt|oauth|permission|role|acl|csrf|credential|api[_-]?key|access[_-]?token)\b/i,
  },
  payments: {
    label: "payments",
    question: "money: payments, refunds, charges, prices, balances or invoices",
    weight: 2,
    pattern:
      /\b(payment|pay|refund\w*|charge|invoice|billing|price|pricing|amount\w*|currency|checkout|stripe|ledger|balance|cents|tax)\b/i,
  },
  crypto: {
    label: "crypto",
    question:
      "cryptography: encryption, signing, hashing secrets or randomness",
    weight: 2,
    pattern:
      /\b(crypto\w*|encrypt\w*|decrypt\w*|hmac|signature|cipher|bcrypt|scrypt|argon2?|nonce|randomBytes|secret)\b/i,
  },
  migrations: {
    label: "migration",
    question: "the database schema or stored data (a migration)",
    weight: 2,
    pattern:
      /\b(ALTER\s+TABLE|DROP\s+(TABLE|COLUMN|INDEX)|CREATE\s+TABLE|ADD\s+COLUMN|RENAME\s+COLUMN|migration)\b/i,
  },
  deletes: {
    label: "deletes data",
    question: "deleting or overwriting data",
    weight: 1,
    pattern:
      /\b(DELETE\s+FROM|TRUNCATE|\.delete\(|\.destroy\(|\.remove\(|unlink\(|rmSync|rm\s+-rf|purge|deleteMany|drop\()/i,
  },
  concurrency: {
    label: "concurrency",
    question:
      "concurrency: locks, transactions, retries, idempotency or parallel work",
    weight: 1,
    pattern:
      /\b(mutex|lock\(|semaphore|atomic|concurrent\w*|Promise\.all|go func|goroutine|Thread|synchronized|transaction|idempoten\w*|retry|race)\b/i,
  },
  public_api: {
    label: "public API",
    question: "a public API other code or clients depend on",
    weight: 1,
    // Routes anywhere; exported declarations only where one was removed or changed (below).
    pattern:
      /\b(router\.|app\.(get|post|put|delete|patch)|@(Get|Post|Put|Delete)Mapping)/,
  },
} as const

export type RiskArea = keyof typeof RISK_AREAS

const AREAS = Object.keys(RISK_AREAS) as RiskArea[]

/** Sensitive areas a Step's paths, Symbols or changed lines mention. */
export function detectRiskAreas(
  step: Step,
  fragments: Map<string, PlannerFragment>,
  text: Map<string, FragmentText>,
): RiskArea[] {
  // Tests, formatting and prose don't change behavior.
  const behavioral = step.fragments.filter(
    (f) =>
      f.kind === "behavioral" &&
      !f.test &&
      !f.collapsed &&
      !/\.(md|mdx|txt|rst|adoc)$/i.test(f.path),
  )
  if (!behavioral.length) return []
  const found = new Set<RiskArea>()
  for (const f of behavioral) {
    const p = fragments.get(f.fragmentId)
    const t = text.get(f.fragmentId)
    const haystack = [
      f.path,
      ...(p?.symbols ?? []),
      ...(t?.added ?? []),
      ...(t?.removed ?? []),
    ]
    for (const area of AREAS) {
      if (found.has(area)) continue
      const re = RISK_AREAS[area].pattern
      if (area === "migrations" && /(^|\/)migrations?\//i.test(f.path))
        found.add(area)
      else if (
        area === "public_api" &&
        (t?.removed ?? []).some((l) => /^\s*(export|pub|public)\s/.test(l))
      )
        found.add(area)
      else if (haystack.some((line) => re.test(line))) found.add(area)
    }
  }
  return AREAS.filter((a) => found.has(a))
}

/** Step reach at which Risk goes up a level. */
const WIDE = { callers: 5, blastRadius: 20 }
const VERY_WIDE = { callers: 15, blastRadius: 60 }

/**
 * The level from the confirmed areas and the reach: a weight-2 area is
 * elevated; a second weight-2 area, or wide reach, makes it critical; very
 * wide reach alone is elevated.
 */
export function riskFor(
  areas: RiskArea[],
  reach: { callers: number; blastRadius: number },
): Risk {
  const reasons: string[] = areas.map((a) => RISK_AREAS[a].label)
  let score = Math.max(0, ...areas.map((a) => RISK_AREAS[a].weight))
  if (areas.filter((a) => RISK_AREAS[a].weight >= 2).length >= 2) score += 1
  const wide =
    reach.callers >= WIDE.callers || reach.blastRadius >= WIDE.blastRadius
  const veryWide =
    reach.callers >= VERY_WIDE.callers ||
    reach.blastRadius >= VERY_WIDE.blastRadius
  if (veryWide) score += 2
  else if (wide) score += 1
  if (wide)
    reasons.push(
      `${reach.callers} ${reach.callers === 1 ? "caller" : "callers"}`,
    )
  const level: RiskLevel =
    score >= 3 ? "critical" : score >= 2 ? "elevated" : "low"
  return { level, reasons: level === "low" ? [] : reasons }
}

/** A Step's reach: the widest of its Fragments'. */
export function stepReach(
  step: Step,
  fragments: Map<string, PlannerFragment>,
): { callers: number; blastRadius: number } {
  let callers = 0
  let blastRadius = 0
  for (const f of step.fragments) {
    const p = fragments.get(f.fragmentId)
    if (!p || p.test) continue
    callers = Math.max(callers, p.callers)
    blastRadius = Math.max(blastRadius, p.blastRadius)
  }
  return { callers, blastRadius }
}
