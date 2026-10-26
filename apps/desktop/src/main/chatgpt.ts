// "Continue with ChatGPT" (ADR 0006): OpenAI's sign-in for open-source apps,
// an OIDC authorization-code flow with PKCE and a loopback redirect. There is
// no client secret. Tokens live only in the keychain (SecretStore) and are
// used only for the Responses API requests the program allows.
//
// It needs a client id OpenAI registers for Legible. Builds without one
// (MAIN_VITE_CHATGPT_CLIENT_ID) offer only the API key, and say so.

import { createHash, randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"

import type { SecretStore } from "./secrets"

const SECRET = "chatgpt-tokens"
const SCOPE = "openid profile email offline_access"
/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 5 * 60_000
const SIGN_IN_TIMEOUT_MS = 5 * 60_000

export interface ChatGPTConfig {
  clientId: string
  issuer: string
  /** Where plan-backed Responses API requests go. */
  apiBase: string
  /** 0 picks a free port; set it when the registration fixes the redirect URI. */
  redirectPort: number
}

export function chatgptConfig(): ChatGPTConfig | null {
  const env = import.meta.env
  const clientId =
    process.env.LEGIBLE_CHATGPT_CLIENT_ID || env.MAIN_VITE_CHATGPT_CLIENT_ID
  if (!clientId) return null
  return {
    clientId,
    issuer: env.MAIN_VITE_CHATGPT_ISSUER || "https://auth.openai.com",
    apiBase: env.MAIN_VITE_CHATGPT_API_BASE || "https://api.openai.com/v1",
    redirectPort: Number(env.MAIN_VITE_CHATGPT_REDIRECT_PORT) || 0,
  }
}

interface Tokens {
  accessToken: string
  refreshToken: string | null
  idToken: string | null
  expiresAt: number
}

export interface ChatGPTAccount {
  /** This build can sign in with ChatGPT. */
  available: boolean
  signedIn: boolean
  email: string | null
  plan: string | null
}

const b64url = (b: Buffer) => b.toString("base64url")

/** Claims from an id token, for display only; the token itself is never trusted for anything else. */
function claims(idToken: string | null): Record<string, unknown> {
  if (!idToken) return {}
  try {
    return JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as Record<string, unknown>
  } catch {
    return {}
  }
}

function accountOf(idToken: string | null) {
  const c = claims(idToken)
  const auth = (c["https://api.openai.com/auth"] ?? {}) as Record<
    string,
    unknown
  >
  return {
    email: typeof c.email === "string" ? c.email : null,
    accountId:
      typeof auth.chatgpt_account_id === "string"
        ? auth.chatgpt_account_id
        : null,
    plan:
      typeof auth.chatgpt_plan_type === "string"
        ? auth.chatgpt_plan_type
        : null,
  }
}

export class ChatGPTAuth {
  private refreshing: Promise<Tokens | null> | null = null

  constructor(
    private readonly secrets: SecretStore,
    private readonly config: ChatGPTConfig | null,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private load(): Tokens | null {
    const raw = this.secrets.get(SECRET)
    if (!raw) return null
    try {
      return JSON.parse(raw) as Tokens
    } catch {
      return null
    }
  }

  account(): ChatGPTAccount {
    const t = this.load()
    const a = accountOf(t?.idToken ?? null)
    return {
      available: this.config !== null,
      signedIn: Boolean(t),
      email: a.email,
      plan: a.plan,
    }
  }

  private async token(
    body: Record<string, string>,
    previous: Tokens | null,
  ): Promise<Tokens> {
    const c = this.config as ChatGPTConfig
    const res = await this.fetchImpl(`${c.issuer}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.clientId, ...body }).toString(),
    })
    if (!res.ok)
      throw new Error(
        `ChatGPT sign-in failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
      )
    const j = (await res.json()) as {
      access_token: string
      refresh_token?: string
      id_token?: string
      expires_in?: number
    }
    const tokens: Tokens = {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? previous?.refreshToken ?? null,
      idToken: j.id_token ?? previous?.idToken ?? null,
      expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
    }
    await this.secrets.set(SECRET, JSON.stringify(tokens))
    return tokens
  }

  /** Opens the browser to sign in and waits for the loopback redirect. */
  async signIn(): Promise<ChatGPTAccount> {
    const c = this.config
    if (!c)
      throw new Error(
        "This build of Legible can't sign in with ChatGPT yet. Use an OpenAI API key.",
      )
    const verifier = b64url(randomBytes(32))
    const challenge = b64url(createHash("sha256").update(verifier).digest())
    const state = b64url(randomBytes(16))
    let server: Server | null = null
    try {
      const { code, redirectUri } = await new Promise<{
        code: string
        redirectUri: string
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("ChatGPT sign-in timed out.")),
          SIGN_IN_TIMEOUT_MS,
        )
        let callback = ""
        server = createServer((req, res) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1")
          if (url.pathname !== "/auth/callback") {
            res.writeHead(404).end()
            return
          }
          const ok =
            url.searchParams.get("state") === state &&
            url.searchParams.get("code")
          res
            .writeHead(ok ? 200 : 400, { "Content-Type": "text/plain" })
            .end(
              ok
                ? "Signed in. You can close this tab and return to Legible."
                : "Sign-in failed. Return to Legible and try again.",
            )
          clearTimeout(timer)
          if (ok) resolve({ code: ok, redirectUri: callback })
          else
            reject(
              new Error(
                url.searchParams.get("error_description") ??
                  "ChatGPT sign-in was cancelled.",
              ),
            )
        })
        server.listen(c.redirectPort, "127.0.0.1", () => {
          const addr = server?.address()
          const port = typeof addr === "object" && addr ? addr.port : 0
          callback = `http://127.0.0.1:${port}/auth/callback`
          const authorize = new URL(`${c.issuer}/oauth/authorize`)
          for (const [k, v] of Object.entries({
            response_type: "code",
            client_id: c.clientId,
            redirect_uri: callback,
            scope: SCOPE,
            code_challenge: challenge,
            code_challenge_method: "S256",
            state,
          }))
            authorize.searchParams.set(k, v)
          this.openExternal(authorize.toString()).catch(reject)
        })
        server.on("error", reject)
      })
      await this.token(
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        },
        null,
      )
      return this.account()
    } finally {
      ;(server as Server | null)?.close()
    }
  }

  async signOut() {
    await this.secrets.set(SECRET, null)
  }

  /** A current access token, refreshed when it's about to expire; null when signed out. */
  async current(): Promise<{
    accessToken: string
    accountId: string | null
    baseURL: string
    expiresAt: number
  } | null> {
    if (!this.config) return null
    let t = this.load()
    if (!t) return null
    if (t.expiresAt - Date.now() < REFRESH_MARGIN_MS && t.refreshToken) {
      this.refreshing ??= this.token(
        { grant_type: "refresh_token", refresh_token: t.refreshToken },
        t,
      )
        .catch(() => null)
        .finally(() => (this.refreshing = null))
      t = (await this.refreshing) ?? t
    }
    return {
      accessToken: t.accessToken,
      accountId: accountOf(t.idToken).accountId,
      baseURL: this.config.apiBase,
      expiresAt: t.expiresAt,
    }
  }
}
