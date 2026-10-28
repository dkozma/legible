// The Connections index for one Change Set: Symbols of the changed files on
// both sides, plus 1-hop neighbors (files the changed code imports, its Go or
// Java package, and files that mention changed or unresolved names, found
// with `git grep -w`), and the Connections between them.
//
// Resolution (engineering plan §7.4): deterministic rules first (same file,
// imports, the receiver's class or module or declared type, the same
// package), then the only definition by that name in the indexed code: "likely"
// when something besides the name points at it (the file imports it, or the
// receiver's declared type is its class), else "possible". Several candidates
// make an Ambiguous Connection. Plain identifier uses ("reads") resolve only by
// the deterministic rules, never by name alone, and uses of parameters and
// locals are never Connections.

import { createHash } from "node:crypto"

import {
  extensionsFor,
  languageForPath,
  looksBinary,
  splitLines,
} from "@legible/diff"
import type {
  CodeSymbol,
  Connection,
  ConnectionKind,
  ConnectionSite,
  ConnectionStatus,
  FileChange,
  FragmentGraph,
  IndexScope,
  IndexStatus,
  PositionInfo,
  Side,
  SymbolConnections,
  SymbolKind,
  SymbolSource,
} from "@legible/domain"
import type { GitRepo } from "@legible/git"

import type { IndexedFile } from "./changeSet"
import { buildFragmentGraph } from "./fragmentGraph"
import type { RawImport } from "./imports"
import { GRAMMARS } from "./manifest"
import type { Outline, RawReference } from "./outline"
import type { Parsing } from "./parse"
import {
  createResolver,
  dirOf,
  familyOf,
  goModulePath,
  includeDirsFrom,
  type ModuleResolver,
  type ModuleTarget,
  samePackage,
} from "./resolve"
import { symbolId, toCodeSymbols } from "./symbols"

/** Neighbor files parsed per Change Set, at most. */
const MAX_NEIGHBORS = 400
/** A name found in more files than this is too common to search for. */
const MAX_FILES_PER_NAME = 40
/** Candidates kept on an Ambiguous Connection. */
const MAX_CANDIDATES = 8
/** Blobs a blobless clone may download to search for neighbors. */
const PARTIAL_CLONE_LIMIT = 500

type Universe = "base" | "head"

interface Entry {
  /** "base" or "head" for changed files; "both" for unchanged neighbors, identical on both sides. */
  side: Side | "both"
  path: string
  language: string
  oid: string | null
  lines: string[]
  outline: Outline
  symbols: CodeSymbol[]
  /** A Symbol standing for the file itself, the source of its imports and top-level code. */
  module: CodeSymbol
  fileId: string | null
}

interface Resolution {
  status: ConnectionStatus
  targets: CodeSymbol[]
  module: string | null
}

const TYPE_LIKE = new Set<SymbolKind>(["class", "interface", "type", "enum"])
const CALLABLE = new Set<SymbolKind>(["function", "method", "class", "macro"])
const MEMBER = new Set<SymbolKind>(["method", "field", "function"])
const SELF = new Set(["this", "self", "cls", "@", "Self"])

/**
 * Methods of built-in types (Map, Array, Promise, dict, list…). On a receiver
 * whose type isn't known, `x.get()` is far more likely one of these than the
 * one `get` the index happens to hold, so it's external.
 */
const BUILTIN_METHODS = new Set(
  "get set has delete add clear push pop shift unshift map filter reduce forEach find findIndex findLast some every includes indexOf join split slice splice concat sort toSorted reverse keys values entries then catch finally toString valueOf toJSON trim replace replaceAll match matchAll test exec apply call bind emit on off once append extend update items copy format startswith endswith lower upper strip close open read write send next log error warn info debug resolve reject parse stringify assign freeze from of at fill flat flatMap padStart padEnd startsWith endsWith toLowerCase toUpperCase charAt slice substring".split(
    " ",
  ),
)

/**
 * Built-in and standard library types: a member use on a local declared as
 * one (`name: string`, `items: Order[]`, `m := map…`) is external.
 */
const BUILTIN_TYPES = new Set(
  "string number boolean bigint symbol object String Number Boolean Array ReadonlyArray Map ReadonlyMap Set ReadonlySet WeakMap WeakSet Promise Date RegExp Error Record Partial Required Readonly Pick Omit URL URLSearchParams Buffer Uint8Array str int float bool bytes bytearray dict list set frozenset tuple complex int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 rune byte error".split(
    " ",
  ),
)

/** How many import hops from the using file still count as evidence for a by-name match. */
const IMPORT_HOPS = 2

/** Languages where a bare name never means a member of the enclosing class (members need `this.` or `self.`). */
const MEMBERS_NEED_RECEIVER = new Set(["js", "python", "go", "rust", "php"])

function compatible(kind: RawReference["kind"], s: CodeSymbol): boolean {
  switch (kind) {
    case "calls":
      return CALLABLE.has(s.kind)
    case "implements":
      return TYPE_LIKE.has(s.kind)
    case "references":
      return s.kind !== "method" && s.kind !== "function" && s.kind !== "macro"
    default:
      return s.kind !== "module"
  }
}

const shortHash = (s: string) =>
  createHash("sha1").update(s).digest("hex").slice(0, 16)

export interface CodeIndexInput {
  repo: GitRepo
  parsing: Parsing
  baseSha: string
  headSha: string
  files: IndexedFile[]
}

export class CodeIndex {
  status: IndexStatus = {
    state: "indexing",
    files: 0,
    symbols: 0,
    durationMs: null,
    error: null,
    scope: { neighborFiles: 0, complete: true, detail: null },
  }
  readonly ready: Promise<void>

