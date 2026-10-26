import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { mergeShellEnv, readShellEnv } from "../src/main/shellEnv"

const home = mkdtempSync(join(tmpdir(), "legible-shell-"))
afterAll(() => rmSync(home, { recursive: true, force: true }))

describe("login shell environment", () => {
  it("reads what the profile exports, from the minimal environment a GUI app starts with", async () => {
    writeFileSync(
      join(home, ".bash_profile"),
      [
        "echo 'Welcome! (profile noise)'",
        "export CLAUDE_CONFIG_DIR=$HOME/.config/claude",
        'export PATH="$HOME/.local/bin:$PATH"',
        'export TRICKY=\'a "quoted" value',
        "with a newline'",
      ].join("\n"),
    )
    const env = await readShellEnv("/bin/bash", {
      HOME: home,
      PATH: "/usr/bin:/bin",
      SHELL: "/bin/bash",
    })
    expect(env?.CLAUDE_CONFIG_DIR).toBe(`${home}/.config/claude`)
    expect(env?.PATH?.split(":")[0]).toBe(`${home}/.local/bin`)
    expect(env?.TRICKY).toBe('a "quoted" value\nwith a newline')
    // Legible's own plumbing doesn't leak into the result.
    expect(env?.LEGIBLE_NODE).toBeUndefined()
    expect(env?.ELECTRON_RUN_AS_NODE).toBeUndefined()
  })

  it("returns null when the shell can't run", async () => {
    expect(await readShellEnv("/nonexistent/shell", { HOME: home })).toBeNull()
  })

  it("fills in missing variables, keeps the app's own, and merges PATH", () => {
    const target: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      CLAUDE_CONFIG_DIR: "/from/launch",
    }
    mergeShellEnv(target, {
      PATH: "/opt/homebrew/bin:/usr/bin",
      CLAUDE_CONFIG_DIR: "/from/shell",
      CLAUDE_CODE_OAUTH_TOKEN: "t",
      NODE_OPTIONS: "--inspect",
      ELECTRON_RUN_AS_NODE: "1",
      SHLVL: "2",
    })
    expect(target).toEqual({
      PATH: "/opt/homebrew/bin:/usr/bin:/bin",
      CLAUDE_CONFIG_DIR: "/from/launch",
      CLAUDE_CODE_OAUTH_TOKEN: "t",
    })
  })
})
