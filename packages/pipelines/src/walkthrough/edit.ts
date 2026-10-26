// The user's edits to a Walkthrough: rename, merge, split, move a Fragment,
// move a Step. Edits keep the user's order unless a dependency forbids it; a
// move that would put a Step before what it builds on is refused.

import type { StepEdit, Walkthrough } from "@legible/domain"

import { type Draft, finishWalkthrough, toDrafts } from "./assemble"

export class EditError extends Error {}

export function editWalkthrough(w: Walkthrough, edit: StepEdit): Walkthrough {
  const drafts = toDrafts(w)
  const at = (id: string) => {
    const i = w.steps.findIndex((s) => s.id === id)
    if (i < 0) throw new EditError("That Step isn't in this Walkthrough.")
    return i
  }
  const touch = (d: Draft) => {
    d.userEdited = true
    d.kept = d.kept ? { ...d.kept, userEdited: true } : null
  }

  switch (edit.kind) {
    case "rename": {
      const d = drafts[at(edit.stepId)] as Draft
      d.name = edit.name.trim()
      touch(d)
      break
    }
    case "merge": {
      const d = drafts[at(edit.stepId)] as Draft
      const other = drafts[at(edit.otherId)] as Draft
      if (d === other) throw new EditError("Pick another Step to merge.")
      d.fragments = [...d.fragments, ...other.fragments]
      d.narrative = [d.narrative, other.narrative].filter(Boolean).join(" ")
      other.fragments = []
      touch(d)
      break
    }
    case "split": {
      const i = at(edit.stepId)
      const d = drafts[i] as Draft
      const k = d.fragments.findIndex((f) => f.fragmentId === edit.fragmentId)
      if (k <= 0)
        throw new EditError("Split a Step at one of its later Fragments.")
      const tail: Draft = {
        ...d,
        name: `${d.name} (continued)`,
        fragments: d.fragments.slice(k),
        priority: d.priority + 0.5,
        kept: null,
        userEdited: true,
      }
      d.fragments = d.fragments.slice(0, k)
      touch(d)
      drafts.splice(i + 1, 0, tail)
      break
    }
    case "moveFragment": {
      const from = drafts.find((d) =>
        d.fragments.some((f) => f.fragmentId === edit.fragmentId),
      )
      const to = drafts[at(edit.toStepId)] as Draft
      if (!from) throw new EditError("That Fragment isn't in a Step.")
      if (from === to) return w
      const frag = from.fragments.find((f) => f.fragmentId === edit.fragmentId)
      from.fragments = from.fragments.filter(
        (f) => f.fragmentId !== edit.fragmentId,
      )
      if (frag) to.fragments.push(frag)
      touch(from)
      touch(to)
      break
    }
    case "move": {
      const i = at(edit.stepId)
      const j = edit.direction === "up" ? i - 1 : i + 1
      const a = w.steps[i]
      const b = w.steps[j]
      if (!a || !b) return w
      const [first, second] = edit.direction === "up" ? [a, b] : [b, a]
      // `first` would come before `second`: refused if it builds on it.
      if (first.dependsOn.includes(second.id))
        throw new EditError(
          `“${first.name}” builds on “${second.name}”, so it has to come after it.`,
        )
      if (a.chapterId !== b.chapterId)
        throw new EditError("Steps move within their Chapter.")
      const da = drafts[i] as Draft
      const db = drafts[j] as Draft
      ;[da.priority, db.priority] = [db.priority, da.priority]
      touch(da)
      break
    }
  }
  drafts.sort((a, b) => a.priority - b.priority)
  drafts.forEach((d, i) => (d.priority = i))
  const next = finishWalkthrough(drafts, w.edges, w)
  next.validation = {
    ...next.validation,
    repairedMissing: w.validation.repairedMissing,
    removedDuplicates: w.validation.removedDuplicates,
  }
  return next
}
