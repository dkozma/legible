// Import statements, per language family, as module specifiers plus the
// names they bring into scope. Resolution (module → file) happens later, in
// resolve.ts, because it needs the list of files in the commit.

import type { Node } from "web-tree-sitter"

export interface ImportedName {
  /** The name in the module: an identifier, "default", or "*" for the whole module. */
  imported: string
  /** The name in this file; "*" when every name comes in unqualified (wildcards, Go dot-imports). */
  local: string
}

export interface RawImport {
  /** As written: "./refunds", ".models", "os.path", "github.com/acme/app/refunds", "crate::refunds", "com.acme.refunds". */
  module: string
  names: ImportedName[]
  /** `export … from`: the names also become part of this module. */
  reexport: boolean
  /** 0-based. */
  line: number
}

const unquote = (s: string) => s.replace(/^["'`<]|["'`>]$/g, "")

export function extractImports(language: string, root: Node): RawImport[] {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
    case "jsx":
      return jsImports(root)
    case "python":
      return pythonImports(root)
    case "go":
      return goImports(root)
    case "rust":
      return rustImports(root)
    case "java":
      return javaImports(root)
    case "c":
    case "cpp":
      return cIncludes(root)
    default:
      return []
  }
}

function jsImports(root: Node): RawImport[] {
  const out: RawImport[] = []
  for (const n of root.namedChildren) {
    if (!n) continue
    if (n.type === "import_statement") {
      const source = n.childForFieldName("source")
      if (!source) continue
      const names: ImportedName[] = []
      for (const clause of n.namedChildren) {
        if (clause?.type !== "import_clause") continue
        for (const c of clause.namedChildren) {
          if (!c) continue
          if (c.type === "identifier")
            names.push({ imported: "default", local: c.text })
          else if (c.type === "namespace_import") {
            const id = c.namedChildren.find((x) => x?.type === "identifier")
            if (id) names.push({ imported: "*", local: id.text })
          } else if (c.type === "named_imports") {
            for (const spec of c.namedChildren) {
              if (spec?.type !== "import_specifier") continue
              const name = spec.childForFieldName("name")?.text
              const alias = spec.childForFieldName("alias")?.text
              if (name) names.push({ imported: name, local: alias ?? name })
            }
          }
        }
      }
      out.push({
        module: unquote(source.text),
        names,
        reexport: false,
        line: n.startPosition.row,
      })
    } else if (n.type === "export_statement") {
      const source = n.childForFieldName("source")
      if (!source) continue
      const names: ImportedName[] = []
      const clause = n.namedChildren.find((c) => c?.type === "export_clause")
      if (clause) {
        for (const spec of clause.namedChildren) {
          if (spec?.type !== "export_specifier") continue
          const name = spec.childForFieldName("name")?.text
          const alias = spec.childForFieldName("alias")?.text
          if (name) names.push({ imported: name, local: alias ?? name })
        }
      } else {
        const ns = n.namedChildren.find((c) => c?.type === "namespace_export")
        const id = ns?.namedChildren.find((c) => c?.type === "identifier")
        names.push(
          id
            ? { imported: "*", local: id.text }
            : { imported: "*", local: "*" },
        )
      }
      out.push({
        module: unquote(source.text),
        names,
        reexport: true,
        line: n.startPosition.row,
      })
    } else if (
      n.type === "lexical_declaration" ||
      n.type === "variable_declaration"
    ) {
      // const x = require("./x"), const { a, b: c } = require("./x")
      for (const d of n.namedChildren) {
        if (d?.type !== "variable_declarator") continue
        const value = d.childForFieldName("value")
        if (value?.type !== "call_expression") continue
        if (value.childForFieldName("function")?.text !== "require") continue
        const arg = value.childForFieldName("arguments")?.namedChildren[0]
        if (arg?.type !== "string") continue
        const name = d.childForFieldName("name")
        const names: ImportedName[] = []
        if (name?.type === "identifier")
          names.push({ imported: "*", local: name.text })
        else if (name?.type === "object_pattern") {
          for (const p of name.namedChildren) {
            if (p?.type === "shorthand_property_identifier_pattern")
              names.push({ imported: p.text, local: p.text })
            else if (p?.type === "pair_pattern") {
              const k = p.childForFieldName("key")?.text
              const v = p.childForFieldName("value")
              if (k && v?.type === "identifier")
                names.push({ imported: k, local: v.text })
            }
          }
        }
        out.push({
          module: unquote(arg.text),
          names,
          reexport: false,
          line: n.startPosition.row,
        })
      }
    }
  }
  return out
}

function pythonImports(root: Node): RawImport[] {
  const out: RawImport[] = []
  for (const n of root.descendantsOfType([
    "import_statement",
    "import_from_statement",
  ])) {
    if (!n) continue
    const line = n.startPosition.row
    if (n.type === "import_statement") {
      for (const c of n.namedChildren) {
        if (!c) continue
        if (c.type === "dotted_name")
          // `import a.b` binds `a`; uses look like a.b.f().
          out.push({
            module: c.text,
            names: [{ imported: "*", local: c.text }],
            reexport: false,
            line,
          })
        else if (c.type === "aliased_import") {
          const mod = c.childForFieldName("name")?.text
          const alias = c.childForFieldName("alias")?.text
          if (mod && alias)
            out.push({
              module: mod,
              names: [{ imported: "*", local: alias }],
              reexport: false,
              line,
            })
        }
      }
      continue
    }
    const mod = n.childForFieldName("module_name")?.text
    if (!mod) continue
    const names: ImportedName[] = []
    for (const c of n.childrenForFieldName("name")) {
      if (!c) continue
      if (c.type === "dotted_name")
        names.push({ imported: c.text, local: c.text })
      else if (c.type === "aliased_import") {
        const name = c.childForFieldName("name")?.text
        const alias = c.childForFieldName("alias")?.text
        if (name) names.push({ imported: name, local: alias ?? name })
      }
    }
    if (n.namedChildren.some((c) => c?.type === "wildcard_import"))
      names.push({ imported: "*", local: "*" })
    out.push({ module: mod, names, reexport: false, line })
  }
  return out
}

function goImports(root: Node): RawImport[] {
  const out: RawImport[] = []
  for (const spec of root.descendantsOfType("import_spec")) {
    if (!spec) continue
    const path = spec.childForFieldName("path")
    if (!path) continue
    const module = unquote(path.text)
    const alias = spec.childForFieldName("name")?.text
    if (alias === "_") continue
    const local =
      alias === "." ? "*" : (alias ?? module.split("/").pop() ?? module)
    out.push({
      module,
      names: [{ imported: "*", local }],
      reexport: false,
      line: spec.startPosition.row,
    })
  }
  return out
}

function rustImports(root: Node): RawImport[] {
  const out: RawImport[] = []
  const walk = (node: Node, prefix: string, line: number) => {
    const join = (a: string, b: string) => (a && b ? `${a}::${b}` : a || b)
    switch (node.type) {
      case "scoped_identifier": {
        const path = node.childForFieldName("path")?.text ?? ""
        const name = node.childForFieldName("name")?.text
        if (name)
          out.push({
            module: join(prefix, path),
            names: [{ imported: name, local: name }],
            reexport: false,
            line,
          })
        return
      }
      case "identifier":
        out.push({
          module: prefix,
          names: [{ imported: node.text, local: node.text }],
          reexport: false,
          line,
        })
        return
      case "use_as_clause": {
        const path = node.childForFieldName("path")
        const alias = node.childForFieldName("alias")?.text
        if (!path || !alias) return
        const p =
          path.type === "scoped_identifier"
            ? (path.childForFieldName("path")?.text ?? "")
            : ""
        const name =
          path.type === "scoped_identifier"
            ? path.childForFieldName("name")?.text
            : path.text
        if (name)
          out.push({
            module: join(prefix, p),
            names: [{ imported: name, local: alias }],
            reexport: false,
            line,
          })
        return
      }
      case "use_wildcard": {
        const p = node.namedChildren[0]?.text ?? ""
        out.push({
          module: join(prefix, p),
          names: [{ imported: "*", local: "*" }],
          reexport: false,
          line,
        })
        return
      }
      case "scoped_use_list": {
        const p = node.childForFieldName("path")?.text ?? ""
        const list = node.childForFieldName("list")
        for (const c of list?.namedChildren ?? [])
          if (c) walk(c, join(prefix, p), line)
        return
      }
      case "use_list":
        for (const c of node.namedChildren) if (c) walk(c, prefix, line)
        return
      default:
        return
    }
  }
  for (const n of root.descendantsOfType("use_declaration")) {
    const arg = n?.childForFieldName("argument")
    if (n && arg) walk(arg, "", n.startPosition.row)
  }
  return out
}

function javaImports(root: Node): RawImport[] {
  const out: RawImport[] = []
  for (const n of root.namedChildren) {
    if (n?.type !== "import_declaration") continue
    const path = n.namedChildren.find(
      (c) => c?.type === "scoped_identifier" || c?.type === "identifier",
    )
    if (!path) continue
    const wildcard = n.namedChildren.some((c) => c?.type === "asterisk")
    const text = path.text
    if (wildcard) {
      out.push({
        module: text,
        names: [{ imported: "*", local: "*" }],
        reexport: false,
        line: n.startPosition.row,
      })
      continue
    }
    const dot = text.lastIndexOf(".")
    const name = text.slice(dot + 1)
    out.push({
      module: text.slice(0, Math.max(0, dot)),
      names: [{ imported: name, local: name }],
      reexport: false,
      line: n.startPosition.row,
    })
  }
  return out
}

function cIncludes(root: Node): RawImport[] {
  const out: RawImport[] = []
  for (const n of root.descendantsOfType("preproc_include")) {
    const path = n?.childForFieldName("path")
    // <system> headers aren't in the repository.
    if (!n || path?.type !== "string_literal") continue
    out.push({
      module: unquote(path.text),
      names: [{ imported: "*", local: "*" }],
      reexport: false,
      line: n.startPosition.row,
    })
  }
  return out
}
