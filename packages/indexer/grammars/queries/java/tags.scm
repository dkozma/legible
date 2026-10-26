; Legible: enums, records, fields, type uses, and plain identifier uses.

(enum_declaration name: (identifier) @name) @definition.enum

(record_declaration name: (identifier) @name) @definition.class

(field_declaration
  declarator: (variable_declarator name: (identifier) @name)) @definition.field

(type_identifier) @name @reference.type

(identifier) @name @reference.read