  private entries: Entry[] = []
  private byPath: Record<Universe, Map<string, Entry>> = {
    base: new Map(),
    head: new Map(),
  }
  private symbolsById = new Map<string, { symbol: CodeSymbol; entry: Entry }>()
  private byName: Record<Universe, Map<string, CodeSymbol[]>> = {
    base: new Map(),
    head: new Map(),
  }
  private resolvers: Record<Universe, ModuleResolver> | null = null
  private truncated = new Set<string>()
  /** Connections by canonical source id / canonical target id, per side. */
  private outgoing: Record<Universe, Map<string, Connection[]>> = {
    base: new Map(),
    head: new Map(),
  }
  private incoming: Record<Universe, Map<string, Connection[]>> = {
    base: new Map(),
    head: new Map(),
  }
  private ids: Record<Universe, Set<string>> = {
    base: new Set(),
    head: new Set(),
  }
  /** Connection id for each use, by `${universe}\0${path}\0${line}\0${col}`. */
  private sites = new Map<string, string>()
  private connectionsById = new Map<string, Connection>()
  /** Files each file reaches through imports, per side (see reachable). */
  private reach: Record<Universe, Map<string, Set<string>>> = {
    base: new Map(),
    head: new Map(),
  }

  constructor(private readonly input: CodeIndexInput) {
    const started = performance.now()
    this.ready = this.build().then(
      () => {
        this.status = {
          ...this.status,
          state: "ready",
          files: this.entries.length,
          symbols: this.symbolsById.size,
          durationMs: Math.round(performance.now() - started),
        }
      },
      (e: unknown) => {
        this.status = {
          ...this.status,
          state: "error",
          error: e instanceof Error ? e.message : String(e),
          durationMs: Math.round(performance.now() - started),
        }
      },
    )
  }

  // ---- Building ------------------------------------------------------------------

  private async build() {
    const { repo, baseSha, headSha, files } = this.input
    const [headBlobs, baseBlobs] = await Promise.all([
      repo.treeBlobs(headSha),
      repo.treeBlobs(baseSha),
    ])
    const languages = new Set(
      files.flatMap((f) => (f.language ? [familyOf(f.language)] : [])),
    )
    const options = {
      workspaces: languages.has("js")
        ? await this.workspaces(headBlobs)
        : new Map(),
      goModules: languages.has("go")
        ? await this.goModules(headBlobs)
        : new Map(),
      includeDirs: languages.has("c") ? await this.includeDirs(headBlobs) : [],
    }
    this.resolvers = {
      head: createResolver(headBlobs.keys(), options),
      base: createResolver(baseBlobs.keys(), options),
    }

    // Changed files, both sides.
    for (const f of files) {
      if (!f.language || !GRAMMARS[f.language]) continue
      if (f.baseOid && f.base.outline) this.addChanged(f, "base")
      if (f.headOid && f.head.outline) this.addChanged(f, "head")
    }
    for (const f of files) {
      const b = this.byPath.base.get(f.oldPath ?? f.path)
      const h = this.byPath.head.get(f.path)
      if (b && h && b.side === "base" && h.side === "head") {
        b.module.counterpartId = h.module.id
        h.module.counterpartId = b.module.id
        b.module.change = h.module.change = "modified"
      }
    }
    const changed = new Set(files.flatMap((f) => [f.path, f.oldPath ?? f.path]))

    // Neighbors the changed code uses: imported modules, and its own Go or Java package.
    const wanted = new Set<string>()
    for (const e of this.entries.slice()) {
      const u: Universe = e.side === "base" ? "base" : "head"
      for (const imp of e.outline.imports)
        for (const p of this.resolvers[u].resolve(
          e.language,
          e.path,
          imp.module,
        ).files)
          if (!changed.has(p) && headBlobs.has(p)) wanted.add(p)
      if (samePackage(e.language)) {
        const dir = e.path.slice(0, e.path.lastIndexOf("/") + 1)
        let n = 0
        for (const p of headBlobs.keys()) {
          if (n >= 30) break
          if (
            p.startsWith(dir) &&
            !p.slice(dir.length).includes("/") &&
            !changed.has(p) &&
            languageForPath(p) === e.language
          ) {
            wanted.add(p)
            n++
          }
        }
      }
    }
    await this.addNeighbors([...wanted], headBlobs)

    // Neighbors found by name: files that mention changed Symbols (Used by), and definitions of names
    // the changed code uses that no rule resolved.
    const names = new Set<string>()
    for (const e of this.entries) {
      if (e.side === "both") continue
      for (const s of e.symbols) if (s.change !== "unchanged") names.add(s.name)
      for (const r of e.outline.references) {
        if (r.kind === "read") continue
        // Built-in methods on unknown receivers resolve as external; no point searching for them.
        if (r.receiver && !SELF.has(r.receiver) && BUILTIN_METHODS.has(r.name))
          continue
        if (!this.deterministic(e.side, e, r)) names.add(r.name)
      }
    }
    const words = [...names].filter((n) => /^[A-Za-z_$][\w$]{2,}$/.test(n))
    const partial = await repo.isPartialClone()
    // In a blobless clone, search only the changed files' directories; everything else is downloads.
    const dirs = partial
      ? [
          ...new Set(
            [...changed].map((p) =>
              p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "",
            ),
          ),
        ].filter(Boolean)
      : undefined
    const families = new Set(this.entries.map((e) => familyOf(e.language)))
    // Only files in the changed code's language families can hold its neighbors.
    const extensions = extensionsFor(
      Object.keys(GRAMMARS).filter((l) => families.has(familyOf(l))),
    )
    const hits = await repo.grepWords(headSha, words, {
      dirs,
      extensions,
      limit: PARTIAL_CLONE_LIMIT,
      blobs: headBlobs,
    })
    const scope: IndexScope = { neighborFiles: 0, complete: true, detail: null }
    if (!hits) {
      scope.complete = false
      scope.detail =
        "Searching this blobless clone would download too much, so only the changed files and their imports are indexed."
    } else {
      if (partial) {
        scope.complete = false
        scope.detail =
          "This Pull Request's clone is blobless, so only the changed files' directories were searched."
      }
      const byRarity = [...hits].toSorted((a, b) => a[1].size - b[1].size)
      const found: string[] = []
      for (const [word, paths] of byRarity) {
        const relevant = [...paths].filter((p) => {
          const lang = languageForPath(p)
          return (
            !changed.has(p) &&
            lang !== null &&
            GRAMMARS[lang] !== undefined &&
            families.has(familyOf(lang))
          )
        })
        if (relevant.length > MAX_FILES_PER_NAME) {
          this.truncated.add(word)
          continue
        }
        for (const p of relevant) found.push(p)
      }
      await this.addNeighbors(found, headBlobs)
      if (this.truncated.size) {
        scope.complete = false
        scope.detail ??= `Some names are too common to search for: ${[...this.truncated].slice(0, 5).join(", ")}${this.truncated.size > 5 ? "…" : ""}.`
      }
    }
    scope.neighborFiles = this.entries.filter((e) => e.side === "both").length
    if (scope.neighborFiles >= MAX_NEIGHBORS) {
      scope.complete = false
      scope.detail ??= `Stopped after ${MAX_NEIGHBORS} neighboring files.`
    }
    this.status.scope = scope

    this.connect("base")
    this.connect("head")
  }

