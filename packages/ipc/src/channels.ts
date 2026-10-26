// Channel and event names, with no dependencies, so the sandboxed preload can
// whitelist them without bundling zod.

export const CHANNELS = [
  "app.info",
  "settings.get",
  "settings.save",
  "secrets.status",
  "secrets.set",
  "runtime.status",
  "models.list",
  "repo.pick",
  "repo.inspect",
  "review.open",
  "review.list",
  "review.get",
  "review.delete",
  "review.refresh",
  "review.checkForChanges",
  "review.iterations",
  "changeSet.get",
  "fileDiff.get",
  "viewed.list",
  "viewed.set",
  "reviewState.get",
  "reviewState.set",
  "explain.request",
  "explain.cancel",
  "explain.jobs",
  "explain.history",
  "connections.status",
  "connections.fileSymbols",
  "connections.symbol",
  "connections.at",
  "symbol.source",
  "connections.lookup",
  "spend.summary",
  "editor.open",
  "hosts.list",
  "hosts.connect",
  "hosts.disconnect",
  "link.open",
] as const
export type Channel = (typeof CHANNELS)[number]

export const EVENTS = [
  "job.updated",
  "review.changesAvailable",
  "app.openReview",
  "app.command",
  "app.error",
] as const
export type EventName = (typeof EVENTS)[number]
