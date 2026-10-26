// Build-time values electron-vite reads from apps/desktop/.env or the build environment.
interface ImportMetaEnv {
  /** Sentry DSN for opt-in error reports (ADR 0013). Unset in most builds. */
  readonly MAIN_VITE_SENTRY_DSN?: string
}
