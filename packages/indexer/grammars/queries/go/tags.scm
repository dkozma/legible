; Legible: constants, variables, and plain identifier uses.

(source_file (const_declaration (const_spec name: (identifier) @name) @definition.constant))

(source_file (var_declaration (var_spec name: (identifier) @name) @definition.variable))

(identifier) @name @reference.read

(selector_expression
  operand: (identifier)
  field: (field_identifier) @name) @reference.read