  private async workspaces(blobs: Map<string, string>) {
    const out = new Map<string, { dir: string; entry: string | null }>()
    const manifests = [...blobs].filter(
      ([p]) =>
        (p === "package.json" || p.endsWith("/package.json")) &&
        !p.includes("node_modules/"),
    )
    const read = manifests.slice(0, 300)
    // One download in a blobless clone, instead of one round trip per package.json.
    await this.input.repo.prefetchBlobs(read.map(([, oid]) => oid))
    for (const [path, oid] of read) {
      try {
        const buf = await this.input.repo.blobs().read(oid)
        if (!buf) continue
        const pkg = JSON.parse(buf.toString("utf8")) as {
          name?: string
          types?: string
          main?: string
          module?: string
        }
        if (!pkg.name) continue
        const dir =
          path === "package.json" ? "." : path.slice(0, -"/package.json".length)
        out.set(pkg.name, {
          dir,
          entry: pkg.types ?? pkg.module ?? pkg.main ?? null,
        })
      } catch {
        // Not JSON, or unreadable: not a workspace package.
      }
    }
    return out
  }

  /** go.mod files: their directory and module path. */
  private async goModules(blobs: Map<string, string>) {
    const out = new Map<string, string>()
    const mods = [...blobs]
      .filter(([p]) => p === "go.mod" || p.endsWith("/go.mod"))
      .slice(0, 50)
    await this.input.repo.prefetchBlobs(mods.map(([, oid]) => oid))
    for (const [path, oid] of mods) {
      const buf = await this.input.repo.blobs().read(oid)
      const module = buf ? goModulePath(buf.toString("utf8")) : null
      if (module)
        out.set(
          path === "go.mod" ? "." : path.slice(0, -"/go.mod".length),
          module,
        )
    }
    return out
  }

  /** C and C++ include directories from compile_commands.json, when one is committed. */
  private async includeDirs(blobs: Map<string, string>) {
    const found = [...blobs]
      .filter(
        ([p]) =>
          p === "compile_commands.json" || p.endsWith("/compile_commands.json"),
      )
      .slice(0, 5)
    if (!found.length) return []
    const repoDirs = new Set<string>()
    for (const p of blobs.keys())
      for (let d = dirOf(p); d !== "." && !repoDirs.has(d); d = dirOf(d))
        repoDirs.add(d)
    const out = new Set<string>()
    for (const [, oid] of found) {
      try {
        const buf = await this.input.repo.blobs().read(oid)
        if (!buf) continue
        for (const d of includeDirsFrom(
          JSON.parse(buf.toString("utf8")),
          repoDirs,
        ))
          out.add(d)
      } catch {
        // Not JSON: no include directories from it.
      }
    }
    return [...out]
  }

  private addChanged(f: IndexedFile, side: Side) {
    const s = side === "base" ? f.base : f.head
    const path = side === "base" ? (f.oldPath ?? f.path) : f.path
    const module = this.moduleSymbol(
      side,
      path,
      f.language as string,
      s.lines.length,
    )
    module.change = side === "base" ? "removed" : "added"
    this.addEntry({
      side,
      path,
      language: f.language as string,
      oid: side === "base" ? f.baseOid : f.headOid,
      lines: s.lines,
      outline: s.outline as Outline,
      symbols: s.symbols,
      module,
      fileId: f.fileId,
    })
  }

  private moduleSymbol(
    side: Side,
    path: string,
    language: string,
    lines: number,
  ): CodeSymbol {
    const name = path.split("/").pop() ?? path
    return {
      id: symbolId(
        side,
        path,
        { kind: "module", qualifiedName: `\0${path}` },
        0,
      ),
      side,
      path,
      language,
      kind: "module",
      name,
      qualifiedName: path,
      startLine: 1,
      endLine: Math.max(1, lines),
      nameLine: 1,
      nameCol: 0,
      nameEndCol: 0,
      signature: path,
      parentId: null,
      change: "unchanged",
      counterpartId: null,
    }
  }

  private addEntry(e: Entry) {
    this.entries.push(e)
    for (const u of e.side === "both"
      ? (["base", "head"] as const)
      : [e.side]) {
      this.byPath[u].set(e.path, e)
      for (const s of e.symbols) {
        const list = this.byName[u].get(s.name)
        if (list) list.push(s)
        else this.byName[u].set(s.name, [s])
      }
    }
    for (const s of [e.module, ...e.symbols])
      this.symbolsById.set(s.id, { symbol: s, entry: e })
  }

