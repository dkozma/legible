; Legible: module-level constants, class fields, inheritance, and plain identifier uses
; (resolved only through imports and same-file definitions, never by name alone).

(program
  (lexical_declaration
    (variable_declarator name: (identifier) @name) @definition.constant))

(program
  (export_statement
    declaration: (lexical_declaration
      (variable_declarator name: (identifier) @name) @definition.constant)))

; A field holding a function is a method; the first pattern wins (outline.ts).
(field_definition
  property: [(property_identifier) (private_property_identifier)] @name
  value: [(arrow_function) (function_expression)]) @definition.method

(field_definition
  property: [(property_identifier) (private_property_identifier)] @name) @definition.field

(class_heritage (identifier) @name) @reference.implementation

(identifier) @name @reference.read

(shorthand_property_identifier) @name @reference.read

; `this.id`, `opts.root`: resolved only through the receiver (this, a declared type, an import).
(member_expression property: (property_identifier) @name) @reference.read
