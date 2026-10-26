; Legible: module-level constants, inheritance, and plain identifier uses
; (resolved only through imports and same-file definitions, never by name alone).

(program
  (lexical_declaration
    (variable_declarator name: (identifier) @name) @definition.constant))

(program
  (export_statement
    declaration: (lexical_declaration
      (variable_declarator name: (identifier) @name) @definition.constant)))

(class_heritage (identifier) @name) @reference.implementation

(identifier) @name @reference.read

(shorthand_property_identifier) @name @reference.read
