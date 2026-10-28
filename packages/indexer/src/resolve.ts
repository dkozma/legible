// Module resolution: which files an import refers to, by language. Only the
// rules that are tractable without a build system: relative and workspace
// imports in JS/TS, Python packages from the importing file's source root, Go
// import paths under the repository's go.mod modules, Rust `use` paths, Java
// packages from source roots, and C includes. Anything else is external. When
// only a path suffix matches and several files fit, the import is ambiguous;
// the first match is never taken as certain.

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

/** What a module specifier refers to. */
export interface ModuleTarget {
  /** Its files (a whole package for Go and Java), or every candidate when ambiguous. Empty when it's external. */
  files: string[]
  /** Several files fit and nothing says which: each is a different module, not parts of one. */
  ambiguous: boolean
}

export interface ModuleResolver {
  resolve(language: string, fromPath: string, module: string): ModuleTarget
}

export interface ResolverOptions {
  /** Workspace package name → its directory and entry file, for monorepo imports like "@acme/ui". */
  workspaces?: Map<string, { dir: string; entry: string | null }>
  /** go.mod directory ("." at the root) → its module path. */
  goModules?: Map<string, string>
  /** C and C++ include directories, from compile_commands.json. */
  includeDirs?: string[]
}

/** Candidates kept when a suffix matches several files. */
const MAX_ALTERNATIVES = 8

