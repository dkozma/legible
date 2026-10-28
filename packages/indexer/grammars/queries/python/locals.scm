; Legible: names bound inside functions, lambdas and comprehensions
; (parameters, assignments, loop and `with`/`except` targets, comprehension
; variables). A plain use of one of these names in its scope is the local,
; never a same-named function or import. Module-level code has no
; @local.scope, so its names stay module-level Symbols.

(function_definition) @local.scope
(lambda) @local.scope
(list_comprehension) @local.scope
(set_comprehension) @local.scope
(dictionary_comprehension) @local.scope
(generator_expression) @local.scope

(parameters (identifier) @local.definition)
(lambda_parameters (identifier) @local.definition)
(typed_parameter (identifier) @local.definition)
(default_parameter name: (identifier) @local.definition)
(typed_default_parameter name: (identifier) @local.definition)
(list_splat_pattern (identifier) @local.definition)
(dictionary_splat_pattern (identifier) @local.definition)

(assignment left: (identifier) @local.definition)
(assignment left: (pattern_list (identifier) @local.definition))
(assignment left: (tuple_pattern (identifier) @local.definition))
(augmented_assignment left: (identifier) @local.definition)
(named_expression name: (identifier) @local.definition)
(for_statement left: (identifier) @local.definition)
(for_statement left: (pattern_list (identifier) @local.definition))
(for_in_clause left: (identifier) @local.definition)
(for_in_clause left: (pattern_list (identifier) @local.definition))
(as_pattern_target (identifier) @local.definition)
