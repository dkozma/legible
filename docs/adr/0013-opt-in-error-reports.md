# Opt-in error reports through Sentry

The plans allow "no telemetry; opt-in crash reporting only". Dogfooding showed why reports are worth having: an Explanation failed on the author's machine with an error that didn't reproduce anywhere else, and nothing recorded what led to it. Legible reports errors and crashes to Sentry with `@sentry/electron`, from the main process, the renderer and the agent host.

## When reports are sent

Only a build or run with a Sentry DSN can report at all. The release workflow builds one in from the `SENTRY_DSN` secret, a development build reads `MAIN_VITE_SENTRY_DSN` from `apps/desktop/.env`, and `LEGIBLE_SENTRY_DSN` sets one for a single run. Builds from forks have none.

- **Release builds** send nothing until the user turns on Settings → Privacy → **Send error reports** (`privacy.crashReports`, off by default). Sentry starts before the app is ready, so it can catch startup errors and native crashes. Until the setting has loaded, reports wait in memory (at most 30). They're sent if the setting is on and dropped if it's off (`reportGate.ts`).
- **Development builds**, and any run with `LEGIBLE_SENTRY_DSN`, send reports without the setting: whoever set the DSN opted in. Settings shows "On for this run".

## What a report contains

`scrub.ts` runs on every event, from every process, before it leaves:

- **Kept:** error messages; stack traces in Legible's own code; OS, app and Electron versions; and, for crashes, the minidump.
- **Changed:** the home directory becomes `~`. GitHub, GitLab, Anthropic, Slack and AWS tokens, authorization headers, and credentials in URLs are redacted.
- **Dropped:** the user, IP address, host name and request data.

Integrations that would collect more are off:

- console output;
- outgoing request URLs, which name repositories;
- local variables in stack frames;
- click and navigation breadcrumbs;
- usage sessions (release health);
- screenshots.

Only Electron's lifecycle breadcrumbs and Legible's own `legible` breadcrumbs remain.

**Crash dumps are included.** A minidump is a memory snapshot of the crashed process, so it can contain code that was open. The Settings description says so.

## What Legible reports explicitly

Errors it catches and handles would otherwise never reach Sentry:

- **Failed Explanations** (cancellations aside), tagged with the error code, provider, model, file language and status, and target kind. They come with line counts and duration, never the code, diff or prompt. Setup problems (not signed in, Claude Code missing, the spend cap) are reported as warnings. A fingerprint groups them by error code and message, since the stack is only the main process receiving the agent host's message.
- **IPC handler failures** other than `UserError`, which is an expected answer rather than a bug.
- **React render errors.**

## Consequences

- **Plumbing.** Renderer events reach the main process over Electron IPC (`IPCMode.Classic`). The custom-protocol mode would register a second privileged scheme next to `app://`. Sentry's preload bridge is bundled into Legible's sandboxed preload, which can't `require` packages, instead of injected.
- **Off means off.** The agent host and the renderer start their SDKs only when the main process has started its own, so a build without a DSN runs no Sentry code at all.
- **The README lists Sentry** among the places data can go.
- **Stack traces from the renderer are minified.** Uploading source maps would need a Sentry auth token in CI; it isn't set up yet.