  private async addNeighbors(paths: string[], blobs: Map<string, string>) {
    const room =
      MAX_NEIGHBORS - this.entries.filter((e) => e.side === "both").length
    const todo = [...new Set(paths)]
      .filter((p) => !this.byPath.head.has(p) && blobs.has(p))
      .slice(0, Math.max(0, room))
    if (todo.length === 0) return
    await this.input.repo.prefetchBlobs(todo.map((p) => blobs.get(p) as string))
    for (const path of todo) {
      const oid = blobs.get(path) as string
      const language = languageForPath(path)
      if (!language || !GRAMMARS[language]) continue
      const buf = await this.input.repo.blobs().read(oid)
      if (!buf || looksBinary(buf)) continue
      const lines = splitLines(buf.toString("utf8"))
      const parsed = await this.input.parsing.parse({
        oid,
        language,
        lines,
        tokens: false,
      })
      if (!parsed.outline) continue
      this.addEntry({
        side: "both",
        path,
        language,
        oid,
        lines,
        outline: parsed.outline,
        symbols: toCodeSymbols("head", path, language, parsed.outline.symbols),
        module: this.moduleSymbol("head", path, language, lines.length),
        fileId: null,
      })
    }
  }

  // ---- Resolution ------------------------------------------------------------------

  private universeOf(e: Entry, u?: Universe): Universe {
    return u ?? (e.side === "base" ? "base" : "head")
  }

  /** Top-level definitions named `name` in a module's files, following re-exports. */
  private exported(
    u: Universe,
    paths: string[],
    name: string,
    depth = 0,
  ): CodeSymbol[] {
    const out: CodeSymbol[] = []
    for (const p of paths) {
      const e = this.byPath[u].get(p)
      if (!e) continue
      const own = e.symbols.filter(
        (s) => s.parentId === null && s.name === name,
      )
      if (own.length) {
        out.push(...own)
        continue
      }
      if (depth >= 3) continue
      for (const imp of e.outline.imports) {
        if (!imp.reexport) continue
        const via = imp.names.find((n) => n.local === name || n.local === "*")
        if (!via) continue
        const { files } = (this.resolvers as Record<Universe, ModuleResolver>)[
          u
        ].resolve(e.language, e.path, imp.module)
        out.push(
          ...this.exported(
            u,
            files,
            via.imported === "*" ? name : via.imported,
            depth + 1,
          ),
        )
      }
    }
    return out
  }

  private importFor(e: Entry, local: string): RawImport | null {
    for (const imp of e.outline.imports)
      if (imp.names.some((n) => n.local === local)) return imp
    return null
  }

  private enclosingType(e: Entry, ownerIndex: number): CodeSymbol | null {
    for (let i = ownerIndex; i >= 0;) {
      const s = e.symbols[i] as CodeSymbol
      if (TYPE_LIKE.has(s.kind)) return s
      i = e.outline.symbols[i]?.parent ?? -1
    }
    return null
  }

  /**
   * A definition found through an import: certain when the import names one
   * module; when several files fit the import, likely if only one of them
   * has it, else ambiguous.
   */
  private through(
    target: ModuleTarget,
    found: CodeSymbol[],
  ): Resolution | null {
    if (!found.length) return null
    if (!target.ambiguous)
      return { status: "resolved", targets: found.slice(0, 1), module: null }
    return new Set(found.map((s) => s.path)).size === 1
      ? { status: "likely", targets: found.slice(0, 1), module: null }
      : {
          status: "ambiguous",
          targets: found.slice(0, MAX_CANDIDATES),
          module: null,
        }
  }

  /** Members named `name` of a type: inside it, or (Go, Rust) declared beside it in its package. */
  private members(u: Universe, type: CodeSymbol, name: string): CodeSymbol[] {
    const own = (this.symbolsById.get(type.id)?.entry.symbols ?? []).filter(
      (s) => s.parentId === type.id && s.name === name,
    )
    if (own.length) return own
    const dir = dirOf(type.path)
    return (this.byName[u].get(name) ?? []).filter(
      (s) =>
        s.qualifiedName === `${type.qualifiedName}.${name}` &&
        dirOf(s.path) === dir,
    )
  }

  /**
   * A member use on a parameter or local with a declared type: `order: Order`
   * makes `order.save()` Order.save; a library or built-in type makes it
   * external. Null when the type is unknown or doesn't have the member.
   */
  private byType(u: Universe, e: Entry, r: RawReference): Resolution | null {
    const t = r.receiverType
    if (!t) return null
    const dot = t.lastIndexOf(".")
    const res = this.deterministic(
      e.side,
      e,
      {
        kind: "references",
        name: t.slice(dot + 1),
        line: r.line,
        col: r.col,
        endCol: r.endCol,
        receiver: dot > 0 ? t.slice(0, dot) : null,
        receiverLocal: false,
        receiverType: null,
        args: null,
        owner: r.owner,
      },
      u,
    )
    if (res?.status === "external")
      return { status: "external", targets: [], module: res.module }
    const type = res?.targets.find((s) => TYPE_LIKE.has(s.kind))
    if (type) {
      const found = this.members(u, type, r.name).filter((s) =>
        compatible(r.kind, s),
      )
      return found.length
        ? {
            status: res?.status === "resolved" ? "resolved" : "likely",
            targets: found.slice(0, 1),
            module: null,
          }
        : null
    }
    return BUILTIN_TYPES.has(t)
      ? { status: "external", targets: [], module: null }
      : null
  }

