// Mapping a Walkthrough's Steps onto the Change Set the viewer shows. Steps
// hold their Fragments' line ranges, so they find their chunks whether or not
// whitespace changes are hidden.

import type { DiffChunk, FileChange, Step, Walkthrough } from "@legible/domain"

import type { StepFocus } from "../diff/rows"

type Range = [number, number]

const overlaps = (a: Range | null, b: Range | null) =>
  Boolean(a && b && a[0] <= b[1] && b[0] <= a[1])

function chunkRanges(c: DiffChunk): { base: Range | null; head: Range | null } {
  return {
    base: c.baseEnd > c.baseStart ? [c.baseStart + 1, c.baseEnd] : null,
    head: c.headEnd > c.headStart ? [c.headStart + 1, c.headEnd] : null,
  }
}

/** Whether a Step covers a change chunk of a file. */
export function stepOwns(step: Step, fileId: string, c: DiffChunk): boolean {
  const r = chunkRanges(c)
  return step.fragments.some(
    (f) =>
      f.fileId === fileId &&
      // A Fragment standing for the whole file (a rename, a binary file).
      ((!f.baseRange && !f.headRange) ||
        overlaps(f.headRange, r.head) ||
        overlaps(f.baseRange, r.base)),
  )
}

export function stepNumber(w: Walkthrough, stepId: string): number {
  return w.steps.findIndex((s) => s.id === stepId) + 1
}

export function stepFocus(w: Walkthrough, stepId: string): StepFocus | null {
  const step = w.steps.find((s) => s.id === stepId)
  if (!step) return null
  return {
    fileIds: new Set(step.fragments.map((f) => f.fileId)),
    owns: (fileId, c) => stepOwns(step, fileId, c),
    other: (fileId, c) => {
      const i = w.steps.findIndex((s) => s !== step && stepOwns(s, fileId, c))
      const s = w.steps[i]
      if (!s) return null
      return {
        stepId: s.id,
        label: `Step ${i + 1} · ${s.name}${s.scope === "unrequested" ? " · Unrequested" : ""}`,
        unrequested: s.scope === "unrequested",
      }
    },
  }
}

/** The Step a line of a file belongs to. */
export function stepAt(
  w: Walkthrough,
  file: FileChange,
  side: "base" | "head",
  line: number,
): Step | null {
  return (
    w.steps.find((s) =>
      s.fragments.some((f) => {
        if (f.fileId !== file.id) return false
        const r = side === "head" ? f.headRange : f.baseRange
        return r !== null && r[0] <= line && line <= r[1]
      }),
    ) ?? null
  )
}

/** The Step's earlier Steps the reader hasn't viewed: "you'll need to know". */
export function unseenPrerequisites(
  w: Walkthrough,
  step: Step,
  viewed: ReadonlySet<string>,
): Step[] {
  const pos = new Map(w.steps.map((s, i) => [s.id, i]))
  return step.dependsOn
    .filter((id) => !viewed.has(id))
    .map((id) => w.steps[pos.get(id) ?? -1])
    .filter((s): s is Step => Boolean(s))
}

export function minutes(n: number): string {
  if (n < 60) return `~${n} min`
  const h = Math.floor(n / 60)
  const m = Math.round((n % 60) / 5) * 5
  return m ? `~${h} h ${m} min` : `~${h} h`
}
