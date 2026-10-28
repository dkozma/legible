// Extracts what one file defines and uses from its parse tree: Symbols from
// tags @definition.* captures, references from @reference.* captures, and
// imports. Results depend only on the file's content and grammar, so they're
// cached by blob OID.

import type { ConnectionKind, SymbolKind } from "@legible/domain"
import type { Node, Query, Tree } from "web-tree-sitter"

import { extractImports, type RawImport } from "./imports"

export interface RawSymbol {
  kind: SymbolKind
  name: string
  /** Container names and the name, joined with ".". */
  qualifiedName: string
  /** 0-based, inclusive. */
  startLine: number
  endLine: number
  nameLine: number
  nameCol: number
  nameEndCol: number
  /** The declaration's head, up to its body, on one line. */
  signature: string
  /** Index of the enclosing Symbol in the same file, or -1. */
  parent: number
  /** Declared parameter count, when the grammar makes it evident. */
  params: number | null
}

/** How a name is used. "read" is any other use of a plain identifier. */
export type RawReferenceKind = Exclude<ConnectionKind, "imports"> | "read"

export interface RawReference {
  kind: RawReferenceKind
  name: string
  /** 0-based line; columns in UTF-16 code units. */
  line: number
  col: number
  endCol: number
  /** For member uses (`a.b()`): the receiver's text when it's a name or dotted names (`this`, `this.items`), else "?". */
  receiver: string | null
  /** The receiver is a parameter or local (`order` in `order.total()`), not a module or class. */
  receiverLocal: boolean
  /** That local's declared type, when it has one: `order: Order`, `new Order()`, `&Order{}` → "Order". */
  receiverType: string | null
  /** Argument count at a call site. */
  args: number | null
  /** Index of the innermost Symbol containing the use, or -1. */
  owner: number
}

export interface Outline {
  symbols: RawSymbol[]
  references: RawReference[]
  imports: RawImport[]
}

const DEFINITION_KINDS: Record<string, SymbolKind> = {
  function: "function",
  method: "method",
  class: "class",
  object: "class",
  interface: "interface",
  type: "type",
  module: "module",
  constant: "constant",
  enum_variant: "constant",
  variable: "variable",
  property: "field",
  field: "field",
  macro: "macro",
  enum: "enum",
  operator: "function",
}

const REFERENCE_KINDS: Record<string, RawReferenceKind> = {
  call: "calls",
  send: "calls",
  class: "references",
  type: "references",
  interface: "references",
  module: "references",
  field: "references",
  enum_variant: "references",
  implementation: "implements",
  read: "read",
}

/** Prefer the more specific use when several patterns capture the same name. */
const REFERENCE_RANK: Record<RawReferenceKind, number> = {
  implements: 0,
  calls: 1,
  references: 2,
  read: 3,
}

/** Nodes whose range is just the declarator; the Symbol spans the whole declaration. */
const DECLARATOR = /declarator$/
const DECLARATION = /(definition|declaration|_item|_specifier)$/

const MAX_SIGNATURE = 200

