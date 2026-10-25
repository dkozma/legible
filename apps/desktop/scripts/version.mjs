// Release versions are YYYY.MDD.N (ADR 0012): the UTC date with month and day
// joined (Oct 25 is 1025, Jan 5 is 105), then the release count that day.
// Valid semver with no leading zeros or pre-release tag, so electron-updater
// orders releases correctly.
//
// Usage: git tag -l 'v*' | node apps/desktop/scripts/version.mjs

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

if (import.meta.url === `file://${process.argv[1]}`) {
  let input = ""
  for await (const chunk of process.stdin) input += chunk
  process.stdout.write(`${nextVersion(new Date(), input.split("\n"))}\n`)
}