  /** Resolution by deterministic rules only; null when none applies. */
  private deterministic(
    side: Side | "both",
    e: Entry,
    r: RawReference,
    u0?: Universe,
  ): Resolution | null {
    const u = this.universeOf(e, u0 ?? (side === "base" ? "base" : "head"))
    const resolver = (this.resolvers as Record<Universe, ModuleResolver>)[u]
    const fits = (list: CodeSymbol[]) =>
      list.filter((s) => compatible(r.kind, s))
    const resolved = (targets: CodeSymbol[]): Resolution | null =>
      targets.length
        ? { status: "resolved", targets: targets.slice(0, 1), module: null }
        : null
    const external = (module: string): Resolution => ({
      status: "external",
      targets: [],
      module,
    })

    if (r.receiver) {
      // this.x / self.x: a member of the enclosing class.
      if (SELF.has(r.receiver)) {
        const type = this.enclosingType(e, r.owner)
        if (type)
          return resolved(
            fits(
              e.symbols.filter(
                (s) => s.parentId === type.id && s.name === r.name,
              ),
            ),
          )
        return null
      }
      // A parameter or local: only its declared type says what it is.
      if (r.receiverLocal) return this.byType(u, e, r)
      // Only the receiver as a whole names a module or class: `refunds.issue()`, not `refunds.client.issue()`.
      const head = r.receiver
      const imp = this.importFor(e, head)
      if (imp) {
        const spec = imp.names.find((n) => n.local === head)
        const target = resolver.resolve(e.language, e.path, imp.module)
        if (!target.files.length) return external(imp.module)
        if (spec?.imported === "*")
          // A namespace import: refunds.issue() is issue() in that module.
          return (
            this.through(
              target,
              fits(this.exported(u, target.files, r.name)),
            ) ?? external(imp.module)
          )
        // An imported class: AuditLog.write() is a member of AuditLog.
        const type = this.exported(
          u,
          target.files,
          spec?.imported ?? head,
        ).find((s) => TYPE_LIKE.has(s.kind))
        if (type)
          return this.through(target, fits(this.members(u, type, r.name)))
        return null
      }
      // A class defined in this file: Service.create().
      const local = e.symbols.find(
        (s) => s.parentId === null && s.name === head && TYPE_LIKE.has(s.kind),
      )
      if (local)
        return resolved(
          fits(
            e.symbols.filter(
              (s) => s.parentId === local.id && s.name === r.name,
            ),
          ),
        )
      return null
    }

    // Same file: the closest definition by that name.
    const byId = new Map(e.symbols.map((s) => [s.id, s]))
    const memberOfType = (s: CodeSymbol) => {
      const p = s.parentId ? byId.get(s.parentId) : undefined
      return p !== undefined && TYPE_LIKE.has(p.kind)
    }
    const bare = MEMBERS_NEED_RECEIVER.has(familyOf(e.language))
    const inFile = fits(
      e.symbols.filter((s) => s.name === r.name && !(bare && memberOfType(s))),
    )
    if (inFile.length) {
      const owner = r.owner >= 0 ? (e.symbols[r.owner] as CodeSymbol) : null
      const scoped = inFile.find(
        (s) =>
          s.parentId === null ||
          s.parentId === owner?.id ||
          s.parentId === owner?.parentId,
      )
      return resolved([scoped ?? (inFile[0] as CodeSymbol)])
    }
    // A named import.
    const imp = this.importFor(e, r.name)
    if (imp) {
      const spec = imp.names.find((n) => n.local === r.name)
      const target = resolver.resolve(e.language, e.path, imp.module)
      if (!target.files.length) return external(imp.module)
      // A namespace import's own name (`refunds` in `refunds.issue()`) is the module.
      if (spec?.imported === "*")
        return this.through(
          target,
          target.files.flatMap((f) => this.byPath[u].get(f)?.module ?? []),
        )
      const found = fits(
        this.exported(
          u,
          target.files,
          spec?.imported === "default" ? r.name : (spec?.imported ?? r.name),
        ),
      )
      if (found.length) return this.through(target, found)
      if (spec?.imported === "default" && !target.ambiguous) {
        const def = this.byPath[u]
          .get(target.files[0] as string)
          ?.symbols.filter((s) => s.parentId === null && compatible(r.kind, s))
        if (def?.length === 1) return resolved(def)
      }
      return external(imp.module)
    }
    // Wildcard imports and includes.
    for (const w of e.outline.imports) {
      if (!w.names.some((n) => n.local === "*")) continue
      const target = resolver.resolve(e.language, e.path, w.module)
      const found = this.through(
        target,
        fits(this.exported(u, target.files, r.name)),
      )
      if (found) return found
    }
    // The same Go or Java package.
    if (samePackage(e.language)) {
      const dir = e.path.slice(0, e.path.lastIndexOf("/") + 1)
      const found = fits(
        (this.byName[u].get(r.name) ?? []).filter(
          (s) =>
            s.parentId === null &&
            s.language === e.language &&
            s.path.startsWith(dir) &&
            !s.path.slice(dir.length).includes("/"),
        ),
      )
      if (found.length) return resolved(found)
    }
    return null
  }

  private resolve(u: Universe, e: Entry, r: RawReference): Resolution | null {
    const d = this.deterministic(e.side, e, r, u)
    if (d) return d
    if (r.kind === "read") return null
    if (r.receiver && !SELF.has(r.receiver) && BUILTIN_METHODS.has(r.name))
      return { status: "external", targets: [], module: null }
    const family = familyOf(e.language)
    const pool = (this.byName[u].get(r.name) ?? []).filter(
      (s) => familyOf(s.language) === family && compatible(r.kind, s),
    )
    // A member use (`order.total()`) can only be a method or field, which Go declares outside its type.
    const candidates = r.receiver
      ? pool.filter(
          (s) =>
            s.kind === "method" || (MEMBER.has(s.kind) && s.parentId !== null),
        )
      : pool
    if (candidates.length === 0)
      return { status: "external", targets: [], module: null }
    const ranked = this.rank(e, r, candidates)
    const common = this.truncated.has(r.name)
    // The name alone is no evidence: likely only when the file can reach the definition, else possible.
    const sure = (s: CodeSymbol): Resolution => ({
      status: this.evident(u, e, r, s) ? "likely" : "possible",
      targets: [s],
      module: null,
    })
    if (ranked.length === 1 && !common) return sure(ranked[0] as CodeSymbol)
    // Arity can single out one candidate among several.
    if (r.args !== null) {
      const arity = ranked.filter((s) => this.params(s) === r.args)
      if (
        arity.length === 1 &&
        ranked.every((s) => this.params(s) !== null) &&
        !common
      )
        return sure(arity[0] as CodeSymbol)
    }
    // So can evidence: the one candidate the file reaches.
    const evident = ranked.filter((s) => this.evident(u, e, r, s))
    if (evident.length === 1 && !common)
      return { status: "likely", targets: evident, module: null }
    return {
      status: "ambiguous",
      targets: ranked.slice(0, MAX_CANDIDATES),
      module: null,
    }
  }

