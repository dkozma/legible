import type { LegibleBridge } from "@legible/ipc"
import { mountApp } from "@legible/ui"
import * as Sentry from "@sentry/electron/renderer"

declare global {
  interface Window {
    legible: LegibleBridge
  }
}

const RENDERER_DROPPED = new Set(["Breadcrumbs", "Console", "BrowserSession"])

// Start Sentry only when the main process has (ADR 0013). Reports go to the main
// process over IPC, which scrubs them and sends them only if they're turned on.
void window.legible.invoke("app.info", {}).then((r) => {
  const info = r.ok
    ? (r.value as { errorReporting?: { available: boolean } })
    : null
  if (!info?.errorReporting?.available) return
  Sentry.init({
    // No click, console or request breadcrumbs, and no usage sessions.
    integrations: (defaults) =>
      defaults.filter((i) => !RENDERER_DROPPED.has(i.name)),
  })
})

mountApp(document.getElementById("root") as HTMLElement, window.legible, {
  onError: (error, componentStack) =>
    Sentry.captureException(error, { extra: { componentStack } }),
})
