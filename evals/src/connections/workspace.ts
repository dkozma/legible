// Lets scip-typescript resolve a workspace monorepo's own packages without
// node_modules: finds the workspace packages (pnpm, npm or yarn, lerna), maps
// each package name and subpath export to its source, and writes a
// `.scip.json` copy of each project's tsconfig that adds those mappings as
// `paths`. Bases it extends from packages that aren't installed are dropped,
// and project references point at the copies.

import {
  existsSync,
  globSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"

import ts from "typescript"

const require = createRequire(__filename)

export interface WorkspacePackage {
  name: string
  dir: string
  /** `name` or `name/sub` → files or patterns relative to the repository, in order of preference. */
  entries: Map<string, string[]>
}

const SOURCE_EXT = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
]
/** Build output an entry point may name before it's built; its source is usually under src/. */
const BUILD_DIRS = /^(\.\/)?(dist|build|lib|out|esm|cjs|types|dist-types)(\/|$)/

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

function workspaceGlobs(root: string): string[] {
  const out: string[] = []
  const pnpm = join(root, "pnpm-workspace.yaml")
  if (existsSync(pnpm)) {
    // The `packages:` list only; a YAML parser isn't worth a dependency.
    let inList = false
    for (const line of readFileSync(pnpm, "utf8").split("\n")) {
      if (/^packages:\s*$/.test(line)) inList = true
      else if (inList && /^\s+-\s+/.test(line))
        out.push(
          line
            .replace(/^\s+-\s+/, "")
            .replace(/\s+#.*$/, "")
            .replace(/^["']|["']$/g, ""),
        )
      else if (inList && /^\S/.test(line)) inList = false
    }
  }
  const pkg = readJson(join(root, "package.json"))
  const ws = Array.isArray(pkg?.workspaces)
    ? pkg.workspaces
    : pkg?.workspaces?.packages
  if (Array.isArray(ws)) out.push(...ws)
  const lerna = readJson(join(root, "lerna.json"))
  if (Array.isArray(lerna?.packages)) out.push(...lerna.packages)
  return [...new Set(out)]
}

const isFile = (p: string) => existsSync(p) && statSync(p).isFile()
const readText = (p: string) => ts.sys.readFile(p)

/** A file in the checkout for an entry point, preferring source over build output. */
function sourceFor(root: string, dir: string, target: string): string | null {
  const t = target.replace(/^\.\//, "")
  const stem = t.replace(/(\.d)?\.(m|c)?(t|j)sx?$/, "")
  const candidates = [
    t,
    ...(BUILD_DIRS.test(t)
      ? [stem.replace(BUILD_DIRS, "src/"), stem.replace(BUILD_DIRS, "")]
      : []),
    stem,
  ]
  for (const c of candidates)
    for (const ext of ["", ...SOURCE_EXT])
      if (isFile(join(dir, c + ext))) return relative(root, join(dir, c + ext))
  for (const c of candidates)
    for (const index of ["/index.ts", "/index.tsx", "/index.d.ts", "/index.js"])
      if (isFile(join(dir, c + index)))
        return relative(root, join(dir, c + index))
  return null
}

/** The first path an `exports` value leads to, types first. */
function conditionTarget(value: unknown): string | null {
  if (typeof value === "string") return value
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = conditionTarget(v)
      if (t) return t
    }
    return null
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>
    const keys = [
      "types",
      "typings",
      "source",
      "development",
      "import",
      "module",
      "require",
      "node",
      "default",
    ]
    for (const key of [...keys.filter((k) => k in o), ...Object.keys(o)]) {
      const t = conditionTarget(o[key])
      if (t) return t
    }
  }
  return null
}

/** A wildcard subpath export, `./x/*` → `./dist/x/*.js`, as a pattern into the source. */
function wildcardFor(root: string, dir: string, target: string): string {
  const t = target.replace(/^\.\//, "").replace(/(\.d)?\.(m|c)?(t|j)sx?$/, "")
  const src = BUILD_DIRS.test(t) ? t.replace(BUILD_DIRS, "src/") : t
  const prefix = src.split("*")[0] as string
  return relative(root, join(dir, existsSync(join(dir, prefix)) ? src : t))
}

export function workspacePackages(root: string): WorkspacePackage[] {
  const dirs = new Set<string>()
  const globs = workspaceGlobs(root)
  for (const pattern of globs.filter((g) => !g.startsWith("!")))
    for (const m of globSync(join(pattern, "package.json"), {
      cwd: root,
      exclude: (p) => p.includes("node_modules"),
    }))
      dirs.add(dirname(join(root, m)))
  for (const pattern of globs.filter((g) => g.startsWith("!")))
    for (const m of globSync(pattern.slice(1), { cwd: root }))
      dirs.delete(join(root, m))

  const out: WorkspacePackage[] = []
  for (const dir of dirs) {
    const pkg = readJson(join(dir, "package.json"))
    if (typeof pkg?.name !== "string") continue
    const entries = new Map<string, string[]>()
    const exp = pkg.exports
    const subpaths: Record<string, unknown> =
      exp &&
      typeof exp === "object" &&
      !Array.isArray(exp) &&
      Object.keys(exp).some((k) => k.startsWith("."))
        ? exp
        : { ".": exp }
    for (const [key, value] of Object.entries(subpaths)) {
      const target = conditionTarget(value)
      if (!target || key.endsWith(".json")) continue
      const name =
        key === "." ? pkg.name : `${pkg.name}/${key.replace(/^\.\//, "")}`
      const file = key.includes("*")
        ? wildcardFor(root, dir, target)
        : sourceFor(root, dir, target)
      if (file) entries.set(name, [file])
    }
    if (!entries.has(pkg.name))
      for (const f of [
        pkg.types,
        pkg.typings,
        pkg.source,
        pkg.module,
        pkg.main,
        "src/index",
        "index",
      ]) {
        const file = typeof f === "string" ? sourceFor(root, dir, f) : null
        if (file) {
          entries.set(pkg.name, [file])
          break
        }
      }
    // Deep imports without an exports map: `pkg/foo` → `src/foo` or `foo`.
    if (!exp || typeof exp === "string") {
      const rel = relative(root, dir)
      entries.set(
        `${pkg.name}/*`,
        [`${rel}/src/*`, `${rel}/*`].filter((d) =>
          existsSync(join(root, d.slice(0, -1))),
        ),
      )
    }
    out.push({ name: pkg.name, dir, entries })
  }
  return out
}

const relFrom = (dir: string) => (p: string) => {
  const r = relative(dir, p)
  return r.startsWith(".") ? r : `./${r}`
}

/** Where an `extends` entry leads: a file in the checkout or node_modules, or null for a package that isn't installed. */
function extendsTarget(
  dir: string,
  spec: string,
  packages: WorkspacePackage[],
): string | null {
  const withJson = (p: string) =>
    isFile(p)
      ? p
      : isFile(`${p}.json`)
        ? `${p}.json`
        : isFile(join(p, "tsconfig.json"))
          ? join(p, "tsconfig.json")
          : null
  if (spec.startsWith(".") || spec.startsWith("/"))
    return withJson(resolve(dir, spec))
  const pkg = packages.find(
    (p) => spec === p.name || spec.startsWith(`${p.name}/`),
  )
  if (pkg) return withJson(join(pkg.dir, spec.slice(pkg.name.length)))
  try {
    return require.resolve(spec, { paths: [dir] })
  } catch {
    return null
  }
}

/** The project's own `paths`, absolute, so they survive being moved into the copy. */
function ownPaths(configPath: string): Record<string, string[]> {
  const read = ts.readConfigFile(configPath, readText)
  const parsed = ts.parseJsonConfigFileContent(
    read.config ?? {},
    ts.sys,
    dirname(configPath),
  )
  const base =
    parsed.options.baseUrl ??
    (parsed.options.pathsBasePath as string | undefined) ??
    dirname(configPath)
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(parsed.options.paths ?? {}))
    out[k] = v.map((p) => resolve(base, p))
  return out
}

interface Written {
  path: string
  /** A base it extends wasn't installed and was left out. */
  dropped: boolean
}

/**
 * A copy of a tsconfig beside it (`tsconfig.json` → `tsconfig.scip.json`)
 * whose `extends` lead only to files that exist. `extra` adds to it.
 */
function copyConfig(
  abs: string,
  packages: WorkspacePackage[],
  done: Map<string, Written>,
  extra: (raw: any, dir: string) => Record<string, unknown> = () => ({}),
): Written {
  const known = done.get(abs)
  if (known) return known
  const dir = dirname(abs)
  const result: Written = {
    path: abs.replace(/(\.json)?$/, ".scip.json"),
    dropped: false,
  }
  done.set(abs, result)

  const raw = ts.readConfigFile(abs, readText).config ?? {}
  const specs: string[] =
    raw.extends === undefined
      ? []
      : Array.isArray(raw.extends)
        ? raw.extends
        : [raw.extends]
  const kept: string[] = []
  for (const spec of specs) {
    const target = extendsTarget(dir, spec, packages)
    if (!target) result.dropped = true
    else if (target.includes("/node_modules/")) kept.push(target)
    else {
      const base = copyConfig(target, packages, done)
      result.dropped ||= base.dropped
      kept.push(relFrom(dir)(base.path))
    }
  }
  const { extends: _, ...rest } = raw
  const config = {
    ...rest,
    ...(kept.length ? { extends: kept.length === 1 ? kept[0] : kept } : {}),
    ...extra(raw, dir),
  }
  writeFileSync(result.path, `${JSON.stringify(config, null, 2)}\n`)
  return result
}

/**
 * Writes the `.scip.json` copy of a project (and of each project it
 * references) with the workspace's packages mapped to their source, and
 * returns its path relative to `root`.
 */
export function writeScipConfig(
  root: string,
  configPath: string,
  packages: WorkspacePackage[] = workspacePackages(root),
  done = new Map<string, Written>(),
): string {
  const abs = resolve(root, configPath)
  const known = done.get(abs)
  if (known) return relative(root, known.path)

  const result = copyConfig(abs, packages, done, (raw, dir) => {
    const rel = relFrom(dir)
    const paths: Record<string, string[]> = {}
    for (const pkg of packages)
      for (const [name, files] of pkg.entries)
        paths[name] = files.map((f) => rel(join(root, f)))
    // The project's own mappings win over the workspace's.
    for (const [k, v] of Object.entries(ownPaths(abs))) paths[k] = v.map(rel)
    const references = Array.isArray(raw.references)
      ? raw.references.map((r: { path: string }) => {
          let target = resolve(dir, r.path)
          if (existsSync(target) && statSync(target).isDirectory())
            target = join(target, "tsconfig.json")
          return {
            path: rel(
              join(root, writeScipConfig(root, target, packages, done)),
            ),
          }
        })
      : undefined
    return {
      compilerOptions: { ...raw.compilerOptions, paths },
      ...(references ? { references } : {}),
    }
  })
  // A dropped base took its module settings with it: resolve the way
  // bundlers do, which reads `exports` and allows extensionless imports.
  if (result.dropped) {
    const config = JSON.parse(readFileSync(result.path, "utf8"))
    const o = config.compilerOptions
    if (!o.module && !o.moduleResolution)
      Object.assign(o, { module: "esnext", moduleResolution: "bundler" })
    o.target ??= "esnext"
    writeFileSync(result.path, `${JSON.stringify(config, null, 2)}\n`)
  }
  return relative(root, result.path)
}
