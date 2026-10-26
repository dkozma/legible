// The Step being read, above its diff: where it sits in the Walkthrough, its
// Scope, Risk and narrative, what to read first, and the user's edits.

import {
  type Intent,
  LAYER_LABEL,
  type Step,
  type StepEdit,
  type Walkthrough,
} from "@legible/domain"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Combine,
  Pencil,
  Scissors,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Badge, Button, Input, Kbd, Select } from "../components/ui"
import { RISK_TEXT, RiskBars, SCOPE_TEXT, ScopeMark } from "./marks"
import { unseenPrerequisites } from "./steps"

const fragLabel = (f: Step["fragments"][number]) => {
  const r = f.headRange ?? f.baseRange
  const file = f.path.split("/").pop() ?? f.path
  return r ? `${file}:${r[0]}–${r[1]}` : file
}

export function StepHeader({
  walkthrough: w,
  step,
  intent,
  viewed,
  onToggleViewed,
  onOpen,
  onEdit,
}: {
  walkthrough: Walkthrough
  step: Step
  intent: Intent | null
  viewed: ReadonlySet<string>
  onToggleViewed: () => void
  onOpen: (stepId: string) => void
  onEdit: (edit: StepEdit) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const isRenaming = renaming !== null
  useEffect(() => {
    if (isRenaming) nameRef.current?.select()
  }, [isRenaming])
  const [editing, setEditing] = useState(false)
  const i = w.steps.findIndex((s) => s.id === step.id)
  const prev = w.steps[i - 1]
  const next = w.steps[i + 1]
  const before = unseenPrerequisites(w, step, viewed)
  const seen = viewed.has(step.id)
  const reqs = step.requirementIds
    .map((id) => intent?.requirements.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))

  return (
    <div
      className="flex shrink-0 flex-col gap-2 border-b px-4 py-3"
      data-testid="step-header"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Step {i + 1} of {w.steps.length}
        </span>
        <span className="text-xs text-dim">· {LAYER_LABEL[step.layer]}</span>
        <span className="grow" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Previous Step"
          title="Previous Step (p)"
          disabled={!prev}
          onClick={() => prev && onOpen(prev.id)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Next Step"
          title="Next Step (n)"
          disabled={!next}
          onClick={() => next && onOpen(next.id)}
        >
          <ChevronRight />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {renaming !== null ? (
          <form
            className="flex grow items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (renaming.trim())
                onEdit({ kind: "rename", stepId: step.id, name: renaming })
              setRenaming(null)
            }}
          >
            <Input
              ref={nameRef}
              aria-label="Step name"
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
              className="h-7 grow"
            />
            <Button size="sm" type="submit">
              Rename
            </Button>
          </form>
        ) : (
          <h2 className="text-base font-semibold">{step.name}</h2>
        )}
        {step.scope && (
          <Badge
            tone={step.scope === "unrequested" ? "unrequested" : "outline"}
          >
            <ScopeMark scope={step.scope} likely={step.scopeLikely} />
            {step.scopeLikely ? "Likely " : ""}
            {SCOPE_TEXT[step.scope]}
          </Badge>
        )}
        {step.risk.level !== "low" && (
          <Badge tone={step.risk.level}>
            <RiskBars risk={step.risk} />
            {RISK_TEXT[step.risk.level]}
            {step.risk.reasons.length
              ? ` · ${step.risk.reasons.join(", ")}`
              : ""}
          </Badge>
        )}
        {reqs.map((r) => (
          <Badge key={r.id} tone="muted" title={r.statement}>
            {r.id}
          </Badge>
        ))}
        <span className="grow" />
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
        >
          <Pencil />
          Edit
        </Button>
        <Button
          variant={seen ? "outline" : "default"}
          size="sm"
          onClick={onToggleViewed}
          data-testid="mark-step-viewed"
        >
          <Check />
          {seen ? "Viewed" : "Mark viewed"}
          <Kbd keys={["v"]} />
        </Button>
      </div>

      {step.narrative && (
        <p className="max-w-[72ch] text-sm text-muted-foreground">
          {step.narrative}
        </p>
      )}

      {before.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>You'll need to know:</span>
          {before.map((s) => (
            <Button
              key={s.id}
              variant="outline"
              size="xs"
              onClick={() => onOpen(s.id)}
            >
              Step {w.steps.indexOf(s) + 1} · {s.name}
            </Button>
          ))}
        </div>
      )}

      {editing && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-inset px-2 py-1.5">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setRenaming(step.name)}
          >
            <Pencil />
            Rename
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={!next}
            onClick={() =>
              next &&
              onEdit({ kind: "merge", stepId: step.id, otherId: next.id })
            }
          >
            <Combine />
            Merge with next
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={!prev}
            onClick={() =>
              onEdit({ kind: "move", stepId: step.id, direction: "up" })
            }
          >
            <ArrowUp />
            Move up
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={!next}
            onClick={() =>
              onEdit({ kind: "move", stepId: step.id, direction: "down" })
            }
          >
            <ArrowDown />
            Move down
          </Button>
          {step.fragments.length > 1 && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Scissors className="size-3" />
              Split before
              <Select
                className="h-6 text-xs"
                aria-label="Split before"
                value=""
                onChange={(e) =>
                  e.target.value &&
                  onEdit({
                    kind: "split",
                    stepId: step.id,
                    fragmentId: e.target.value,
                  })
                }
              >
                <option value="">a change…</option>
                {step.fragments.slice(1).map((f) => (
                  <option key={f.fragmentId} value={f.fragmentId}>
                    {fragLabel(f)}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
