# Calendar versions, chosen by the release workflow

Legible is an app, not a library: nothing depends on its API, so semver's compatibility signal has no reader. Versions say when a build was made instead: `YYYY.MDD.N`. The middle number is the UTC month and day joined (Oct 25 is `1025`, Jan 5 is `105`), and `N` counts that day's releases from 1. So the first release on Oct 25, 2026 is `2026.1025.1`.

The obvious `YYYY.MM.DD-N` doesn't work. electron-updater orders versions by semver, which forbids leading zeros (`01`) and reads `-N` as a pre-release that sorts *before* `YYYY.MM.DD`. `+N` is ignored when comparing. `YYYY.MDD.N` is plain three-part semver that sorts in release order, and every part fits the macOS bundle version and Windows file version fields (up to 65535).

## Consequences

- Releases come from the Release workflow's "Run workflow" button on `main`. It picks the version with `apps/desktop/scripts/version.mjs` from the existing `v*` tags, tags the commit, builds, signs and notarizes, and uploads to a draft GitHub Release. If the build fails, it removes the tag. Publishing the draft is what makes auto-update offer it.
- Prerelease builds of a branch (the Prerelease build workflow, run by hand) are `YYYY.MDD.N-g<sha7>`: the next release's version as a semver prerelease, so it sorts before that release. The `g` keeps the identifier valid when the hash is all digits with a leading zero. `CFBundleVersion` gets the numeric part. Prerelease builds skip auto-update, so one is never replaced by a release.
- Nobody bumps a version by hand. `apps/desktop/package.json` stays at `0.0.0`, so a local build is older than any release.
- A Windows `.msi` would cap the first part at 255. The Windows target is NSIS, which doesn't; an MSI would need `YY.MDD.N`.
