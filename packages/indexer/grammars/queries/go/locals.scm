; Legible: names bound inside functions and blocks (parameters, receivers,
; `:=`, `var`, range variables). A plain use of one of these names after it's
; bound, in its scope, is the local, never a same-named function or import.
; Package-level declarations have no @local.scope around them.

(function_declaration) @local.scope
(method_declaration) @local.scope
(func_literal) @local.scope
(block) @local.scope
(for_statement) @local.scope
(if_statement) @local.scope
(expression_switch_statement) @local.scope
(type_switch_statement) @local.scope

(parameter_declaration name: (identifier) @local.definition)
(variadic_parameter_declaration name: (identifier) @local.definition)
(short_var_declaration left: (expression_list (identifier) @local.definition))
(var_spec name: (identifier) @local.definition)
(range_clause left: (expression_list (identifier) @local.definition))
(type_switch_statement alias: (expression_list (identifier) @local.definition))
