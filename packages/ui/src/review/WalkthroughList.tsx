// The Walkthrough in the left sidebar: Chapters (when there are several
// features), Sittings and Steps in reading order, with Scope, Risk and viewed
// marks, and progress per Sitting.

import type { Step, UnderstandingStatus, Walkthrough } from "@legible/domain"
import { Check, Loader2 } from "lucide-react"

import { Button, cn, Progress } from "../components/ui"
import { RiskBars, ScopeMark } from "./marks"
import { minutes } from "./steps"

function StepRow({
  step,
  n,
  active,
  viewed,
  onOpen,
}: {
  step: Step
  n: number
  active: boolean
  viewed: boolean
  onOpen: () => void
}) {
  const tests = step.fragments.filter((f) => f.test).length
  const structural = step.fragments.every((f) => f.kind === "structural")
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "step" : undefined}
      data-testid="step-row"
      className={cn(
        "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover",
        active && "bg-hover",
        step.scope === "unrequested" &&
          "border border-unrequested-border bg-unrequested-bg",
      )}
    >
      <span
        className={cn(
          "mt-px w-5 shrink-0 text-right font-mono text-xs text-muted-foreground",
          viewed && "text-dim",
        )}
      >
        {viewed ? <Check className="ml-auto size-3.5 text-ok" /> : n}
      </span>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span
          className={cn(
            "truncate text-sm",
            active && "font-medium",
            viewed && "text-muted-foreground",
          )}
        >
          {step.name}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ScopeMark scope={step.scope} likely={step.scopeLikely} />
          <span>
            {structural
              ? "Structural · verified"
              : step.scope
                ? `${step.scopeLikely ? "likely " : ""}${step.scope}`
                : "Scope pending"}
          </span>
          <span>
            · <span className="text-ok">+{step.additions}</span>{" "}
            <span className="text-critical">−{step.deletions}</span>
          </span>
          {tests > 0 && (
            <span>
              · {tests} {tests === 1 ? "test" : "tests"}
            </span>
          )}
        </span>
      </span>
      <RiskBars risk={step.risk} className="mt-1" />
    </button>
  )
}

export function WalkthroughList({
  walkthrough: w,
  status,
  viewed,
  activeStepId,
  onOpen,
  onBuild,
}: {
  walkthrough: Walkthrough | null
  status: UnderstandingStatus | null
  viewed: ReadonlySet<string>
  activeStepId: string | null
  onOpen: (stepId: string) => void
  onBuild: () => void
}) {
  if (!w) {
    const running = status?.state === "running"
    return (
      <div className="flex flex-col items-start gap-2 px-3.5 py-3 text-sm text-muted-foreground">
        {running ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            {status?.progress ?? "Planning the Walkthrough"}
          </span>
        ) : (
          <>
            <span>
              The Walkthrough orders the changes into Steps you can read one by
              one.
            </span>
            <Button size="sm" variant="outline" onClick={onBuild}>
              Plan the Walkthrough
            </Button>
          </>
        )}
      </div>
    )
  }
  const index = new Map(w.steps.map((s, i) => [s.id, i]))
  const chapters = w.chapters.length
    ? w.chapters
    : [{ id: null as string | null, name: "", summary: "" }]
  return (
    <nav aria-label="Walkthrough" className="flex flex-col gap-3 px-1.5 pb-2">
      {chapters.map((c) => {
        const sittings = w.sittings.filter((st) => st.chapterId === c.id)
        const steps = w.steps.filter((s) => s.chapterId === c.id)
        const done = steps.filter((s) => viewed.has(s.id)).length
        return (
          <section key={c.id ?? "all"} className="flex flex-col gap-1">
            {c.id && (
              <header className="flex items-center gap-2 px-2 pt-1">
                <span className="grow truncate text-sm font-semibold">
                  {c.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {Math.round((done / Math.max(1, steps.length)) * 100)}%
                </span>
              </header>
            )}
            {sittings.map((st) => {
              const ids = st.stepIds
              const seen = ids.filter((id) => viewed.has(id)).length
              return (
                <div key={st.index} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2 px-2 pt-1.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Sitting {st.index}
                    </span>
                    <span>
                      · {seen} of {ids.length}
                    </span>
                    <span className="grow" />
                    <span>
                      {seen === ids.length
                        ? "done"
                        : `${minutes(Math.max(2, Math.round((st.minutes * (ids.length - seen)) / ids.length)))} left`}
                    </span>
                  </div>
                  {ids.map((id) => {
                    const i = index.get(id)
                    const s = i === undefined ? null : w.steps[i]
                    if (!s || i === undefined) return null
                    return (
                      <StepRow
                        key={id}
                        step={s}
                        n={i + 1}
                        active={id === activeStepId}
                        viewed={viewed.has(id)}
                        onOpen={() => onOpen(id)}
                      />
                    )
                  })}
                </div>
              )
            })}
          </section>
        )
      })}
    </nav>
  )
}

export function WalkthroughProgress({
  walkthrough: w,
  viewed,
}: {
  walkthrough: Walkthrough
  viewed: ReadonlySet<string>
}) {
  const done = w.steps.filter((s) => viewed.has(s.id)).length
  return (
    <div className="flex flex-col gap-1.5 border-t px-4 py-3">
      <div className="flex items-center text-xs">
        <span className="grow text-muted-foreground">Walkthrough</span>
        <span>
          {done} of {w.steps.length} Steps viewed
        </span>
      </div>
      <Progress value={w.steps.length ? (done / w.steps.length) * 100 : 0} />
    </div>
  )
}