export function extractOutline(
  language: string,
  tree: Tree,
  tags: Query | null,
  locals: Query | null = null,
): Outline {
  const root = tree.rootNode
  const defs: (RawSymbol & { start: number; end: number; pattern: number })[] =
    []
  const refs: (RawReference & {
    pattern: number
    offset: number
    type: boolean
  })[] = []
  const defNames = new Set<number>()

  if (tags) {
    for (const m of tags.matches(root)) {
      let nameNode: Node | null = null
      let def: { node: Node; kind: string } | null = null
      let ref: { node: Node; kind: string } | null = null
      for (const c of m.captures) {
        if (c.name === "name") nameNode = c.node
        else if (c.name.startsWith("definition."))
          def = { node: c.node, kind: c.name.slice(11) }
        else if (c.name.startsWith("reference."))
          ref = { node: c.node, kind: c.name.slice(10) }
      }
      if (def) {
        const node = symbolNode(def.node)
        const nameAt = nameNode ?? node
        const name = nameNode
          ? nameNode.text
          : header(node.text).replace(/\s*\{$/, "")
        if (!name) continue
        defs.push({
          kind: DEFINITION_KINDS[def.kind] ?? "other",
          name: oneLine(name),
          qualifiedName: "",
          startLine: node.startPosition.row,
          endLine: Math.max(
            node.startPosition.row,
            node.endPosition.column === 0
              ? node.endPosition.row - 1
              : node.endPosition.row,
          ),
          nameLine: nameAt.startPosition.row,
          nameCol: nameAt.startPosition.column,
          nameEndCol:
            nameAt.endPosition.row === nameAt.startPosition.row
              ? nameAt.endPosition.column
              : nameAt.startPosition.column + 1,
          signature: signatureOf(node),
          parent: -1,
          params: paramCount(node),
          start: node.startIndex,
          end: node.endIndex,
          pattern: m.patternIndex,
        })
        defNames.add(nameAt.startIndex)
      } else if (ref && nameNode) {
        const kind = REFERENCE_KINDS[ref.kind]
        if (!kind) continue
        if (nameNode.startPosition.row !== nameNode.endPosition.row) continue
        // `const built = …` or a parameter declares a local; it isn't a use of anything.
        if (kind === "read" && isBinding(nameNode)) continue
        refs.push({
          kind,
          name: nameNode.text,
          line: nameNode.startPosition.row,
          col: nameNode.startPosition.column,
          endCol: nameNode.endPosition.column,
          receiver: receiverOf(nameNode),
          receiverLocal: false,
          receiverType: null,
          args: kind === "calls" ? argCount(ref.node) : null,
          owner: -1,
          pattern: m.patternIndex,
          offset: nameNode.startIndex,
          type: nameNode.type === "type_identifier",
        })
      }
    }
  }

  // One Symbol per declaration: overlapping patterns (TypeScript's and JavaScript's) keep the first.
  defs.sort(
    (a, b) => a.start - b.start || b.end - a.end || a.pattern - b.pattern,
  )
  const symbols: (RawSymbol & { start: number; end: number })[] = []
  for (const d of defs) {
    const last = symbols[symbols.length - 1]
    if (
      last &&
      last.start === d.start &&
      last.end === d.end &&
      last.name === d.name
    )
      continue
    const { pattern: _p, ...s } = d
    symbols.push(s)
  }

  // Containers by range: a stack of open Symbols.
  const stack: number[] = []
  symbols.forEach((s, i) => {
    while (stack.length) {
      const top = symbols[
        stack[stack.length - 1] as number
      ] as (typeof symbols)[number]
      if (s.start >= top.start && s.end <= top.end) break
      stack.pop()
    }
    s.parent = stack.length ? (stack[stack.length - 1] as number) : -1
    stack.push(i)
  })
  for (const s of symbols) {
    const parent = s.parent >= 0 ? symbols[s.parent] : undefined
    if (parent && s.kind === "function" && isTypeLike(parent.kind))
      s.kind = "method"
    const container = parent
      ? parent.qualifiedName
      : implicitContainer(language, root, s.start)
    s.qualifiedName = container ? `${container}.${s.name}` : s.name
  }

  // One reference per name position, the most specific kind; never the defining name itself.
  refs.sort(
    (a, b) =>
      a.line - b.line ||
      a.col - b.col ||
      REFERENCE_RANK[a.kind] - REFERENCE_RANK[b.kind],
  )
  const bindings = locals ? localBindings(root, locals, defNames) : null
  const fromStart = !SCOPE_WIDE.has(language)
  const references: RawReference[] = []
  let lastLine = -1
  let lastCol = -1
  for (const r of refs) {
    if (r.line === lastLine && r.col === lastCol) continue
    lastLine = r.line
    lastCol = r.col
    if (defNames.has(r.offset)) continue
    const { pattern: _p, offset, type, ...rest } = r
    if (bindings) {
      // A use of a parameter, local or type parameter is never a Connection.
      if (rest.receiver === null) {
        if (bindingAt(bindings, rest.name, offset, fromStart, type)) continue
      } else {
        const b = bindingAt(bindings, rest.receiver, offset, fromStart)
        if (b) {
          rest.receiverLocal = true
          rest.receiverType = b.type
        }
      }
    }
    rest.owner = innermost(symbols, offset)
    references.push(rest)
  }

  return {
    symbols: symbols.map(({ start: _s, end: _e, ...s }) => s),
    references,
    imports: extractImports(language, root),
  }
}

/**
 * Languages where a binding covers its whole scope, uses before it included
 * (`let`/`const`, Python locals, comprehension variables that follow their
 * body). Elsewhere (Go's `:=`) a binding starts where it's declared.
 */
const SCOPE_WIDE = new Set(["typescript", "tsx", "javascript", "python"])

interface Binding {
  /** The scope's byte range. */
  start: number
  end: number
  /** Where the name is bound. */
  at: number
  /** A type parameter (`<T>`), which only type names can mean, rather than a value. */
  typeParameter: boolean
  type: string | null
}

/**
 * Names bound in local scopes, from a locals query's @local.scope and
 * @local.definition captures. A binding that is itself a Symbol (a nested
 * `const helper = () => …`) isn't one: uses of it resolve to the Symbol.
 */
function localBindings(
  root: Node,
  locals: Query,
  symbolNames: Set<number>,
): Map<string, Binding[]> {
  const scopes = new Set<number>()
  const names: Node[] = []
  const typeParameters = new Set<number>()
  for (const c of locals.captures(root)) {
    if (c.name === "local.scope") scopes.add(c.node.id)
    else if (c.name === "local.definition") names.push(c.node)
    else if (c.name === "local.definition.type") {
      names.push(c.node)
      typeParameters.add(c.node.id)
    }
  }
  const out = new Map<string, Binding[]>()
  for (const n of names) {
    if (symbolNames.has(n.startIndex)) continue
    let scope = n.parent
    while (scope && !scopes.has(scope.id)) scope = scope.parent
    // Outside every local scope: a module-level name.
    if (!scope) continue
    const b: Binding = {
      start: scope.startIndex,
      end: scope.endIndex,
      at: n.startIndex,
      typeParameter: typeParameters.has(n.id),
      type: declaredType(n),
    }
    const list = out.get(n.text)
    if (list) list.push(b)
    else out.set(n.text, [b])
  }
  return out
}

/** The innermost binding of `name` in scope at `offset`, if any: a type parameter for a type name, else a value. */
function bindingAt(
  bindings: Map<string, Binding[]>,
  name: string,
  offset: number,
  fromStart: boolean,
  isType = false,
): Binding | null {
  let best: Binding | null = null
  for (const b of bindings.get(name) ?? [])
    if (
      b.typeParameter === isType &&
      b.start <= offset &&
      offset < b.end &&
      (!fromStart || b.at <= offset) &&
      (!best || b.start >= best.start)
    )
      best = b
  return best
}

/** The type a local is declared with or constructed as; null when the code doesn't say. */
function declaredType(name: Node): string | null {
  const p = name.parent
  if (!p) return null
  switch (p.type) {
    // TypeScript parameters; Python typed parameters; Go parameters and `var`.
    case "required_parameter":
    case "optional_parameter":
    case "typed_parameter":
    case "typed_default_parameter":
    case "parameter_declaration":
    case "variadic_parameter_declaration":
    case "var_spec":
      return typeName(p.childForFieldName("type"))
    case "variable_declarator": {
      const value = p.childForFieldName("value")
      return (
        typeName(p.childForFieldName("type")) ??
        (value?.type === "new_expression"
          ? simpleName(value.childForFieldName("constructor"))
          : null)
      )
    }
    // Python: `order: Order = …`, or `order = Order(…)` (classes are capitalized).
    case "assignment": {
      if (p.childForFieldName("left")?.id !== name.id) return null
      const value = p.childForFieldName("right")
      const callee =
        value?.type === "call"
          ? simpleName(value.childForFieldName("function"))
          : null
      return (
        typeName(p.childForFieldName("type")) ??
        (callee && /^[A-Z]/.test(callee.split(".").pop() ?? "") ? callee : null)
      )
    }
    // Go: `order := &Order{}`.
    case "expression_list": {
      const decl = p.parent
      if (decl?.type !== "short_var_declaration") return null
      const i = p.namedChildren.findIndex((c) => c?.id === name.id)
      let value = decl.childForFieldName("right")?.namedChildren[i] ?? null
      if (value?.type === "unary_expression")
        value = value.childForFieldName("operand")
      return value?.type === "composite_literal"
        ? typeName(value.childForFieldName("type"))
        : null
    }
    default:
      return null
  }
}

/** The named type in a type expression: `Order | null` → Order, `*Order` → Order, `Promise<Order>` → Promise, `Order[]` → Array. */
function typeName(t: Node | null): string | null {
  if (!t) return null
  switch (t.type) {
    case "type_annotation":
    case "type":
    case "pointer_type":
    case "parenthesized_type":
      return typeName(t.namedChildren[0] ?? null)
    case "union_type":
      for (const c of t.namedChildren)
        if (
          c &&
          c.type !== "literal_type" &&
          !/^(null|undefined|void)$/.test(c.text)
        )
          return typeName(c)
      return null
    // Python `Order | None`.
    case "binary_operator":
      return typeName(t.childForFieldName("left"))
    case "generic_type":
      return typeName(t.childForFieldName("name") ?? t.namedChildren[0] ?? null)
    // Python `Optional[Order]`, `list[Order]`.
    case "subscript": {
      const outer = simpleName(t.childForFieldName("value"))
      return outer === "Optional" || outer === "typing.Optional"
        ? typeName(t.childForFieldName("subscript"))
        : outer
    }
    case "array_type":
    case "slice_type":
      return "Array"
    case "type_identifier":
    case "identifier":
    case "predefined_type":
    case "nested_type_identifier":
    case "qualified_type":
    case "attribute":
      return simpleName(t)
    default:
      return null
  }
}

function simpleName(n: Node | null): string | null {
  return n && SIMPLE_RECEIVER.test(n.text) ? n.text : null
}

const BINDING_PARENT = /declarator|parameter|pattern|for_in_clause|catch_clause/

/** A name being declared (a local, parameter or destructured binding) rather than used. */
function isBinding(name: Node): boolean {
  const parent = name.parent
  if (!parent || !BINDING_PARENT.test(parent.type)) return false
  const declared =
    parent.childForFieldName("name") ?? parent.childForFieldName("left")
  return !declared || declared.startIndex === name.startIndex
}

function isTypeLike(k: SymbolKind) {
  return k === "class" || k === "interface" || k === "type" || k === "enum"
}

/** The innermost Symbol whose node contains `offset`. Symbols are sorted by start. */
function innermost(
  symbols: { start: number; end: number }[],
  offset: number,
): number {
  let best = -1
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i] as { start: number; end: number }
    if (s.start > offset) break
    if (offset < s.end) best = i
  }
  return best
}

