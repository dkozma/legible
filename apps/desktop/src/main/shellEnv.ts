// GUI apps on macOS start with a minimal environment. Agents and git need the
// user's real one: PATH (Homebrew git, ~/.local/bin/claude), and whatever their
// shell profile exports for Claude Code (CLAUDE_CONFIG_DIR,
// CLAUDE_CODE_OAUTH_TOKEN, proxies). Read it from a login shell.

import { execFile } from "node:child_process"

const MARKER = "__LEGIBLE_ENV__"

/** Variables that describe the shell process itself, or would change how Legible's own processes run. */
const SKIP = new Set(["_", "PWD", "OLDPWD", "SHLVL", "NODE_OPTIONS"])
const skip = (key: string) => SKIP.has(key) || key.startsWith("ELECTRON_")

/** Runs a login shell and returns its environment, or null if it couldn't be read. */
export async function readShellEnv(
  shell: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string> | null> {
  // The shell's own environment is printed by this same binary running as Node, as JSON
  // between markers, so profile output (motd, prompts) and odd values can't confuse parsing.
  const print = `process.stdout.write(${JSON.stringify(MARKER)}+JSON.stringify(process.env)+${JSON.stringify(MARKER)})`
  const out = await new Promise<string>((resolve) => {
    execFile(
      shell,
      ["-ilc", `"$LEGIBLE_NODE" -e '${print}'`],
      {
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...baseEnv,
          DISABLE_AUTO_UPDATE: "true",
          LEGIBLE_NODE: process.execPath,
          ELECTRON_RUN_AS_NODE: "1",
        },
      },
      (_err, stdout) => resolve(stdout ?? ""),
    )
  })
  const start = out.indexOf(MARKER)
  const end = out.lastIndexOf(MARKER)
  if (start < 0 || end <= start) return null
  try {
    const env = JSON.parse(out.slice(start + MARKER.length, end)) as Record<
      string,
      string
    >
    delete env.LEGIBLE_NODE
    delete env.ELECTRON_RUN_AS_NODE
    delete env.DISABLE_AUTO_UPDATE
    return env
  } catch {
    return null
  }
}

/**
 * Fills in what the shell sets and the app wasn't started with. Variables the
 * app was started with win (`CLAUDE_CONFIG_DIR=… pnpm dev` still applies),
 * except PATH, which is merged with the shell's entries first.
 */
export function mergeShellEnv(
  target: NodeJS.ProcessEnv,
  shellEnv: Record<string, string>,
) {
  for (const [key, value] of Object.entries(shellEnv)) {
    if (key === "PATH" || skip(key) || target[key] !== undefined) continue
    target[key] = value
  }
  const merged = new Set(
    [
      ...(shellEnv.PATH ?? "").split(":"),
      ...(target.PATH ?? "").split(":"),
    ].filter(Boolean),
  )
  target.PATH = [...merged].join(":")
}

/** Just the shell's PATH, for when the full environment can't be read. */
async function readShellPath(shell: string): Promise<string | null> {
  const out = await new Promise<string>((resolve) => {
    execFile(
      shell,
      ["-ilc", `printf '${MARKER}%s${MARKER}' "$PATH"`],
      { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: "true" } },
      (_err, stdout) => resolve(stdout ?? ""),
    )
  })
  return out.match(new RegExp(`${MARKER}(.*)${MARKER}`))?.[1] || null
}

export async function loadShellEnv(): Promise<void> {
  if (process.platform === "win32") return
  const shell =
    process.env.SHELL ||
    (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash")
  const env = await readShellEnv(shell)
  if (env) {
    mergeShellEnv(process.env, env)
    return
  }
  const path = await readShellPath(shell)
  if (path) mergeShellEnv(process.env, { PATH: path })
}
