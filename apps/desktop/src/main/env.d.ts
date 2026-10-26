// Build-time values electron-vite reads from apps/desktop/.env or the build environment.
interface ImportMetaEnv {
  /** Sentry DSN for opt-in error reports (ADR 0013). Unset in most builds. */
  readonly MAIN_VITE_SENTRY_DSN?: string
  /** "Continue with ChatGPT": the client id OpenAI registers for Legible (ADR 0006). Unset = API key only. */
  readonly MAIN_VITE_CHATGPT_CLIENT_ID?: string
  readonly MAIN_VITE_CHATGPT_ISSUER?: string
  readonly MAIN_VITE_CHATGPT_API_BASE?: string
  readonly MAIN_VITE_CHATGPT_REDIRECT_PORT?: string
}