  /**
   * Something besides the name points at a by-name match: the receiver's
   * declared type is its class, it's in the same file or Go/Java package, or
   * the using file reaches its file through imports.
   */
  private evident(
    u: Universe,
    e: Entry,
    r: RawReference,
    s: CodeSymbol,
  ): boolean {
    if (r.receiverType) {
      const container = s.qualifiedName.split(".").slice(-2, -1)[0]
      if (container && container === r.receiverType.split(".").pop())
        return true
    }
    if (s.path === e.path) return true
    if (
      samePackage(e.language) &&
      s.language === e.language &&
      dirOf(s.path) === dirOf(e.path)
    )
      return true
    return this.reachable(u, e.path).has(s.path)
  }

  /** Files a file imports, directly or through up to IMPORT_HOPS - 1 more indexed files. */
  private reachable(u: Universe, path: string): Set<string> {
    const cached = this.reach[u].get(path)
    if (cached) return cached
    const resolver = (this.resolvers as Record<Universe, ModuleResolver>)[u]
    const seen = new Set<string>()
    let frontier = [path]
    for (let hop = 0; hop < IMPORT_HOPS && frontier.length; hop++) {
      const next: string[] = []
      for (const p of frontier) {
        const e = this.byPath[u].get(p)
        if (!e) continue
        for (const imp of e.outline.imports)
          for (const f of resolver.resolve(e.language, e.path, imp.module)
            .files)
            if (!seen.has(f)) {
              seen.add(f)
              next.push(f)
            }
      }
      frontier = next
    }
    this.reach[u].set(path, seen)
    return seen
  }

  private params(s: CodeSymbol): number | null {
    const hit = this.symbolsById.get(s.id)
    if (!hit) return null
    const i = hit.entry.symbols.indexOf(s)
    return i >= 0 ? (hit.entry.outline.symbols[i]?.params ?? null) : null
  }

  private rank(e: Entry, r: RawReference, list: CodeSymbol[]): CodeSymbol[] {
    const dir = e.path.slice(0, e.path.lastIndexOf("/"))
    const top = e.path.split("/")[0]
    const score = (s: CodeSymbol) =>
      (s.path.slice(0, s.path.lastIndexOf("/")) === dir ? 4 : 0) +
      (s.path.split("/")[0] === top ? 1 : 0) +
      (s.language === e.language ? 1 : 0) +
      (r.args !== null && this.params(s) === r.args ? 2 : 0)
    return list.toSorted(
      (a, b) => score(b) - score(a) || a.path.localeCompare(b.path),
    )
  }

  // ---- Connections ------------------------------------------------------------------

  /** Ids that are the same on Base and Head: a matched Base Symbol takes its Head counterpart's. */
  private canonical(s: CodeSymbol): string {
    return s.side === "base" && s.counterpartId ? s.counterpartId : s.id
  }

  private connect(u: Universe) {
    const changedNames = new Set<string>()
    for (const e of this.entries)
      if (e.side !== "both") for (const s of e.symbols) changedNames.add(s.name)
    const byKey = new Map<string, Connection>()
    const add = (
      from: CodeSymbol,
      kind: ConnectionKind,
      name: string,
      res: Resolution,
      site: ConnectionSite,
    ) => {
      const target =
        res.status === "resolved" ||
        res.status === "likely" ||
        res.status === "possible"
          ? (res.targets[0] as CodeSymbol)
          : null
      const targetKey = target
        ? this.canonical(target)
        : res.status === "ambiguous"
          ? `?${name}`
          : `!${res.module ?? ""}\0${name}`
      const id = shortHash(`${this.canonical(from)}\0${kind}\0${targetKey}`)
      let c = byKey.get(id)
      if (!c) {
        c = {
          id,
          kind,
          fromId: from.id,
          toId: target?.id ?? null,
          name,
          status: res.status,
          candidates:
            res.status === "ambiguous" ? res.targets.map((t) => t.id) : [],
          module: res.module,
          sites: [],
          change: null,
        }
        byKey.set(id, c)
      }
      c.sites.push(site)
      this.sites.set(`${u}\0${site.path}\0${site.line}\0${site.col}`, id)
    }

    for (const e of this.entries) {
      if (e.side !== "both" && e.side !== u) continue
      const neighbor = e.side === "both"
      for (const r of e.outline.references) {
        // Neighbors matter only where they use the changed code.
        if (neighbor && !changedNames.has(r.name)) continue
        const res = this.resolve(u, e, r)
        if (!res) continue
        const from =
          r.owner >= 0 ? (e.symbols[r.owner] as CodeSymbol) : e.module
        // A Symbol using itself by name (recursion aside) is its own declaration.
        if (res.targets[0]?.id === from.id && r.kind !== "calls") continue
        add(from, r.kind === "read" ? "references" : r.kind, r.name, res, {
          side: u,
          path: e.path,
          line: r.line + 1,
          col: r.col,
          endCol: r.endCol,
        })
      }
      if (neighbor) continue
      const resolver = (this.resolvers as Record<Universe, ModuleResolver>)[u]
      for (const imp of e.outline.imports) {
        const target = resolver.resolve(e.language, e.path, imp.module)
        const { files } = target
        for (const n of imp.names) {
          const site: ConnectionSite = {
            side: u,
            path: e.path,
            line: imp.line + 1,
            col: 0,
            endCol: 0,
          }
          if (!files.length) {
            add(
              e.module,
              "imports",
              n.imported === "*" || n.imported === "default"
                ? imp.module
                : n.imported,
              { status: "external", targets: [], module: imp.module },
              site,
            )
            continue
          }
          if (n.imported === "*") {
            const modules = files.flatMap((f) => {
              const m = this.byPath[u].get(f)?.module
              return m ? [m] : []
            })
            if (modules.length)
              add(
                e.module,
                "imports",
                imp.module,
                target.ambiguous && modules.length > 1
                  ? {
                      status: "ambiguous",
                      targets: modules.slice(0, MAX_CANDIDATES),
                      module: null,
                    }
                  : {
                      status: "resolved",
                      targets: modules.slice(0, 1),
                      module: null,
                    },
                site,
              )
            continue
          }
          const found = this.exported(
            u,
            files,
            n.imported === "default" ? n.local : n.imported,
          )
          add(
            e.module,
            "imports",
            n.imported === "default" ? n.local : n.imported,
            this.through(target, found) ?? {
              status: "external",
              targets: [],
              module: imp.module,
            },
            site,
          )
        }
      }
    }

    for (const c of byKey.values()) {
      this.ids[u].add(c.id)
      this.connectionsById.set(`${u}\0${c.id}`, c)
      const from = this.symbolsById.get(c.fromId)?.symbol
      if (from) push(this.outgoing[u], this.canonical(from), c)
      const to = c.toId ? this.symbolsById.get(c.toId)?.symbol : null
      if (to) push(this.incoming[u], this.canonical(to), c)
      for (const cand of c.candidates) {
        const s = this.symbolsById.get(cand)?.symbol
        if (s) push(this.incoming[u], this.canonical(s), c)
      }
    }
  }

