// The typed IPC contract between the sandboxed renderer and the main process.
// Every request is validated with zod in main; the renderer can only name
// domain operations, never arbitrary paths, commands or URLs to fetch.

import {
  type ChangeSetSummary,
  type Explanation,
  type ExplanationJob,
  ExplanationTarget,
  type FileDiff,
  type HostAccount,
  HostKind,
  type Iteration,
  type ModelInfo,
  type ReviewSummary,
  type RuntimeStatus,
  SecretName,
  Settings,
  Source,
  type SpendSummary,
} from "@legible/domain"
import { z } from "zod"

import type { Channel, EventName } from "./channels"

export { CHANNELS, type Channel, EVENTS, type EventName } from "./channels"

const id = z.string().min(1).max(200)

export interface AppInfo {
  version: string
  platform: NodeJS.Platform
  gitVersion: string
  gitOk: boolean
  dataDir: string
}

export interface RepoInspection {
  root: string
  name: string
  branch: string | null
  defaultBase: string | null
  branches: string[]
  remoteUrl: string | null
}

export interface ChangeCheck {
  available: boolean
  detail: string | null
}

export const requests = {
  "app.info": z.object({}),
  "settings.get": z.object({}),
  "settings.save": z.object({ settings: Settings }),
  "secrets.status": z.object({}),
  "secrets.set": z.object({
    name: SecretName,
    value: z.string().max(10_000).nullable(),
  }),
  "runtime.status": z.object({}),
  "models.list": z.object({}),
  "repo.pick": z.object({}),
  "repo.inspect": z.object({ path: z.string().min(1).max(4096) }),
  "review.open": z.object({ source: Source }),
  "review.list": z.object({}),
  "review.get": z.object({ reviewId: id }),
  "review.delete": z.object({ reviewId: id }),
  "review.refresh": z.object({ reviewId: id }),
  "review.checkForChanges": z.object({ reviewId: id }),
  "review.iterations": z.object({ reviewId: id }),
  "changeSet.get": z.object({
    reviewId: id,
    iterationId: id.nullable(),
    ignoreWhitespace: z.boolean(),
  }),
  "fileDiff.get": z.object({
    reviewId: id,
    iterationId: id,
    fileId: id,
    ignoreWhitespace: z.boolean(),
  }),
  "viewed.list": z.object({ reviewId: id }),
  "viewed.set": z.object({
    reviewId: id,
    fileIds: z.array(id).max(10_000),
    viewed: z.boolean(),
  }),
  "reviewState.get": z.object({ reviewId: id }),
  "reviewState.set": z.object({
    reviewId: id,
    state: z.record(z.string(), z.unknown()),
  }),
  "explain.request": z.object({
    reviewId: id,
    iterationId: id,
    target: ExplanationTarget,
    force: z.boolean(),
  }),
  "explain.cancel": z.object({ jobId: id }),
  "explain.jobs": z.object({ reviewId: id }),
  "explain.history": z.object({ reviewId: id }),
  "spend.summary": z.object({ reviewId: id.nullable() }),
  "editor.open": z.object({
    reviewId: id,
    path: z.string().min(1).max(4096),
    line: z.number().int().min(1),
  }),
  "hosts.list": z.object({}),
  "hosts.connect": z.object({
    hostname: z.string().regex(/^[a-z0-9.-]+(:\d+)?$/i),
    kind: HostKind,
    source: z.enum(["gh", "glab", "token"]),
    token: z.string().max(10_000).nullable(),
  }),
  "hosts.disconnect": z.object({ hostname: z.string().min(1).max(255) }),
  "link.open": z.object({ url: z.string().url().max(4096) }),
} as const satisfies Record<Channel, z.ZodType>

export type Req<C extends Channel> = z.infer<(typeof requests)[C]>

export interface Responses {
  "app.info": AppInfo
  "settings.get": Settings
  "settings.save": Settings
  "secrets.status": Record<string, boolean>
  "secrets.set": { ok: true }
  "runtime.status": RuntimeStatus
  "models.list": ModelInfo[]
  "repo.pick": { path: string | null }
  "repo.inspect": RepoInspection
  "review.open": ReviewSummary
  "review.list": ReviewSummary[]
  "review.get": ReviewSummary
  "review.delete": { ok: true }
  "review.refresh": Iteration
  "review.checkForChanges": ChangeCheck
  "review.iterations": Iteration[]
  "changeSet.get": ChangeSetSummary
  "fileDiff.get": FileDiff
  "viewed.list": string[]
  "viewed.set": { ok: true }
  "reviewState.get": Record<string, unknown> | null
  "reviewState.set": { ok: true }
  "explain.request": ExplanationJob
  "explain.cancel": { ok: true }
  "explain.jobs": ExplanationJob[]
  "explain.history": Explanation[]
  "spend.summary": SpendSummary
  "editor.open": { ok: boolean; error: string | null }
  "hosts.list": HostAccount[]
  "hosts.connect": HostAccount
  "hosts.disconnect": { ok: true }
  "link.open": { ok: boolean }
}

export interface Events extends Record<EventName, unknown> {
  "job.updated": ExplanationJob
  "review.changesAvailable": { reviewId: string; detail: string }
  "app.openReview": { reviewId: string }
  "app.command": { command: string }
  "app.error": { message: string }
}

/** Errors cross IPC as plain objects; this is their shape. */
export interface IpcErrorShape {
  message: string
  code: string | null
}

/** What preload exposes on `window.legible`. */
export interface LegibleBridge {
  invoke(
    channel: string,
    payload: unknown,
  ): Promise<{ ok: true; value: unknown } | { ok: false; error: IpcErrorShape }>
  on(event: string, listener: (payload: unknown) => void): () => void
  platform: string
}
