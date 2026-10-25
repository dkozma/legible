# Lezer grammars highlight code until tree-sitter arrives in M2

M1 needs syntax highlighting, but tree-sitter, Language Tiers and the indexer utility process are M2 work. M1 highlights in the main process with Lezer grammars (CodeMirror's parsers, plus its legacy stream modes for languages without a Lezer grammar). They're pure JavaScript, so there's no WASM or native code. The output already uses the format the plan specifies for tree-sitter: per-line `[startCol, length, scopeId]` triples sent to the renderer, which never parses. M2 replaces the highlighter behind that format, and the renderer doesn't change.

The same tokens power M1's Structural proofs. A Fragment is proven "whitespace" or "formatting" only when its non-string code is equal after normalizing whitespace, and only in languages where that's sound: never in Python, YAML, shell, Makefiles, CSS, Swift or Ruby, where whitespace can change meaning. String and template-literal contents are compared verbatim. Anything unproven stays Behavioral.

## Consequences

- About 35 languages are highlighted. The rest render as plain text and get no whitespace proofs.
- When M2's AST-backed proofs land, they replace these token-based ones.