  // ---- Queries ------------------------------------------------------------------

  /** Fragment dependencies, reach and test links for the Walkthrough planner. */
  fragmentGraph(files: FileChange[]): FragmentGraph {
    return buildFragmentGraph(this, files)
  }

  /** Every Connection made on one side. */
  connectionsOn(side: Side): Connection[] {
    const out: Connection[] = []
    for (const id of this.ids[side]) {
      const c = this.connectionsById.get(`${side}\0${id}`)
      if (c) out.push(c)
    }
    return out
  }

  /** Connections into a Symbol on one side. */
  incomingOn(side: Side, id: string): Connection[] {
    const s = this.symbol(id)
    return s ? (this.incoming[side].get(this.canonical(s)) ?? []) : []
  }

  /** The id a Symbol has on Head when it was matched, else its own. */
  canonicalId(id: string): string {
    const s = this.symbol(id)
    return s ? this.canonical(s) : id
  }

  /** Symbols of a changed file on one side, by path. */
  symbolsAt(side: Side, path: string): CodeSymbol[] {
    const e = this.byPath[side].get(path)
    return e && e.side !== "both" ? e.symbols : []
  }

  symbol(id: string): CodeSymbol | null {
    return this.symbolsById.get(id)?.symbol ?? null
  }

  /** Symbols of one changed file, both sides. */
  fileSymbols(fileId: string): { base: CodeSymbol[]; head: CodeSymbol[] } {
    const out = { base: [] as CodeSymbol[], head: [] as CodeSymbol[] }
    for (const e of this.entries) {
      if (e.fileId !== fileId) continue
      if (e.side === "base") out.base = e.symbols
      if (e.side === "head") out.head = e.symbols
    }
    return out
  }

  /** Uses and Used by for a Symbol, with Connection changes against the other side. */
  forSymbol(id: string): SymbolConnections | null {
    const hit = this.symbolsById.get(id)
    if (!hit) return null
    let symbol = hit.symbol
    // Show a matched Base Symbol from its Head side; removed Connections come along.
    if (symbol.side === "base" && symbol.counterpartId)
      symbol = this.symbol(symbol.counterpartId) ?? symbol
    const key = this.canonical(symbol)
    const counterpart = symbol.counterpartId
      ? this.symbol(symbol.counterpartId)
      : null
    const merge = (
      map: Record<Universe, Map<string, Connection[]>>,
    ): Connection[] => {
      const head = (map.head.get(key) ?? []).map((c) => ({
        ...c,
        change: this.ids.base.has(c.id) ? null : ("added" as const),
      }))
      const base = (map.base.get(key) ?? [])
        .filter((c) => !this.ids.head.has(c.id))
        .map((c) => ({ ...c, change: "removed" as const }))
      return [...head, ...base].toSorted(order)
    }
    const uses = merge(this.outgoing)
    const usedBy = merge(this.incoming)
    const symbols: Record<string, CodeSymbol> = {}
    const note = (sid: string | null) => {
      const s = sid ? this.symbol(sid) : null
      if (s) symbols[s.id] = s
    }
    for (const c of [...uses, ...usedBy]) {
      note(c.fromId)
      note(c.toId)
      for (const cand of c.candidates) note(cand)
    }
    note(symbol.id)
    if (counterpart) note(counterpart.id)
    return {
      symbol,
      counterpart,
      uses,
      usedBy,
      symbols,
      scope: this.status.scope,
    }
  }

  /** The Symbol around a position and, on a use, what it refers to. Line 1-based, column 0-based. */
  at(side: Side, path: string, line: number, col: number): PositionInfo {
    const e = this.byPath[side].get(path)
    if (!e) return { symbol: null, connection: null, targets: [] }
    let symbol: CodeSymbol | null = null
    for (const s of e.symbols)
      if (
        s.startLine <= line &&
        line <= s.endLine &&
        (!symbol || s.startLine >= symbol.startLine)
      )
        symbol = s
    const ref = e.outline.references.find(
      (r) => r.line === line - 1 && r.col <= col && col < r.endCol,
    )
    if (!ref) return { symbol, connection: null, targets: [] }
    const id = this.sites.get(`${side}\0${path}\0${line}\0${ref.col}`)
    const c = id ? (this.connectionsById.get(`${side}\0${id}`) ?? null) : null
    if (!c) return { symbol, connection: null, targets: [] }
    const targets = (c.toId ? [c.toId] : c.candidates)
      .map((t) => this.symbol(t))
      .filter((s): s is CodeSymbol => s !== null)
    return { symbol, connection: c, targets }
  }

