// Opt-in error and crash reports through Sentry (ADR 0013).
//
// Reporting exists only in a build or run that has a DSN: the release
// workflow builds one in, a development build reads `MAIN_VITE_SENTRY_DSN`
// from apps/desktop/.env, and `LEGIBLE_SENTRY_DSN` sets one for a single run.
// With a DSN from the environment, or in a development build, reports are on:
// the developer opted in by setting it. A release build sends nothing until
// Settings → Privacy → "Send error reports" is on.
//
// Sentry starts before the app is ready so it can catch startup errors and
// native crashes. Until the setting has loaded, reports wait in memory; they're
// sent once it says yes, and dropped if it says no.

import { homedir } from "node:os"

import * as Sentry from "@sentry/electron/main"
import { app } from "electron"

import { UTILITY_DROPPED } from "./errorReportingShared"
import { createReportGate } from "./reportGate"
import { keepBreadcrumb, scrubEvent, scrubString } from "./scrub"

/** Integrations that would send what Legible promises not to: console output, request URLs, local variables, usage sessions, screenshots. */
const DROPPED = new Set([
  ...UTILITY_DROPPED,
  "ElectronNet",
  "MainProcessSession",
  "Screenshots",
  // The preload bridge is bundled into Legible's own sandboxed preload instead.
  "PreloadInjection",
])

let forced = false
let initialized = false
type Transport = ReturnType<
  ReturnType<typeof Sentry.makeElectronOfflineTransport>
>
const gate = createReportGate<
  Parameters<Transport["send"]>[0],
  Awaited<ReturnType<Transport["send"]>>
>({})

/** Starts Sentry if this build or run has a DSN. Call before the app is ready. */
export function initErrorReporting() {
  const runtimeDsn = process.env.LEGIBLE_SENTRY_DSN
  const dsn = runtimeDsn || import.meta.env.MAIN_VITE_SENTRY_DSN
  if (!dsn) return
  forced = Boolean(runtimeDsn) || !app.isPackaged
  if (forced) gate.set(true)
  const home = homedir()
  Sentry.init({
    dsn,
    // Renderer events come over Electron IPC; the custom-protocol mode would
    // also register a privileged scheme next to Legible's own app://.
    ipcMode: Sentry.IPCMode.Classic,
    dataCollection: { userInfo: false },
    integrations: (defaults) => defaults.filter((i) => !DROPPED.has(i.name)),
    transport: gate.wrap(Sentry.makeElectronOfflineTransport()),
    beforeSend: (event) => scrubEvent(event, home),
    beforeBreadcrumb: (b) => {
      if (!keepBreadcrumb(b)) return null
      return b.message ? { ...b, message: scrubString(b.message, home) } : b
    },
    maxBreadcrumbs: 50,
  })
  initialized = true
}

/** Applies Settings → Privacy. No effect when the environment turned reports on. */
export function setErrorReportingEnabled(enabled: boolean) {
  if (!initialized || forced) return
  gate.set(enabled)
}

export function errorReportingInfo() {
  return { available: initialized, forced }
}

/** Whether other processes should start their SDK: only once the main process has. */
export function errorReportingActive() {
  return initialized
}

export interface ReportContext {
  level?: "warning" | "error"

  /** Short, low-cardinality values to search and group by. */
  tags?: Record<string, string | number | boolean | null | undefined>
  /** Structured details. Never code, diffs, prompts or Explanation text. */
  extra?: Record<string, unknown>
  /** Groups reports that are the same problem, when the stack can't (errors from another process). */
  fingerprint?: string[]
}

/** Reports an error Legible caught and handled, such as a failed Explanation. */
export function reportError(error: unknown, context: ReportContext = {}) {
  if (!initialized) return
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(context.tags ?? {}))
      if (v !== undefined && v !== null) scope.setTag(k, String(v))
    if (context.extra) scope.setExtras(context.extra)
    if (context.fingerprint) scope.setFingerprint(context.fingerprint)
    if (context.level) scope.setLevel(context.level)
    Sentry.captureException(error)
  })
}

/** Records a step for later reports. Messages are scrubbed; keep them free of code and repository names. */
export function breadcrumb(
  message: string,
  data?: Record<string, string | number | boolean>,
) {
  if (initialized) Sentry.addBreadcrumb({ category: "legible", message, data })
}
