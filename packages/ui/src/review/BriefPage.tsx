// The Change Brief (product plan §7.4): the orientation page every Review
// opens on. Intent, Domain Changes, the Description Gap, Unrequested Steps,
// Risk hotspots, the component map, the Sittings ahead, and how to test.

import {
  type ChangeBrief,
  type ChangeSetSummary,
  type Intent,
  LAYER_LABEL,
  type ReviewSummary,
  type Step,
  type TranscriptCandidate,
  type UnderstandingStatus,
  type Walkthrough,
} from "@legible/domain"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Loader2,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { relativeTime, usd } from "../components/Inline"
import {
  Badge,
  Button,
  Callout,
  Card,
  cn,
  Eyebrow,
  Input,
  Kbd,
  Skeleton,
} from "../components/ui"
import { RISK_TEXT, RiskBars, SCOPE_TEXT, ScopeMark } from "./marks"
import { minutes } from "./steps"

export interface BriefActions {
  openStep(stepId: string): void
  startSitting(index: number): void
  rebuild(what: "none" | "all" | "intent" | "walkthrough" | "brief"): void
  cancel(): void
  saveIntent(goal: string, requirements: string[]): void
  confirmIntent(): void
  resetIntent(): void
  setTranscript(id: string, selected: boolean): void
  openFile(fileId: string): void
}

function Section({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn("flex flex-col gap-3 p-4", className)}>
      <header className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="grow" />
        {aside}
      </header>
      {children}
    </Card>
  )
}

function StepLink({
  step,
  n,
  onOpen,
}: {
  step: Step
  n: number
  onOpen: () => void
}) {
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={onOpen}
      className={cn(
        step.scope === "unrequested" &&
          "border-unrequested-border text-unrequested",
      )}
    >
      <ScopeMark scope={step.scope} likely={step.scopeLikely} />
      Step {n}
      {step.scope ? ` · ${SCOPE_TEXT[step.scope]}` : ""}
    </Button>
  )
}

