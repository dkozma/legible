import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  DEFAULT_SETTINGS,
  type Explanation,
  type Intent,
  type Walkthrough,
} from "@legible/domain"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { Store } from "../src/index"

let dir: string
let store: Store

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "legible-store-"))
  store = new Store(join(dir, "legible.db"))
})

afterEach(async () => {
  await store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe("Store", () => {
  it("migrates idempotently", async () => {
    await store.close()
    store = new Store(join(dir, "legible.db"))
    expect(await store.listReviews()).toEqual([])
  })

  it("round-trips settings and fills defaults for new keys", async () => {
    expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS)
    const s = { ...DEFAULT_SETTINGS, theme: "light" as const }
    await store.saveSettings(s)
    expect((await store.getSettings()).theme).toBe("light")
  })

  it("creates Reviews with Iterations and finds them again", async () => {
    const repo = await store.upsertRepo({
      displayName: "storefront",
      gitDir: "/x/.git",
      workTree: "/x",
      remoteUrl: null,
      host: null,
    })
    const again = await store.upsertRepo({
      displayName: "storefront",
      gitDir: "/x/.git",
      workTree: "/x",
      remoteUrl: null,
      host: null,
    })
    expect(again.id).toBe(repo.id)

    const review = await store.createReview({
      repoId: repo.id,
      title: "feature/partial-refunds",
      sourceKind: "working_tree",
      baseRef: "main",
      headRef: null,
      prUrl: null,
      prNumber: null,
      mode: "author",
      intentText: null,
    })
    const i1 = await store.addIteration({
      reviewId: review.id,
      kind: "snapshot",
      baseSha: "a",
      headSha: "b",
      headTree: "t1",
    })
    const i2 = await store.addIteration({
      reviewId: review.id,
      kind: "snapshot",
      baseSha: "a",
      headSha: "c",
      headTree: "t2",
    })
    expect([i1.seq, i2.seq]).toEqual([1, 2])
    // Concurrent adds get distinct seqs instead of racing for the same one.
    const both = await Promise.all([
      store.addIteration({
        reviewId: review.id,
        kind: "snapshot",
        baseSha: "a",
        headSha: "d",
        headTree: "t3",
      }),
      store.addIteration({
        reviewId: review.id,
        kind: "snapshot",
        baseSha: "a",
        headSha: "c",
        headTree: "t2",
      }),
    ])
    expect(both.map((i) => i.seq).toSorted((a, b) => a - b)).toEqual([3, 4])

    const found = await store.findReview({
      repoId: repo.id,
      sourceKind: "working_tree",
      baseRef: "main",
      headRef: null,
      prUrl: null,
    })
    expect(found?.id).toBe(review.id)
    const summary = await store.getReview(review.id)
    expect(summary?.latestIteration?.seq).toBe(4)
    expect(summary?.repo.displayName).toBe("storefront")
  })

  it("tracks viewed files, Explanations and spend", async () => {
    const repo = await store.upsertRepo({
      displayName: "r",
      gitDir: "/r/.git",
      workTree: "/r",
      remoteUrl: null,
      host: null,
    })
    const review = await store.createReview({
      repoId: repo.id,
      title: "t",
      sourceKind: "refs",
      baseRef: "main",
      headRef: "f",
      prUrl: null,
      prNumber: null,
      mode: "author",
      intentText: null,
    })
    await store.setViewed(review.id, ["f1", "f2"], true)
    await store.setViewed(review.id, ["f1"], true)
    await store.setViewed(review.id, ["f2"], false)
    expect(await store.viewedFiles(review.id)).toEqual(["f1"])

    const e: Explanation = {
      id: "e1",
      cacheKey: "k1",
      target: { kind: "file", fileId: "f1", path: "a.ts", oldPath: null },
      label: "a.ts",
      body: { before: null, after: "Adds a.", whatChanged: [], watchOut: [] },
      provider: "anthropic",
      model: "claude-haiku-5-5",
      tier: "fast",
      promptVersion: "v1",
      costUsd: 0.01,
      durationMs: 1200,
      createdAt: new Date().toISOString(),
      cached: false,
    }
    await store.saveExplanation(e, review.id)
    expect((await store.getExplanation("k1"))?.body.after).toBe("Adds a.")
    expect(await store.listExplanations(review.id)).toHaveLength(1)

    await store.recordRun({
      id: "r1",
      reviewId: review.id,
      taskKind: "explanation",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      tier: "fast",
      startedAt: new Date().toISOString(),
      endedAt: null,
      costUsd: 0.02,
      inputTokens: 100,
      outputTokens: 50,
      status: "done",
      error: null,
    })
    const spend = await store.spend(
      review.id,
      new Date(Date.now() - 86_400_000),
    )
    expect(spend.reviewUsd).toBeCloseTo(0.02)
    expect(spend.monthByProvider.anthropic).toBeCloseTo(0.02)
    expect(spend.runsThisMonth).toBe(1)
  })
  it("keeps Intents, Walkthroughs, Briefs, viewed Steps and judgments", async () => {
    const repo = await store.upsertRepo({
      displayName: "r",
      gitDir: "/w/.git",
      workTree: "/w",
      remoteUrl: null,
      host: null,
    })
    const review = await store.createReview({
      repoId: repo.id,
      title: "t",
      sourceKind: "refs",
      baseRef: "main",
      headRef: "f",
      prUrl: null,
      prNumber: null,
      mode: "author",
      intentText: null,
    })
    const i1 = await store.addIteration({
      reviewId: review.id,
      kind: "refs",
      baseSha: "a",
      headSha: "b",
      headTree: null,
    })
    const i2 = await store.addIteration({
      reviewId: review.id,
      kind: "refs",
      baseSha: "a",
      headSha: "c",
      headTree: null,
    })

    const intent: Intent = {
      reviewId: review.id,
      goal: "Partial refunds",
      requirements: [{ id: "R1", statement: "Refund part of an order" }],
      sources: [{ kind: "user", label: "Your words", ref: null }],
      inferred: false,
      confirmed: true,
      corrections: [],
      howToTest: [],
      provider: null,
      model: null,
      updatedAt: new Date().toISOString(),
    }
    await store.saveIntent(intent)
    await store.saveIntent({ ...intent, goal: "Partial refunds, 60 days" })
    expect((await store.getIntent(review.id))?.goal).toBe(
      "Partial refunds, 60 days",
    )

    await store.setTranscriptChoice(review.id, "claude-code:s1", false)
    await store.setTranscriptChoice(review.id, "claude-code:s1", true)
    expect(
      (await store.transcriptChoices(review.id)).get("claude-code:s1"),
    ).toBe(true)

    const w = (iterationId: string): Walkthrough => ({
      reviewId: review.id,
      iterationId,
      steps: [],
      chapters: [],
      sittings: [],
      edges: [],
      validation: {
        fragments: 0,
        repairedMissing: 0,
        removedDuplicates: 0,
        dependencyViolations: 0,
        cycles: 0,
      },
      provider: "anthropic",
      model: "m",
      promptVersion: iterationId,
      costUsd: 0,
      createdAt: new Date().toISOString(),
    })
    await store.saveWalkthrough(w(i1.id))
    await store.saveWalkthrough(w(i2.id))
    expect((await store.getWalkthrough(review.id, i2.id))?.iterationId).toBe(
      i2.id,
    )
    expect(
      (await store.previousWalkthrough(review.id, i2.seq))?.iterationId,
    ).toBe(i1.id)
    await store.clearUnderstanding(review.id, i2.id)
    expect(await store.getWalkthrough(review.id, i2.id)).toBeNull()

    await store.setStepsViewed(review.id, ["s1", "s2"], true)
    await store.setStepsViewed(review.id, ["s1"], false)
    expect(await store.viewedSteps(review.id)).toEqual(["s2"])

    await store.saveJudgment("j1", "fast", "m", [{ p: 0.9 }])
    expect((await store.getJudgment("j1"))?.answers).toEqual([{ p: 0.9 }])
  })
})
