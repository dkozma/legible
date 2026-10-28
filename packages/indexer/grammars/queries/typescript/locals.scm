; Legible: names bound inside functions and blocks (parameters, locals, loop
; variables, catch parameters), and type parameters (@local.definition.type,
; which only type names can mean). A plain use of one of these names in its
; scope is the local, never a same-named function, type or import. Top-level
; declarations have no @local.scope around them, so they stay module-level
; Symbols.

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
(class_declaration) @local.scope
(abstract_class_declaration) @local.scope
(interface_declaration) @local.scope
(type_alias_declaration) @local.scope
(function_signature) @local.scope
(method_signature) @local.scope
(call_signature) @local.scope
(construct_signature) @local.scope
(index_signature) @local.scope
(function_type) @local.scope
(conditional_type) @local.scope

(type_parameter name: (type_identifier) @local.definition.type)
(infer_type (type_identifier) @local.definition.type)
(mapped_type_clause name: (type_identifier) @local.definition.type)

(required_parameter pattern: (identifier) @local.definition)
(optional_parameter pattern: (identifier) @local.definition)
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
