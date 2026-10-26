import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { ClaudeSdkRuntime } from "../src/index"
import type { ClaudeRuntimeConfig } from "../src/types"

const dir = mkdtempSync(join(tmpdir(), "legible-env-"))
const seen = join(dir, "seen")
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// A stand-in `claude` that records the credentials it was started with.
const claude = join(dir, "claude")
writeFileSync(
  claude,
  `#!/bin/sh\necho "key=\${ANTHROPIC_API_KEY-unset} token=\${ANTHROPIC_AUTH_TOKEN-unset}" > "${seen}"\necho '{"loggedIn": true}'\n`,
)
chmodSync(claude, 0o755)

const config = (over: Partial<ClaudeRuntimeConfig>): ClaudeRuntimeConfig => ({
  auth: "claude-code",
  executablePath: claude,
  env: {},
  bedrock: { region: "", profile: "" },
  vertex: { projectId: "", region: "" },
  foundry: { resource: "" },
  clientApp: "legible-test",
  scratchDir: dir,
  bundledExecutable: null,
  ...over,
})

describe("Claude credentials from the environment", () => {
  it("never reach `claude` in Use my Claude Code mode, so it uses the claude.ai sign-in", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-from-shell"
    process.env.ANTHROPIC_AUTH_TOKEN = "token-from-shell"
    try {
      await new ClaudeSdkRuntime(config({})).status()
      expect(readFileSync(seen, "utf8").trim()).toBe("key=unset token=unset")
    } finally {
      delete process.env.ANTHROPIC_API_KEY
      delete process.env.ANTHROPIC_AUTH_TOKEN
    }
  })

  it("still pass the key chosen in Settings in API key mode", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-from-shell"
    try {
      const runtime = new ClaudeSdkRuntime(
        config({
          auth: "anthropic-api",
          env: { ANTHROPIC_API_KEY: "sk-from-settings" },
        }),
      )
      // API key mode doesn't run `claude` for its status; check the run environment directly.
      const env = (
        runtime as unknown as { env(): Record<string, string | undefined> }
      ).env()
      expect(env.ANTHROPIC_API_KEY).toBe("sk-from-settings")
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })
})
