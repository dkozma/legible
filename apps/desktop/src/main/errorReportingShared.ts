// Shared by the main process and the agent host, which can't import Electron's main-process modules.

/** Passed to the agent host when the main process has started error reporting. */
export const ERROR_REPORTS_ARG = "--legible-error-reports"

/** Integrations that would collect console output, request URLs or local variables. */
export const UTILITY_DROPPED = new Set([
  "Console",
  "NodeFetch",
  "LocalVariables",
  "LocalVariablesAsync",
])
