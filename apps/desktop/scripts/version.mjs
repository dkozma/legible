// Release versions are YYYY.MDD.N (ADR 0012): the UTC date with month and day
// joined (Oct 25 is 1025, Jan 5 is 105), then the release count that day.
// Valid semver with no leading zeros or pre-release tag, so electron-updater
// orders releases correctly.
//
// Prerelease builds (the Prerelease build workflow) add the commit:
// YYYY.MDD.N-g<sha7>, the next release's version as a semver prerelease, so it
// sorts before that release.
//
// Usage: git tag -l 'v*' | node apps/desktop/scripts/version.mjs [--prerelease <sha>]

/**
 * @param {Date} date
 * @param {string[]} tags existing tags, e.g. ["v2026.1025.1"]
 */
export function nextVersion(date, tags) {
  const base = `${date.getUTCFullYear()}.${(date.getUTCMonth() + 1) * 100 + date.getUTCDate()}`
  let n = 0
  for (const tag of tags) {
    const m = tag.trim().match(/^v(\d+\.\d+)\.(\d+)$/)
    if (m && m[1] === base) n = Math.max(n, Number(m[2]))
  }
  return `${base}.${n + 1}`
}

/**
 * @param {Date} date
 * @param {string[]} tags
 * @param {string} sha the commit being built
 */
export function prereleaseVersion(date, tags, sha) {
  if (!/^[0-9a-f]{7,}$/i.test(sha)) throw new Error(`Not a commit hash: ${sha}`)
  // "g" as in git describe: a bare hash like 0123456 isn't a valid semver identifier.
  return `${nextVersion(date, tags)}-g${sha.slice(0, 7).toLowerCase()}`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = ""
  for await (const chunk of process.stdin) input += chunk
  const tags = input.split("\n")
  const at = process.argv.indexOf("--prerelease")
  const version =
    at >= 0
      ? prereleaseVersion(new Date(), tags, process.argv[at + 1] ?? "")
      : nextVersion(new Date(), tags)
  process.stdout.write(`${version}\n`)
}