const norm = (p: string) => posix.normalize(p).replace(/^\.\//, "")
const one = (files: string[]): ModuleTarget => ({ files, ambiguous: false })
const NONE: ModuleTarget = { files: [], ambiguous: false }
/** One file when a single one fits, else an ambiguous choice among them. */
const among = (files: string[]): ModuleTarget => ({
  files: files.slice(0, MAX_ALTERNATIVES),
  ambiguous: files.length > 1,
})

/** Java, Kotlin and Scala source roots: src/main/java and the like. */
const JVM_ROOT =
  /(^|\/)src\/(main|test)\/(java|kotlin|scala)$|(^|\/)(src|java)$/

export function createResolver(
  paths: Iterable<string>,
  {
    workspaces = new Map(),
    goModules = new Map(),
    includeDirs = [],
  }: ResolverOptions = {},
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
  /** Where the importing file's absolute imports start: the directory above its topmost package, then the root and src/. */
  const pyRoots = (from: string): string[] => {
    let dir = posix.dirname(from)
    while (dir !== "." && files.has(`${dir}/__init__.py`))
      dir = posix.dirname(dir)
    return [...new Set([dir, ".", "src"])]
  }
  const python = (from: string, module: string): ModuleTarget => {
    if (module.startsWith(".")) {
      const dots = module.match(/^\.+/)?.[0].length ?? 0
      let dir = posix.dirname(from)
      for (let i = 1; i < dots; i++) dir = posix.dirname(dir)
      const rest = module.slice(dots).replace(/\./g, "/")
      const base = rest ? norm(posix.join(dir, rest)) : dir
      for (const c of rest ? pyCandidates(base) : [`${base}/__init__.py`])
        if (files.has(c)) return one([c])
      return NONE
    }
    const rel = module.replace(/\./g, "/")
    for (const root of pyRoots(from))
      for (const c of pyCandidates(norm(posix.join(root, rel))))
        if (files.has(c)) return one([c])
    // Elsewhere in the repository: certain only when one file fits.
    for (const c of pyCandidates(rel)) {
      const hits = bySuffix(c)
      if (hits.length) return among(hits)
    }
    return NONE
  }

  const goPackage = (dir: string): string[] =>
    (dirs.get(dir) ?? []).filter(
      (p) => p.endsWith(".go") && !p.endsWith("_test.go"),
    )
  const go = (module: string): ModuleTarget => {
    if (goModules.size) {
      // Local only under one of the repository's own modules; the path below it is exact.
      let best: [string, string] | null = null
      for (const [dir, path] of goModules)
        if (
          (module === path || module.startsWith(`${path}/`)) &&
          (!best || path.length > best[1].length)
        )
          best = [dir, path]
      if (!best) return NONE
      return one(
        goPackage(norm(posix.join(best[0], module.slice(best[1].length)))),
      )
    }
    // No go.mod: the longest directory whose path ends the import path.
    let best: string | null = null
    for (const d of dirs.keys()) {
      if (d === "." || !(module === d || module.endsWith(`/${d}`))) continue
      if (!goPackage(d).length) continue
      if (!best || d.length > best.length) best = d
    }
    return best ? one(goPackage(best)) : NONE
  }

  const rust = (from: string, module: string): ModuleTarget => {
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
        if (files.has(c)) return one([c])
    }
    return NONE
  }

  const ancestors = new Set<string>()
  for (const d of dirs.keys())
    for (let a = d; a !== "." && !ancestors.has(a); a = posix.dirname(a))
      ancestors.add(a)
  const jvmRoots = [...ancestors].filter((d) => JVM_ROOT.test(d))
  const java = (
    from: string,
    module: string,
    language: string,
  ): ModuleTarget => {
    const ext = language === "java" ? ".java" : `.${language}`
    const rel = module.replace(/\./g, "/")
    const inPackage = (d: string) =>
      (dirs.get(d) ?? []).filter((p) => p.endsWith(ext))
    const at = (root: string): string[] => {
      const file = norm(posix.join(root, `${rel}${ext}`))
      if (files.has(file)) return [file]
      // A package: every file in its directory.
      return inPackage(norm(posix.join(root, rel)))
    }
    // The importing file's own source root first, then the others.
    const own = jvmRoots
      .filter((r) => from.startsWith(`${r}/`))
      .toSorted((a, b) => b.length - a.length)[0]
    if (own) {
      const hit = at(own)
      if (hit.length) return one(hit)
    }
    const found = jvmRoots
      .filter((r) => r !== own)
      .map(at)
      .filter((h) => h.length)
    if (found.length === 1) return one(found[0] as string[])
    if (found.length > 1) return among(found.flat())
    const asFile = bySuffix(`${rel}${ext}`)
    if (asFile.length) return among(asFile)
    const packages = [...dirs.keys()].filter(
      (d) => (d === rel || d.endsWith(`/${rel}`)) && inPackage(d).length,
    )
    if (packages.length === 1) return one(inPackage(packages[0] as string))
    return packages.length ? among(packages.flatMap(inPackage)) : NONE
  }

  const c = (from: string, module: string): ModuleTarget => {
    const local = norm(posix.join(posix.dirname(from), module))
    if (files.has(local)) return one([local])
    for (const dir of includeDirs) {
      const p = norm(posix.join(dir, module))
      if (files.has(p)) return one([p])
    }
    const hits = bySuffix(module)
    return hits.length ? among(hits) : NONE
  }

  return {
    resolve(language, from, module) {
      switch (familyOf(language)) {
        case "js":
          return one(js(from, module))
        case "python":
          return python(from, module)
        case "go":
          return go(module)
        case "rust":
          return rust(from, module)
        case "java":
          return java(from, module, language)
        case "c":
          return c(from, module)
        default:
          return NONE
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

/** The module path a go.mod declares, or null. */
export function goModulePath(text: string): string | null {
  const m = text.match(/^\s*module\s+"?([^\s"]+)"?/m)
  return m?.[1] ?? null
}

/**
 * Include directories from a compile_commands.json, as repository paths. Its
 * paths are absolute on the machine that wrote it, so each maps to the
 * longest repository directory it ends with.
 */
export function includeDirsFrom(
  json: unknown,
  repoDirs: Set<string>,
): string[] {
  if (!Array.isArray(json)) return []
  const toRepo = (abs: string): string | null => {
    let best: string | null = null
    for (const d of repoDirs)
      if (
        d !== "." &&
        (abs === d || abs.endsWith(`/${d}`)) &&
        (!best || d.length > best.length)
      )
        best = d
    return best
  }
  const out = new Set<string>()
  for (const entry of json as {
    directory?: unknown
    arguments?: unknown
    command?: unknown
  }[]) {
    const dir = typeof entry?.directory === "string" ? entry.directory : "/"
    const args = Array.isArray(entry?.arguments)
      ? entry.arguments.filter((a): a is string => typeof a === "string")
      : typeof entry?.command === "string"
        ? entry.command.split(/\s+/)
        : []
    for (let i = 0; i < args.length; i++) {
      const a = args[i] as string
      const flag = /^(-I|-iquote|-isystem)(.*)$/.exec(a)
      if (!flag) continue
      const value = flag[2] || args[++i]
      if (!value) continue
      const mapped = toRepo(posix.normalize(posix.resolve(dir, value)))
      if (mapped) out.add(mapped)
    }
  }
  return [...out]
}
