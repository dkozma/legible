// The files the app needs from this directory and the grammar packages, laid
// out the way directorySource() (src/grammars.ts) reads them. Plain JavaScript
// so the desktop build config can import it without compiling TypeScript.

import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const indexer = createRequire(join(here, "../package.json"))

/** "pkg/file" or "via>pkg/file" (a package's own copy of a dependency). */
export function parseFileSpec(spec) {
  const [via, rest] = spec.includes(">") ? spec.split(">") : [undefined, spec]
  const parts = rest.split("/")
  const n = rest.startsWith("@") ? 2 : 1
  return {
    pkg: parts.slice(0, n).join("/"),
    file: parts.slice(n).join("/"),
    via,
  }
}

/** Where a package file lives in a bundled grammars directory. */
export function grammarFileKey(f) {
  return f.via
    ? `${f.via}/node_modules/${f.pkg}/${f.file}`
    : `${f.pkg}/${f.file}`
}

export function packageDir(pkg, via) {
  const from = via
    ? createRequire(join(packageDir(via), "package.json"))
    : indexer
  return dirname(from.resolve(`${pkg}/package.json`))
}

export function readManifest() {
  return JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"))
}

/** Every file for a bundled grammars directory: [{ fileName, source }]. */
export function bundleFiles() {
  const out = []
  const versions = {}
  const seen = new Set()
  for (const spec of Object.values(readManifest().languages)) {
    if (typeof spec === "string") continue
    for (const s of [spec.wasm, ...spec.highlights, ...spec.tags]) {
      const f = parseFileSpec(s)
      const key = grammarFileKey(f)
      if (seen.has(key)) continue
      seen.add(key)
      const dir = packageDir(f.pkg, f.via)
      out.push({ fileName: key, source: readFileSync(join(dir, f.file)) })
      versions[f.pkg] ??= JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ).version
    }
  }
  const queries = join(here, "queries")
  for (const lang of readdirSync(queries))
    for (const q of readdirSync(join(queries, lang)))
      out.push({
        fileName: `queries/${lang}/${q}`,
        source: readFileSync(join(queries, lang, q)),
      })
  out.push({
    fileName: "web-tree-sitter.wasm",
    source: readFileSync(
      indexer.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    ),
  })
  out.push({
    fileName: "versions.json",
    source: JSON.stringify(versions, null, 2),
  })
  return out
}
