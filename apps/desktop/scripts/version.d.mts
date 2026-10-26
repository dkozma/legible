/** The next release version, YYYY.MDD.N (see version.mjs). */
export function nextVersion(date: Date, tags: string[]): string

/** A prerelease build's version, YYYY.MDD.N-g<sha7> (see version.mjs). */
export function prereleaseVersion(
  date: Date,
  tags: string[],
  sha: string,
): string
