; Legible: types, enums, module-level constants, inheritance, and plain
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

(extends_clause value: (identifier) @name) @reference.implementation

(implements_clause (type_identifier) @name) @reference.implementation

(type_identifier) @name @reference.type

(identifier) @name @reference.read

(shorthand_property_identifier) @name @reference.read