function IntentCard({
  intent,
  status,
  transcripts,
  review,
  actions,
}: {
  intent: Intent | null
  status: UnderstandingStatus | null
  transcripts: TranscriptCandidate[]
  review: ReviewSummary
  actions: BriefActions
}) {
  const [editing, setEditing] = useState(false)
  const goalRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) goalRef.current?.focus()
  }, [editing])
  const [goal, setGoal] = useState("")
  const [reqs, setReqs] = useState("")
  const building =
    status?.state === "running" && status.stages.intent.state !== "done"
  const startEdit = () => {
    setGoal(intent?.goal ?? "")
    setReqs(intent?.requirements.map((r) => r.statement).join("\n") ?? "")
    setEditing(true)
  }
  return (
    <Section
      title="Intent"
      aside={
        <span className="flex items-center gap-1.5">
          {intent?.sources.map((s) => (
            <Badge key={`${s.kind}:${s.ref ?? s.label}`} tone="muted">
              {s.label}
            </Badge>
          ))}
          {!editing && (
            <Button variant="ghost" size="xs" onClick={startEdit}>
              <Pencil />
              Edit
            </Button>
          )}
        </span>
      }
    >
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!goal.trim()) return
            actions.saveIntent(
              goal,
              reqs.split("\n").map((l) => l.replace(/^\s*(R\d+:|[-*])\s*/, "")),
            )
            setEditing(false)
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Goal
            <Input
              ref={goalRef}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              aria-label="Goal"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Requirements, one per line
            <textarea
              className="min-h-24 rounded-md border bg-transparent px-2.5 py-1.5 text-sm text-foreground"
              value={reqs}
              onChange={(e) => setReqs(e.target.value)}
              aria-label="Requirements"
            />
          </label>
          <span className="flex gap-1.5">
            <Button size="sm" type="submit">
              Save Intent
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <span className="grow" />
            {intent && intent.sourceKey === null && (
              <Button
                size="sm"
                variant="ghost"
                type="button"
                onClick={() => {
                  actions.resetIntent()
                  setEditing(false)
                }}
              >
                Rebuild from its sources
              </Button>
            )}
          </span>
        </form>
      ) : !intent ? (
        building ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/2" />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Intent yet.{" "}
            {review.sourceKind === "pull_request"
              ? "It comes from the Pull Request."
              : "Write what this change should do, or let Legible infer it from the code."}
          </p>
        )
      ) : (
        <>
          {intent.inferred && !intent.confirmed && (
            <Callout tone="ask" className="flex items-center gap-2 px-3 py-2">
              <AlertTriangle className="size-3.5 shrink-0 text-ask" />
              <span className="grow text-sm">
                Inferred from the code. Correct it, or confirm it, to tag what
                each Step does as Requested or Unrequested. A wrong guess here
                is itself worth noticing.
              </span>
              <Button size="xs" onClick={actions.confirmIntent}>
                Confirm
              </Button>
              <Button size="xs" variant="outline" onClick={startEdit}>
                Correct
              </Button>
            </Callout>
          )}
          <p className="text-[15px] leading-relaxed" data-testid="intent-goal">
            {intent.goal}
          </p>
          {intent.requirements.length > 0 && (
            <ol className="flex flex-col gap-1">
              {intent.requirements.map((r) => (
                <li key={r.id} className="flex gap-2 text-sm">
                  <span className="w-7 shrink-0 font-mono text-xs leading-5 text-muted-foreground">
                    {r.id}
                  </span>
                  <span>{r.statement}</span>
                </li>
              ))}
            </ol>
          )}
          {intent.corrections.map((c) => (
            <blockquote
              key={c}
              className="border-l-2 border-ask-border pl-3 text-sm text-muted-foreground"
            >
              <Eyebrow className="block">Correction in transcript</Eyebrow>
              {c}
            </blockquote>
          ))}
        </>
      )}
      {transcripts.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2.5">
          <Eyebrow>Agent Transcripts on this machine</Eyebrow>
          {transcripts.map((t) => (
            <div
              key={t.id}
              className="flex items-start gap-2 text-sm"
              title={t.match}
            >
              <input
                id={`transcript-${t.id}`}
                type="checkbox"
                className="mt-1"
                checked={t.selected}
                onChange={(e) => actions.setTranscript(t.id, e.target.checked)}
              />
              <label
                htmlFor={`transcript-${t.id}`}
                className="flex min-w-0 flex-col"
              >
                <span className="truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground">
                  {t.tool === "codex" ? "Codex" : "Claude Code"} ·{" "}
                  {relativeTime(t.endedAt)} · {t.prompts}{" "}
                  {t.prompts === 1 ? "prompt" : "prompts"}
                  {t.corrections
                    ? `, ${t.corrections} ${t.corrections === 1 ? "correction" : "corrections"}`
                    : ""}{" "}
                  · {t.match}
                </span>
              </label>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function BuildStatus({
  status,
  walkthrough,
  actions,
}: {
  status: UnderstandingStatus | null
  walkthrough: Walkthrough | null
  actions: BriefActions
}) {
  if (!status) return null
  if (status.state === "running")
    return (
      <span
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
        role="status"
      >
        <Loader2 className="size-3.5 animate-spin" />
        {status.progress ?? "Working"}
        <span className="font-mono text-xs">{usd(status.costUsd)}</span>
        <Button variant="ghost" size="xs" onClick={actions.cancel}>
          <X />
          Stop
        </Button>
      </span>
    )
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {walkthrough?.model && <span>Planned by {walkthrough.model}</span>}
      <Button
        variant="ghost"
        size="xs"
        onClick={() => actions.rebuild("all")}
        title="Build the Intent, Walkthrough and Brief again"
      >
        <RefreshCw />
        Rebuild
      </Button>
    </span>
  )
}

export function BriefPage({
  review,
  summary,
  intent,
  walkthrough: w,
  brief,
  status,
  transcripts,
  viewedSteps,
  actions,
}: {
  review: ReviewSummary
  summary: ChangeSetSummary | null
  intent: Intent | null
  walkthrough: Walkthrough | null
  brief: ChangeBrief | null
  status: UnderstandingStatus | null
  transcripts: TranscriptCandidate[]
  viewedSteps: ReadonlySet<string>
  actions: BriefActions
}) {
  const [copied, setCopied] = useState(false)
  const n = (id: string) => (w ? w.steps.findIndex((s) => s.id === id) + 1 : 0)
  const step = (id: string) => w?.steps.find((s) => s.id === id) ?? null
  const unrequested = w?.steps.filter((s) => s.scope === "unrequested") ?? []
  const hotspots =
    w?.steps
      .filter((s) => s.risk.level !== "low")
      .toSorted(
        (a, b) =>
          (b.risk.level === "critical" ? 2 : 1) -
          (a.risk.level === "critical" ? 2 : 1),
      ) ?? []
  const totalMinutes = w?.sittings.reduce((t, s) => t + s.minutes, 0) ?? 0
  const lines = (summary?.additions ?? 0) + (summary?.deletions ?? 0)
  const gap = brief?.descriptionGap
  const missing = gap
    ? (brief?.domainChanges.filter((d) => gap.domainChangeIds.includes(d.id)) ??
      [])
    : []
  const nextSitting =
    w?.sittings.find((s) => s.stepIds.some((id) => !viewedSteps.has(id))) ??
    w?.sittings[0]

  return (
    <div className="flex-auto overflow-auto" data-testid="change-brief">
      <div className="mx-auto flex max-w-[920px] flex-col gap-4 px-6 py-5">
        <header className="flex flex-col gap-1">
          <Eyebrow>Change Brief · read this before any code</Eyebrow>
          <div className="flex items-start gap-3">
            <h1 className="grow text-xl font-semibold">{review.title}</h1>
            <BuildStatus status={status} walkthrough={w} actions={actions} />
          </div>
          <p className="text-sm text-muted-foreground">
            {review.headRef ?? "Working tree"} → {review.baseRef ?? "base"} ·{" "}
            {lines.toLocaleString()} changed lines ·{" "}
            {summary?.files.length ?? 0} files
            {w ? ` · ${w.steps.length} Steps` : ""}
            {brief ? ` · ${usd(brief.costUsd)} to build` : ""}
          </p>
          {status?.error && status.state !== "running" && (
            <Callout tone="elevated" className="mt-1 px-3 py-2 text-sm">
              {status.error}{" "}
              <Button
                variant="link"
                size="none"
                className="text-sm"
                onClick={() =>
                  actions.rebuild(
                    status.stages.walkthrough.state === "error"
                      ? "walkthrough"
                      : status.stages.intent.state === "error"
                        ? "intent"
                        : "brief",
                  )
                }
              >
                Try again
              </Button>
            </Callout>
          )}
        </header>

        {w?.fallbackReason && status?.state !== "running" && (
          <Callout
            tone="elevated"
            className="flex items-center gap-2 px-3 py-2 text-sm"
          >
            <span className="grow">{w.fallbackReason}</span>
            <Button
              size="xs"
              variant="outline"
              onClick={() => actions.rebuild("walkthrough")}
            >
              Plan again
            </Button>
          </Callout>
        )}

        <IntentCard
          intent={intent}
          status={status}
          transcripts={transcripts}
          review={review}
          actions={actions}
        />

        {brief && brief.uncoveredRequirementIds.length > 0 && (
          <Callout tone="elevated" className="flex flex-col gap-1 px-3 py-2">
            <span className="text-sm font-medium">Not found in the code</span>
            {brief.uncoveredRequirementIds.map((id) => (
              <span key={id} className="text-sm text-muted-foreground">
                {id}: {intent?.requirements.find((r) => r.id === id)?.statement}
              </span>
            ))}
          </Callout>
        )}

        <Section
          title={`Domain Changes${brief ? ` (${brief.domainChanges.length})` : ""}`}
        >
          {!brief ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="w-3/4" />
              <Skeleton className="w-2/3" />
              <Skeleton className="w-1/2" />
            </div>
          ) : brief.domainChangesError ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="grow">
                Couldn't find Domain Changes: {brief.domainChangesError}
              </span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => actions.rebuild("brief")}
              >
                Retry
              </Button>
            </p>
          ) : brief.domainChanges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No change in business rules found.
            </p>
          ) : (
            <ol className="flex flex-col gap-3" data-testid="domain-changes">
              {brief.domainChanges.map((d, i) => (
                <li key={d.id} className="flex gap-3">
                  <span className="w-5 shrink-0 font-mono text-xs leading-5 text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 grow flex-col gap-1">
                    <span className="text-sm">
                      {d.statement}
                      {d.before && (
                        <span className="text-muted-foreground">
                          {" "}
                          (was {d.before})
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {d.stepIds.map((id) => {
                        const s = step(id)
                        return s ? (
                          <StepLink
                            key={id}
                            step={s}
                            n={n(id)}
                            onOpen={() => actions.openStep(id)}
                          />
                        ) : null
                      })}
                      {d.inDescription === true && (
                        <Badge tone="ok">
                          {d.inDescriptionLikely ? "Likely in" : "In"} PR
                          description
                        </Badge>
                      )}
                      {d.inDescription === false && (
                        <Badge tone="elevated">
                          {d.inDescriptionLikely ? "Likely not in" : "Not in"}{" "}
                          PR description
                        </Badge>
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {gap && missing.length > 0 && (
          <Callout tone="elevated" className="flex flex-col gap-2 p-4">
            <span className="text-sm font-semibold">
              Description Gap · {missing.length}{" "}
              {missing.length === 1 ? "change isn't" : "changes aren't"} in the
              PR description
            </span>
            {gap.suggestion && (
              <pre className="rounded-md border bg-background px-3 py-2 font-sans text-sm whitespace-pre-wrap">
                {gap.suggestion}
              </pre>
            )}
            <span className="flex items-center gap-2">
              {gap.suggestion && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(gap.suggestion ?? "")
                      .then(() => setCopied(true))
                  }}
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? "Copied" : "Copy suggested wording"}
                </Button>
              )}
              <span className="text-xs text-muted-foreground">
                {review.mode === "author"
                  ? "Add it to the description. Updating it from Legible arrives with host integration (M4)."
                  : "Ask the author to add it. Drafting that Note arrives with host integration (M4)."}
              </span>
            </span>
          </Callout>
        )}

        {unrequested.length > 0 && (
          <Section
            title={`Unrequested · ${unrequested.length} ${unrequested.length === 1 ? "Step" : "Steps"}`}
            className="border-unrequested-border"
          >
            {unrequested.map((s) => (
              <div
                key={s.id}
                className="flex items-start gap-3 rounded-md border border-unrequested-border bg-unrequested-bg px-3 py-2"
              >
                <ScopeMark scope="unrequested" className="mt-1.5" />
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="text-sm font-medium">
                    Step {n(s.id)} · {s.name}
                    {s.scopeLikely && (
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        (likely)
                      </span>
                    )}
                  </span>
                  {s.narrative && (
                    <span className="text-sm text-muted-foreground">
                      {s.narrative}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    +{s.additions} −{s.deletions} ·{" "}
                    {new Set(s.fragments.map((f) => f.path)).size} files
                  </span>
                </span>
                <RiskBars risk={s.risk} className="mt-1.5" />
                <Button size="xs" onClick={() => actions.openStep(s.id)}>
                  Open Step {n(s.id)}
                </Button>
              </div>
            ))}
          </Section>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Section
            title="Risk hotspots"
            aside={<span className="text-xs text-dim">Not reordered</span>}
          >
            {!w ? (
              <Skeleton className="w-2/3" />
            ) : hotspots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Step touches a sensitive area.
              </p>
            ) : (
              hotspots.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className="flex items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm hover:bg-hover"
                  onClick={() => actions.openStep(s.id)}
                >
                  <RiskBars risk={s.risk} />
                  <span className="w-12 shrink-0 text-xs text-muted-foreground">
                    Step {n(s.id)}
                  </span>
                  <span className="grow truncate">{s.name}</span>
                  <span
                    className={cn(
                      "shrink-0 text-xs",
                      s.risk.level === "critical"
                        ? "text-critical"
                        : "text-elevated",
                    )}
                  >
                    {RISK_TEXT[s.risk.level]}
                    {s.risk.reasons.length
                      ? ` · ${s.risk.reasons.join(", ")}`
                      : ""}
                  </span>
                </button>
              ))
            )}
          </Section>

          <Section
            title="Your review"
            aside={
              w && (
                <span className="text-xs text-muted-foreground">
                  {minutes(totalMinutes)} · {w.sittings.length}{" "}
                  {w.sittings.length === 1 ? "Sitting" : "Sittings"}
                </span>
              )
            }
          >
            {!w ? (
              <Skeleton className="w-1/2" />
            ) : (
              <>
                {w.sittings.map((st) => (
                  <div key={st.index} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-sm">
                      Sitting {st.index}
                    </span>
                    <span className="grow truncate text-xs text-muted-foreground">
                      Steps{" "}
                      {st.stepIds.length === 1
                        ? n(st.stepIds[0] as string)
                        : `${n(st.stepIds[0] as string)}–${n(st.stepIds.at(-1) as string)}`}{" "}
                      · {st.lines} lines
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {minutes(st.minutes)}
                    </span>
                  </div>
                ))}
                {nextSitting && (
                  <Button
                    className="self-start"
                    onClick={() => actions.startSitting(nextSitting.index)}
                    data-testid="start-sitting"
                  >
                    Start Sitting {nextSitting.index}
                    <ArrowRight />
                    <Kbd keys={["↵"]} />
                  </Button>
                )}
              </>
            )}
          </Section>
        </div>

        <Section title="Touched components">
          {!brief ? (
            <Skeleton className="w-2/3" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {brief.components.map((c, i) => (
                <div key={c.layer} className="flex gap-3">
                  <span className="w-32 shrink-0 text-sm text-muted-foreground">
                    {i + 1} · {LAYER_LABEL[c.layer]}
                  </span>
                  <span className="flex min-w-0 grow flex-wrap gap-1.5">
                    {c.files.map((f) => (
                      <Button
                        key={f.fileId}
                        variant="outline"
                        size="xs"
                        className={cn(
                          "font-mono",
                          f.risk === "critical" && "border-critical-border",
                          f.risk === "elevated" && "border-elevated-border",
                        )}
                        title={f.path}
                        onClick={() => actions.openFile(f.fileId)}
                      >
                        {f.path.split("/").pop()}
                        {f.structural && (
                          <span className="font-sans text-dim">
                            · structural
                          </span>
                        )}
                      </Button>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {brief &&
          (brief.howToTest.fromSource.length > 0 ||
            brief.howToTest.suggested.length > 0) && (
            <Section title="How to test">
              {brief.howToTest.fromSource.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Eyebrow>From the PR</Eyebrow>
                  <ul className="list-disc pl-5 text-sm">
                    {brief.howToTest.fromSource.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              {brief.howToTest.suggested.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Eyebrow>Suggested by Legible</Eyebrow>
                  <ul className="list-disc pl-5 text-sm">
                    {brief.howToTest.suggested.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Section>
          )}
      </div>
    </div>
  )
}
