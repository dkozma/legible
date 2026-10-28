// The Scope and Risk visual language (M0 board 03): Scope is a shape, Risk is
// signal bars. The same marks appear in Step rows, the Brief and headers.

import type { RiskLevel, Scope, Step } from "@legible/domain"

import { cn } from "../components/ui"

export const SCOPE_TEXT: Record<Scope, string> = {
  requested: "Requested",
  supporting: "Supporting",
  unrequested: "Unrequested",
}

export const RISK_TEXT: Record<RiskLevel, string> = {
  low: "Low risk",
  elevated: "Elevated",
  critical: "Critical",
}

/** Filled dot: Requested. Hollow ring: Supporting. Violet diamond: Unrequested. */
export function ScopeMark({
  scope,
  likely = false,
  className,
}: {
  scope: Scope | null
  likely?: boolean
  className?: string
}) {
  const title = scope
    ? `${likely ? "Likely " : ""}${SCOPE_TEXT[scope]}`
    : "Scope not judged yet"
  if (scope === "unrequested")
    return (
      <span
        role="img"
        aria-label={title}
        title={title}
        className={cn(
          "inline-block size-2 shrink-0 rotate-45 bg-unrequested",
          likely && "opacity-60",
          className,
        )}
      />
    )
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        scope === "requested" && "bg-scope-requested",
        scope === "supporting" && "border-[1.5px] border-scope-supporting",
        scope === null && "border border-dashed border-dim",
        likely && "opacity-60",
        className,
      )}
    />
  )
}

/** One dim bar: low. Two amber: elevated. Three rose: critical. */
export function RiskBars({
  risk,
  className,
}: {
  risk: Step["risk"]
  className?: string
}) {
  const n = risk.level === "critical" ? 3 : risk.level === "elevated" ? 2 : 1
  const color =
    risk.level === "critical"
      ? "bg-critical"
      : risk.level === "elevated"
        ? "bg-elevated"
        : "bg-dim"
  const title = `${RISK_TEXT[risk.level]}${risk.reasons.length ? ` · ${risk.reasons.join(", ")}` : ""}`
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn("inline-flex shrink-0 items-end gap-[1.5px]", className)}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            "w-[3px] rounded-[1px]",
            i === 0 ? "h-1.5" : i === 1 ? "h-2" : "h-2.5",
            i < n ? color : "bg-track",
          )}
        />
      ))}
    </span>
  )
}
