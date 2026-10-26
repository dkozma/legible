; Legible: constants, statics, type uses, paths, and plain identifier uses.

(const_item name: (identifier) @name) @definition.constant

(static_item name: (identifier) @name) @definition.constant

(call_expression
  function: (scoped_identifier name: (identifier) @name)) @reference.call

(type_identifier) @name @reference.type

(scoped_identifier name: (identifier) @name) @reference.read

(identifier) @name @reference.read
