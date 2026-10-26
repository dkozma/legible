// utilityProcess entry point for the indexer.

import * as Sentry from "@sentry/electron/utility"

import { ERROR_REPORTS_ARG, UTILITY_DROPPED } from "./errorReportingShared"
import { serveIndexer, type ToIndexer } from "./indexerCore"

// Before any parentPort listener: the SDK filters its own messages out of them.
// Reports go to the main process, which scrubs and gates them (ADR 0013).
if (process.argv.includes(ERROR_REPORTS_ARG))
  Sentry.init({
    integrations: (defaults) =>
      defaults.filter((i) => !UTILITY_DROPPED.has(i.name)),
  })

const port = process.parentPort
const indexer = serveIndexer((m) => port.postMessage(m))
port.on("message", (e) => indexer.handle(e.data as ToIndexer))
process.on("exit", () => indexer.dispose())
