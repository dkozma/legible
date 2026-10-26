// Module resolution: which files an import refers to, by language. Only the
// rules that are tractable without a build system: relative and workspace
// imports in JS/TS, Python packages, Go import paths, Rust `use` paths, Java
// packages and C includes. Anything else is external.

import { dirname, posix } from "node:path"

const JS_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".d.ts",
]

/** "js" for JavaScript and TypeScript, "c" for C and C++, otherwise the language itself. */
export type LanguageFamily = string

export function familyOf(language: string): LanguageFamily {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
    case "jsx":
      return "js"
    case "c":
    case "cpp":
      return "c"
    default:
      return language
  }
}

export interface ModuleResolver {
  /** Files the module specifier refers to (a directory for Go and Java wildcards). Empty when it's external. */
  resolve(language: string, fromPath: string, module: string): string[]
}

const norm = (p: string) => posix.normalize(p).replace(/^\.\//, "")

export function createResolver(
  paths: Iterable<string>,
  /** Workspace package name → its directory and entry file, for monorepo imports like "@acme/ui". */
  workspaces: Map<string, { dir: string; entry: string | null }> = new Map(),
): ModuleResolver {
  const files = new Set(paths)
  const dirs = new Map<string, string[]>()
  for (const p of files) {
    const d = posix.dirname(p)
    const list = dirs.get(d)
    if (list) list.push(p)
    else dirs.set(d, [p])
  }
  const bySuffix = (suffix: string): string[] => {
    const out: string[] = []
    for (const p of files)
      if (p === suffix || p.endsWith(`/${suffix}`)) out.push(p)
    return out.toSorted((a, b) => a.length - b.length)
  }

  const jsFile = (base: string): string | null => {
    if (files.has(base) && /\.[mc]?[jt]sx?$/.test(base)) return base
    // TypeScript's ESM style: "./a.js" means a.ts.
    const stem = base.replace(/\.(m|c)?js$/, "")
    for (const ext of JS_EXTENSIONS)
      if (files.has(stem + ext)) return stem + ext
    for (const ext of JS_EXTENSIONS)
      if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`
    return null
  }

  const js = (from: string, module: string): string[] => {
    if (module.startsWith(".")) {
      const f = jsFile(norm(posix.join(posix.dirname(from), module)))
      return f ? [f] : []
    }
    // Workspace packages: "@acme/ui" or "@acme/ui/sub/path".
    const parts = module.split("/")
    const name = module.startsWith("@")
      ? parts.slice(0, 2).join("/")
      : (parts[0] as string)
    const ws = workspaces.get(name)
    if (!ws) return []
    const sub = module.slice(name.length).replace(/^\//, "")
    if (!sub) {
      const f = ws.entry ? jsFile(norm(posix.join(ws.dir, ws.entry))) : null
      return [
        f ??
          jsFile(norm(posix.join(ws.dir, "src/index"))) ??
          jsFile(norm(posix.join(ws.dir, "index"))),
      ].filter((x): x is string => x !== null)
    }
    const f =
      jsFile(norm(posix.join(ws.dir, sub))) ??
      jsFile(norm(posix.join(ws.dir, "src", sub)))
    return f ? [f] : []
  }

  const pyCandidates = (rel: string) => [
    `${rel}.py`,
    `${rel}/__init__.py`,
    `${rel}.pyi`,
  ]
  const python = (from: string, module: string): string[] => {
    if (module.startsWith(".")) {
      const dots = module.match(/^\.+/)?.[0].length ?? 0
      let dir = posix.dirname(from)
      for (let i = 1; i < dots; i++) dir = posix.dirname(dir)
      const rest = module.slice(dots).replace(/\./g, "/")
      const base = rest ? norm(posix.join(dir, rest)) : dir
      for (const c of rest ? pyCandidates(base) : [`${base}/__init__.py`])
        if (files.has(c)) return [c]
      return []
    }
    const rel = module.replace(/\./g, "/")
    for (const c of pyCandidates(rel)) {
      const hit = bySuffix(c)[0]
      if (hit) return [hit]
    }
    return []
  }

  const go = (module: string): string[] => {
    // The longest directory whose path ends the import path: "github.com/acme/app/internal/audit" → internal/audit.
    let best: string | null = null
    for (const d of dirs.keys()) {
      if (d === "." || !(module === d || module.endsWith(`/${d}`))) continue
      if (!(dirs.get(d) ?? []).some((p) => p.endsWith(".go"))) continue
      if (!best || d.length > best.length) best = d
    }
    return best
      ? (dirs.get(best) ?? []).filter(
          (p) => p.endsWith(".go") && !p.endsWith("_test.go"),
        )
      : []
  }

  const rust = (from: string, module: string): string[] => {
    const segs = module.split("::").filter(Boolean)
    // The crate's src/ directory, or the file's own directory for single-file layouts.
    let root = posix.dirname(from)
    for (let d = root; d !== "." && d !== "/"; d = posix.dirname(d))
      if (posix.basename(d) === "src") {
        root = d
        break
      }
    let dir = root
    let i = 0
    if (segs[0] === "crate") i = 1
    else if (segs[0] === "self" || segs[0] === "super") {
      dir = posix.dirname(from)
      const self = posix.basename(from).replace(/\.rs$/, "")
      if (self !== "mod" && self !== "lib" && self !== "main")
        dir = posix.join(dir, self)
      for (; segs[i] === "super" || segs[i] === "self"; i++)
        if (segs[i] === "super") dir = posix.dirname(dir)
    }
    const path = segs.slice(i)
    // Longest prefix of the path that names a module file; the rest are items in it.
    for (let n = path.length; n >= 0; n--) {
      const p = norm(posix.join(dir, ...path.slice(0, n)))
      for (const c of n === 0
        ? [`${p}/lib.rs`, `${p}/main.rs`, `${p}/mod.rs`]
        : [`${p}.rs`, `${p}/mod.rs`])
        if (files.has(c)) return [c]
    }
    return []
  }

  const java = (module: string, language: string): string[] => {
    const ext = language === "java" ? ".java" : `.${language}`
    const rel = module.replace(/\./g, "/")
    const asFile = bySuffix(`${rel}${ext}`)
    if (asFile.length) return asFile.slice(0, 1)
    // A package: every file in its directory.
    for (const d of dirs.keys())
      if (d === rel || d.endsWith(`/${rel}`))
        return (dirs.get(d) ?? []).filter((p) => p.endsWith(ext))
    return []
  }

  const c = (from: string, module: string): string[] => {
    const local = norm(posix.join(posix.dirname(from), module))
    if (files.has(local)) return [local]
    return bySuffix(module).slice(0, 1)
  }

  return {
    resolve(language, from, module) {
      switch (familyOf(language)) {
        case "js":
          return js(from, module)
        case "python":
          return python(from, module)
        case "go":
          return go(module)
        case "rust":
          return rust(from, module)
        case "java":
          return java(module, language)
        case "c":
          return c(from, module)
        default:
          return []
      }
    },
  }
}

/** Files of the same Go or Java package: the directory a file is in. */
export function samePackage(language: string): boolean {
  return language === "go" || language === "java"
}

export function dirOf(path: string): string {
  return dirname(path)
}
