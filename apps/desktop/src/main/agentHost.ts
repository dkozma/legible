// utilityProcess entry point for the agent host.

import * as Sentry from "@sentry/electron/utility"

import { createAgentHost, type ToHost } from "./agentHostCore"
import { ERROR_REPORTS_ARG, UTILITY_DROPPED } from "./errorReportingShared"

// Before any parentPort listener: the SDK filters its own messages out of them.
// Reports go to the main process, which scrubs and gates them (ADR 0013).
if (process.argv.includes(ERROR_REPORTS_ARG))
  Sentry.init({
    integrations: (defaults) =>
      defaults.filter((i) => !UTILITY_DROPPED.has(i.name)),
  })

const port = process.parentPort
const host = createAgentHost((m) => port.postMessage(m))
port.on("message", (e) => host.handle(e.data as ToHost))
process.on("exit", () => host.dispose())
