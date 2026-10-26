// Host accounts: which token to use for each git host. Tokens come from the
// gh/glab CLI (read only after the user picks that source) or a pasted token
// stored in the keychain.

import {
  type HostAccount,
  type HostKind,
  hostTokenSecret,
  type Settings,
} from "@legible/domain"
import { tokenAuthEnv } from "@legible/git"
import { ghToken, glabToken, whoAmI } from "@legible/hosts"

import type { SecretStore } from "./secrets"

export class HostService {
  constructor(
    private readonly secrets: SecretStore,
    private readonly getSettings: () => Promise<Settings>,
  ) {}

  async token(hostname: string): Promise<string | null> {
    const settings = await this.getSettings()
    const acct = settings.hosts.find((h) => h.hostname === hostname)
    if (!acct) return null
    if (acct.source === "gh") return ghToken(hostname)
    if (acct.source === "glab") return glabToken(hostname)
    return this.secrets.get(hostTokenSecret(hostname))
  }

  /** Env that authenticates git to `hostname`, or undefined without an account. */
  async gitAuthEnv(hostname: string): Promise<NodeJS.ProcessEnv | undefined> {
    const settings = await this.getSettings()
    const acct = settings.hosts.find((h) => h.hostname === hostname)
    const token = acct ? await this.token(hostname) : null
    return acct && token ? tokenAuthEnv(hostname, token, acct.kind) : undefined
  }

  async describe(
    hostname: string,
    kind: HostKind,
    source: "gh" | "glab" | "token",
  ): Promise<HostAccount> {
    const token =
      source === "gh"
        ? await ghToken(hostname)
        : source === "glab"
          ? await glabToken(hostname)
          : this.secrets.get(hostTokenSecret(hostname))
    if (!token) {
      const detail =
        source === "gh"
          ? `No gh credentials for ${hostname}. Run \`gh auth login --hostname ${hostname}\`.`
          : source === "glab"
            ? `No glab credentials for ${hostname}. Run \`glab auth login --hostname ${hostname}\`.`
            : "No token saved"
      return {
        hostname,
        host: kind,
        source,
        login: null,
        connected: false,
        detail,
      }
    }
    const login = await whoAmI(kind, hostname, token)
    const from = source === "token" ? "personal access token" : `${source} CLI`
    return {
      hostname,
      host: kind,
      source,
      login,
      connected: login !== null,
      detail: login
        ? `@${login} · from ${from}`
        : `The ${from} token was rejected or ${hostname} is unreachable`,
    }
  }

  async list(): Promise<HostAccount[]> {
    const settings = await this.getSettings()
    return Promise.all(
      settings.hosts.map((h) => this.describe(h.hostname, h.kind, h.source)),
    )
  }
}