  /** A Symbol's code, highlighted, for previews. */
  async source(id: string, contextLines = 0): Promise<SymbolSource | null> {
    const hit = this.symbolsById.get(id)
    if (!hit) return null
    const { symbol, entry } = hit
    const parsed = await this.input.parsing.parse({
      oid: entry.oid,
      language: entry.language,
      lines: entry.lines,
      tokens: true,
    })
    const first = Math.max(1, symbol.startLine - contextLines)
    const last = Math.min(entry.lines.length, symbol.endLine + contextLines)
    return {
      symbol,
      firstLine: first,
      lines: entry.lines.slice(first - 1, last),
      tokens: parsed.tokens?.slice(first - 1, last) ?? null,
    }
  }

  /** Connection changes touching a Symbol, for Explanations. */
  connectionChanges(id: string): {
    uses: Connection[]
    usedBy: Connection[]
    symbols: Record<string, CodeSymbol>
  } {
    const all = this.forSymbol(id)
    if (!all) return { uses: [], usedBy: [], symbols: {} }
    return {
      uses: all.uses.filter((c) => c.change !== null),
      usedBy: all.usedBy.filter((c) => c.change !== null),
      symbols: all.symbols,
    }
  }

  /**
   * The Symbols that code spans in prose (an Explanation's `backticked`
   * names) most likely mean, best first; empty when a span isn't a Symbol
   * name. `near` ranks the explained file and Symbols connected to the
   * explained ones first.
   */
  lookup(
    names: string[],
    near: { path: string | null; symbolIds: string[] },
  ): Record<string, CodeSymbol[]> {
    const related = new Set<string>()
    for (const id of near.symbolIds) {
      const all = this.forSymbol(id)
      if (!all) continue
      for (const c of [...all.uses, ...all.usedBy]) {
        if (c.status === "possible") continue
        if (c.toId) related.add(c.toId)
        related.add(c.fromId)
        for (const cand of c.candidates) related.add(cand)
      }
    }
    const score = (s: CodeSymbol) =>
      (near.path !== null && s.path === near.path ? 3 : 0) +
      (related.has(s.id) ? 4 : 0) +
      (this.symbolsById.get(s.id)?.entry.side === "both" ? 0 : 1) +
      (s.side === "head" ? 0.5 : 0)
    const out: Record<string, CodeSymbol[]> = {}
    for (const raw of names) {
      const found = this.candidatesFor(normalizeCodeSpan(raw))
      out[raw] = found
        .toSorted(
          (a, b) =>
            score(b) - score(a) ||
            a.qualifiedName.localeCompare(b.qualifiedName),
        )
        .slice(0, 5)
    }
    return out
  }

  private candidatesFor(text: string | null): CodeSymbol[] {
    if (!text) return []
    const seen = new Map<string, CodeSymbol>()
    const add = (s: CodeSymbol) => {
      // One per Symbol: a matched Base Symbol is shown by its Head counterpart.
      const shown =
        s.side === "base" && s.counterpartId ? this.symbol(s.counterpartId) : s
      if (shown) seen.set(shown.id, shown)
    }
    if (PATH_LIKE.test(text)) {
      for (const e of this.entries)
        if (e.path === text || e.path.endsWith(`/${text}`)) add(e.module)
      return [...seen.values()]
    }
    if (text.includes(".")) {
      for (const { symbol } of this.symbolsById.values())
        if (
          symbol.kind !== "module" &&
          (symbol.qualifiedName === text ||
            symbol.qualifiedName.endsWith(`.${text}`))
        )
          add(symbol)
      return [...seen.values()]
    }
    for (const s of this.byName.head.get(text) ?? []) add(s)
    for (const s of this.byName.base.get(text) ?? []) add(s)
    return [...seen.values()]
  }
}

const PATH_LIKE =
  /\/|\.(?:[cm]?[jt]sx?|py|go|rs|java|c|cc|cpp|h|hpp|cs|rb|php|scala|lua|exs?|ml|json|ya?ml|toml|css|html|sh|zig|tf)$/

/**
 * The name a code span refers to: `foo()` → foo, `new Foo<T>(x)` → Foo,
 * `this.bar` → bar, `println!` → println, `src/a.ts` stays a path. Null for
 * anything that isn't a name or dotted name (`a + b`, `'refund.issued'`).
 */
export function normalizeCodeSpan(raw: string): string | null {
  let t = raw.trim()
  if (PATH_LIKE.test(t) && /^[\w./@-]+$/.test(t)) return t.replace(/^\.\//, "")
  t = t.replace(/^new\s+/, "")
  t = t.replace(/\(.*\)$/s, "")
  t = t.replace(/<.*>$/s, "")
  t = t.replace(/!$/, "")
  t = t.replace(/^(?:this|self)\.|^@/, "")
  t = t.replace(/::/g, ".")
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(t) ? t : null
}

function push(map: Map<string, Connection[]>, key: string, c: Connection) {
  const list = map.get(key)
  if (list) list.push(c)
  else map.set(key, [c])
}

const STATUS_ORDER: Record<ConnectionStatus, number> = {
  resolved: 0,
  likely: 1,
  ambiguous: 2,
  possible: 3,
  external: 4,
}
const KIND_ORDER: Record<ConnectionKind, number> = {
  calls: 0,
  implements: 1,
  references: 2,
  imports: 3,
}

/** Connection changes first, then by kind, how sure, and name. */
function order(a: Connection, b: Connection): number {
  return (
    Number(b.change !== null) - Number(a.change !== null) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.name.localeCompare(b.name)
  )
}
