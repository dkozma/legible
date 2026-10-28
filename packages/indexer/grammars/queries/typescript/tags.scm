; Legible: types, enums, module-level constants, class fields, properties of
; interfaces and named object types, namespaces, inheritance, and plain
; identifier uses (resolved only through imports and same-file definitions).

(type_alias_declaration name: (type_identifier) @name) @definition.type

(enum_declaration name: (identifier) @name) @definition.enum

(program
  (lexical_declaration
    (variable_declarator name: (identifier) @name) @definition.constant))

(program
  (export_statement
    declaration: (lexical_declaration
      (variable_declarator name: (identifier) @name) @definition.constant)))

; A field holding a function is a method; the first pattern wins (outline.ts).
(public_field_definition
  name: [(property_identifier) (private_property_identifier)] @name
  value: [(arrow_function) (function_expression)]) @definition.method

(public_field_definition
  name: [(property_identifier) (private_property_identifier)] @name) @definition.field

; Not inline object types (`opts: { onEvent }`): SCIP and TypeScript treat those as anonymous.
(interface_body
  (property_signature name: (property_identifier) @name) @definition.field)

(type_alias_declaration
  value: (object_type
    (property_signature name: (property_identifier) @name) @definition.field))

(internal_module name: (identifier) @name) @definition.module

(extends_clause value: (identifier) @name) @reference.implementation

(implements_clause (type_identifier) @name) @reference.implementation

(type_identifier) @name @reference.type

(identifier) @name @reference.read

(shorthand_property_identifier) @name @reference.read

; `this.id`, `opts.root`: resolved only through the receiver (this, a declared type, an import).
(member_expression property: (property_identifier) @name) @reference.read
