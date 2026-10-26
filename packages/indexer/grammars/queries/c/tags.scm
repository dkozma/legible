; Legible: calls, macros, type uses, and plain identifier uses (C and C++).

(call_expression function: (identifier) @name) @reference.call

(call_expression
  function: (field_expression field: (field_identifier) @name)) @reference.call

(preproc_def name: (identifier) @name) @definition.constant

(preproc_function_def name: (identifier) @name) @definition.macro

(type_identifier) @name @reference.type

(identifier) @name @reference.read