/** C-family captures the declarator; the Symbol is the whole definition around it. */
function symbolNode(node: Node): Node {
  if (!DECLARATOR.test(node.type)) return node
  let n: Node | null = node.parent
  for (let i = 0; n && i < 4; i++, n = n.parent)
    if (DECLARATION.test(n.type) && !DECLARATOR.test(n.type)) return n
  return node
}

/** Go methods and Rust impl blocks name their type outside the method's own node. */
function implicitContainer(
  language: string,
  root: Node,
  start: number,
): string | null {
  const node = root.descendantForIndex(start)
  if (!node) return null
  if (language === "go") {
    for (let n: Node | null = node; n; n = n.parent) {
      if (n.type !== "method_declaration") continue
      const receiver = n.childForFieldName("receiver")
      const t = receiver?.descendantsOfType("type_identifier")[0]
      return t?.text ?? null
    }
  }
  if (language === "rust") {
    for (let n: Node | null = node.parent; n; n = n.parent) {
      if (n.type !== "impl_item") continue
      const t = n.childForFieldName("type")
      return t ? t.text.replace(/<.*$/s, "") : null
    }
  }
  return null
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

function header(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? ""
  return oneLine(firstLine).slice(0, MAX_SIGNATURE)
}

/** The declaration up to its body: `function refund(order: Order, cents?: number): Promise<void>`. */
function signatureOf(node: Node): string {
  const body =
    node.childForFieldName("body") ??
    node.childForFieldName("value")?.childForFieldName("body") ??
    null
  const text =
    body && body.startIndex > node.startIndex
      ? node.text.slice(0, body.startIndex - node.startIndex)
      : (node.text.split("\n", 1)[0] ?? "")
  const s = oneLine(text).replace(/[\s{:=]+$/, "")
  return s.length > MAX_SIGNATURE ? `${s.slice(0, MAX_SIGNATURE - 1)}…` : s
}

const NOT_ARGUMENT = new Set(["comment", "(", ")", ","])

function paramCount(node: Node): number | null {
  const params =
    node.childForFieldName("parameters") ??
    node.childForFieldName("value")?.childForFieldName("parameters") ??
    node.childForFieldName("declarator")?.childForFieldName("parameters") ??
    null
  if (!params) return null
  return params.namedChildren.filter((c) => c && !NOT_ARGUMENT.has(c.type))
    .length
}

function argCount(node: Node): number | null {
  const args = /argument/.test(node.type)
    ? node
    : (node.childForFieldName("arguments") ?? null)
  if (!args) return null
  return args.namedChildren.filter((c) => c && !NOT_ARGUMENT.has(c.type)).length
}

const SIMPLE_RECEIVER = /^[A-Za-z_$@][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/

/**
 * For a member use (`a.b()`): `this` in `this.audit()`, `refunds` in
 * `refunds.issue()`, `this.items` in `this.items.get()`, or "?" when the
 * receiver is an expression like `load().then()`. Null for a bare name.
 */
function receiverOf(name: Node): string | null {
  const parent = name.parent
  if (!parent) return null
  // `tiers[t]`: an index is a plain use, not a member.
  if (/subscript|index_expression/.test(parent.type)) return null
  // The name must be the member part of a member expression, not its object.
  const object =
    parent.childForFieldName("object") ??
    parent.childForFieldName("operand") ??
    parent.childForFieldName("receiver") ??
    (parent.type === "field_expression"
      ? parent.childForFieldName("value")
      : null) ??
    (parent.type === "scoped_identifier"
      ? parent.childForFieldName("path")
      : null)
  if (!object || object.startIndex === name.startIndex) return null
  if (object.endIndex > name.startIndex) return null
  const text = object.text
  return SIMPLE_RECEIVER.test(text) ? text : "?"
}
