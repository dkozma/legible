import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { DEFAULT_SETTINGS, type UnderstandingStatus } from "@legible/domain"
import { Store } from "@legible/store"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  AgentHostClient,
  inProcessTransport,
} from "../src/main/agentHostClient"
import { inProcessIndexer } from "../src/main/indexerClient"
import { ReviewService } from "../src/main/reviews"
import { UnderstandingService } from "../src/main/understanding"

let dir: string
let store: Store
let reviews: ReviewService
let host: AgentHostClient
let understanding: UnderstandingService
const updates: UnderstandingStatus[] = []
const settings = {
  ...DEFAULT_SETTINGS,
  // Never read this machine's real agent sessions in a test.
  intent: { readTranscripts: false },
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "legible-understanding-"))
  execFileSync("node", [
    resolve(__dirname, "../../../fixtures/make-refund-repo.mjs"),
    join(dir, "repo"),
  ])
  store = new Store(join(dir, "db.sqlite"))
  const indexer = inProcessIndexer({ cacheDir: null, grammarsDir: null })
  const hosts = { token: async () => null } as never
  reviews = new ReviewService(
    store,
    hosts,
    indexer,
    join(dir, "repos"),
    () => undefined,
  )
  host = new AgentHostClient(inProcessTransport)
  host.configure({
    claude: null,
    openai: null,
    tiers: DEFAULT_SETTINGS.tiers,
    tasks: {},
    concurrency: 4,
    judge: [],
    fake: "answer",
  })
  understanding = new UnderstandingService(
    store,
    reviews,
    indexer,
    host,
    hosts,
    async () => settings,
    (s) => updates.push(s),
  )
})

afterAll(async () => {
  host.dispose()
  reviews.dispose()
  await store.close()
  rmSync(dir, { recursive: true, force: true })
})

async function settle(reviewId: string, iterationId: string) {
  for (let i = 0; i < 200; i++) {
    const s = await understanding.status(reviewId, iterationId)
    if (s.state !== "running") return s
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("Understanding didn't finish")
}

describe("UnderstandingService", () => {
  it("builds the Intent, Walkthrough and Brief, then follows the user's edits", async () => {
    const review = await reviews.open({
      kind: "working_tree",
      repoPath: join(dir, "repo"),
      baseRef: null,
    })
    const iterationId = review.latestIteration?.id as string
    await understanding.run(review.id, iterationId, "none")
    const done = await settle(review.id, iterationId)
    expect(done.error).toBeNull()
    expect(updates.some((u) => u.stages.walkthrough.state === "running")).toBe(
      true,
    )

    // No Pull Request and no transcripts: an Inferred Intent, for the user to confirm.
    const intent = await store.getIntent(review.id)
    expect(intent).toMatchObject({ inferred: true, confirmed: false })
    expect(intent?.requirements.map((r) => r.id)).toEqual(["R1", "R2"])

    const w = await store.getWalkthrough(review.id, iterationId)
    const built = await reviews.built(review.id, iterationId, false)
    const all = built.summary.files.flatMap((f) =>
      f.fragments.length ? f.fragments.map((x) => x.id) : [`file:${f.id}`],
    )
    expect(
      w?.steps.flatMap((s) => s.fragments.map((f) => f.fragmentId)).toSorted(),
    ).toEqual(all.toSorted())
    expect(w?.validation.dependencyViolations).toBe(0)
    // The test file joined the Step of the code it tests.
    const serviceStep = w?.steps.find((s) =>
      s.fragments.some((f) => f.path === "src/refunds/RefundService.ts"),
    )
    expect(
      serviceStep?.fragments.some(
        (f) => f.path === "src/refunds/RefundService.test.ts",
      ),
    ).toBe(true)
    // Scope waits for a confirmed Intent; Risk doesn't.
    expect(w?.steps.every((s) => s.scope === null)).toBe(true)
    expect(serviceStep?.risk.level).not.toBe("low")

    const brief = await store.getBrief(review.id, iterationId)
    expect(brief?.domainChanges.length).toBeGreaterThan(0)
    expect(brief?.descriptionGap).toBeNull()
    expect(brief?.components[0]?.layer).toBe("data_model")

    // Confirming the Intent tags Scope.
    await understanding.confirmIntent(review.id)
    await understanding.run(review.id, iterationId, "brief")
    await settle(review.id, iterationId)
    const scoped = await store.getWalkthrough(review.id, iterationId)
    expect(scoped?.steps.every((s) => s.scope !== null)).toBe(true)
    expect(scoped?.steps.some((s) => s.scope === "unrequested")).toBe(true)

    // Editing Steps keeps the Brief pointing at real Steps.
    const [a, b] = scoped?.steps ?? []
    const edited = await understanding.editStep(review.id, iterationId, {
      kind: "rename",
      stepId: a?.id as string,
      name: "Schema",
    })
    expect(edited.steps[0]?.name).toBe("Schema")
    const merged = await understanding.editStep(review.id, iterationId, {
      kind: "merge",
      stepId: a?.id as string,
      otherId: b?.id as string,
    })
    const ids = new Set(merged.steps.map((s) => s.id))
    const relinked = await store.getBrief(review.id, iterationId)
    expect(
      relinked?.domainChanges.every((d) =>
        d.stepIds.every((id) => ids.has(id)),
      ),
    ).toBe(true)

    // A later Iteration with the same code keeps the Steps.
    const next = await store.addIteration({
      reviewId: review.id,
      kind: "refs",
      baseSha: built.summary.baseSha,
      headSha: built.summary.headSha,
      headTree: null,
    })
    await understanding.run(review.id, next.id, "none")
    await settle(review.id, next.id)
    const again = await store.getWalkthrough(review.id, next.id)
    expect(again?.steps.map((s) => s.id)).toEqual(merged.steps.map((s) => s.id))
  })

  it("asks no model for the Intent the user wrote", async () => {
    const [review] = await store.listReviews()
    const saved = await understanding.saveIntent(review?.id as string, {
      goal: "Partial refunds only",
      requirements: [{ id: "x", statement: "Refund part of an order" }],
    })
    expect(saved).toMatchObject({
      confirmed: true,
      sourceKey: null,
      requirements: [{ id: "R1", statement: "Refund part of an order" }],
    })
    expect(saved.sources.some((s) => s.kind === "user")).toBe(true)
  })
})
