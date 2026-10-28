; Legible: names bound inside functions and blocks (parameters, locals, loop
; variables, catch parameters). A plain use of one of these names in its scope
; is the local, never a same-named function or import. Top-level declarations
; have no @local.scope around them, so they stay module-level Symbols.

(function_declaration) @local.scope
(generator_function_declaration) @local.scope
(function_expression) @local.scope
(generator_function) @local.scope
(arrow_function) @local.scope
(method_definition) @local.scope
(statement_block) @local.scope
(for_statement) @local.scope
(for_in_statement) @local.scope
(catch_clause) @local.scope

(formal_parameters (identifier) @local.definition)
(arrow_function parameter: (identifier) @local.definition)
(variable_declarator name: (identifier) @local.definition)
(for_in_statement left: (identifier) @local.definition)
(catch_clause parameter: (identifier) @local.definition)

; Destructuring, at any depth.
(shorthand_property_identifier_pattern) @local.definition
(pair_pattern value: (identifier) @local.definition)
(array_pattern (identifier) @local.definition)
(rest_pattern (identifier) @local.definition)
(assignment_pattern left: (identifier) @local.definition)
