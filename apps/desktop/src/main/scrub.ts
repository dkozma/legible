// What error reports may contain (ADR 0013). Legible handles private source
// code, so every event is scrubbed before it leaves the machine: tokens and
// credentials are redacted, the home directory becomes ~, and only Legible's
// own and Electron's lifecycle breadcrumbs are kept. Console output, request
// URLs (which name repositories) and user or host identity never go.

import type { Breadcrumb, ErrorEvent } from "@sentry/electron/main"

/** Breadcrumb categories that describe the app, not the user's code or repositories. */
const BREADCRUMB_CATEGORIES = new Set(["electron", "legible"])

const SECRETS: [RegExp, string][] = [
  // GitHub, GitLab, Anthropic, Slack and AWS key shapes.
  [/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g, "[token]"],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, "[token]"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, "[token]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[token]"],
  // Authorization headers and credentials in URLs.
  [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [token]"],
  [
    /(PRIVATE-TOKEN|x-api-key|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',]+/gi,
    "$1$2[token]",
  ],
  [/(\w+:\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[credentials]@"],
]

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Redacts secrets and replaces the home directory in one string. */
export function scrubString(s: string, home: string | null): string {
  let out = s
  if (home && home.length > 1)
    out = out.replace(new RegExp(escapeRegExp(home), "g"), "~")
  for (const [re, sub] of SECRETS) out = out.replace(re, sub)
  return out
}

/** Applies scrubString to every string in a JSON-like value. */
export function scrubValue<T>(value: T, home: string | null, depth = 0): T {
  if (typeof value === "string") return scrubString(value, home) as T
  if (depth > 12 || value === null || typeof value !== "object") return value
  if (Array.isArray(value))
    return value.map((v) => scrubValue(v, home, depth + 1)) as T
  if (ArrayBuffer.isView(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value))
    out[k] = scrubValue(v, home, depth + 1)
  return out as T
}

export function keepBreadcrumb(b: Breadcrumb): boolean {
  return b.category !== undefined && BREADCRUMB_CATEGORIES.has(b.category)
}

/** The beforeSend step: what's left of an event after scrubbing. */
export function scrubEvent(event: ErrorEvent, home: string | null): ErrorEvent {
  const e = { ...event }
  delete e.user
  delete e.request
  delete e.server_name
  // Renderer and utility-process events arrive with their own breadcrumbs.
  if (e.breadcrumbs) e.breadcrumbs = e.breadcrumbs.filter(keepBreadcrumb)
  return scrubValue(e, home)
}
