## Grammar (EBNF)

Reference for the syntax accepted by `djinnc`. Semantics and what the compiler supports in detail: `djinnc/SUBSET.md`.
Keywords come from `djinnc/src/lexer/token_kind.djinn`; the parser is `djinnc/src/parser/`. Keep this file in sync when a
syntax change lands.

### Lexical

```ebnf
keyword              = "void" | "return" | "auto" | "extern" | "struct" | "namespace" | "import" | "mut" | "if" | "else"
                     | "for" | "while" | "do" | "switch" | "case" | "default" | "break" | "continue" | "interface"
                     | "public" | "private" | "static" | "this" | "enum" | "new" | "impl" | "where" | "async"
                     | "await" | "yield" | "spawn" | "in" | "true" | "false" | "operator" | "const" | "constexpr"
                     | "consteval" | "macro" | "is" | "null" | "throw" | "throws" | "try" | "require" | "ensure" | "unsafe" ;
(* contextual, not reserved: "var" (same as "auto"), "union", "attribute", "get", "set", "typeof", "sizeof", ... *)

punctuation          = "(" ")" "{" "}" "[" "]" ";" "," ":" "::" "." ".." "..=" "..." "#" "$" "@" "?" "?." "??" "??=" "!." "=>" "->" ;
operators            = "+" "-" "*" "/" "%" "++" "--" "==" "!=" "<" "<=" ">" ">=" "!" "&&" "||" "&" "|" "^" "~" "<<" ">>"
                     | "=" "+=" "-=" "*=" "/=" "%=" "&=" "|=" "^=" "<<=" ">>=" ;

INTEGER_LITERAL      = DIGIT_SEQ [ EXPONENT ] [ overflow_suffix ] ;     (* 42, 420_000, 800'000'000, 1e9, 123w, 123t, 123c, 123s *)
FLOAT_LITERAL        = DIGIT_SEQ "." DIGIT_SEQ [ EXPONENT ] ;           (* 3.14, 2.5e-3 *)
STRING_LITERAL       = '"' { any_char | escape } '"' | '"""' { any_char } '"""' ;
CHAR_LITERAL         = "'" ( any_char | escape | "\u" HEX4 | "\U" HEX8 ) "'" ;   (* one Unicode scalar value, type char *)
INTERP_STRING        = { "$" } ( '"' | '"""' ) { text | brace_group } ( '"' | '"""' ) ;
brace_group          = "{" expression [ ":" format ] "}" ;
format               = [ "-" ] [ "0" ] [ width ] [ "." precision ] ;    (* {n:6} {n:-6} {n:06} {x:.2} {s:.3}; width <= 4096, precision <= 99 *)
IDENTIFIER           = LETTER { LETTER | DIGIT | "_" } ;
DIGIT_SEQ            = DIGIT { DIGIT | "_" | "'" } ;
EXPONENT             = ( "e" | "E" ) [ "+" | "-" ] DIGITS ;
```

`$"{x}"` interpolates; with `n` dollar signs, `n` braces delimit an interpolation and fewer braces are literal
(`$$"{x} is {{x}}"`); `{{` and `}}` are literal braces in the single-dollar form. A plain `"..."` never interpolates.

### Program Structure

```ebnf
program              = { top_level } ;
top_level            = import | extern_block | namespace | type_alias | enum | union | interface | struct | impl | function
                     | constexpr_decl | macro_decl | static_var | inspect_decl | attribute_decl ;

import               = "import" qualified_name ";" ;
qualified_name       = IDENTIFIER { "::" IDENTIFIER } ;
namespace            = "namespace" qualified_name ( ";" | "{" { top_level } "}" ) ;
type_alias           = "struct" IDENTIFIER ":" type ";" ;               (* struct size : u32; *)
```

`import` makes a namespace visible inside the namespace declared in the same file (namespaces are flat: `std::types`
is one namespace). In a library, `import` goes after `namespace`.

### Static Variables and Constants

```ebnf
static_var           = [ "unsafe" ] "static" [ "mut" ] type IDENTIFIER "=" expression ";" ;
const_decl           = "const" type IDENTIFIER "=" expression ";" ;     (* also inside structs and functions; same as constexpr *)
```

Immutable by default; `mut` requires the `unsafe` prefix. `mut const` is an error.

### Extern Block

```ebnf
extern_block         = "extern" STRING_LITERAL "{" { extern_function } "}" ;
extern_function      = [ attributes ] type IDENTIFIER "(" [ param_list ] [ "," "..." ] ")" ";" ;
```

### Attributes

```ebnf
attributes           = { "[" attribute { "," attribute } "]" } ;
attribute            = IDENTIFIER [ "(" [ attr_arg { "," attr_arg } ] ")" ] ;
attr_arg             = [ IDENTIFIER "=" ] ( INTEGER_LITERAL | FLOAT_LITERAL | STRING_LITERAL | "true" | "false" | qualified_name ) ;
attribute_decl       = "attribute" IDENTIFIER "(" targets ")" ( ";" | "{" { field } "}" ) ;
```

Valid on functions, parameters, fields, structs, enums, unions, interfaces and, for loop hints (`[Unroll]`, `[Unroll(n)]`,
`[NoUnroll]`, `[Vectorize]`, `[NoVectorize]`), the statement before a loop. `[Reflect]` drives reflection. An unknown
attribute name is an error.

### Enum and Union (tagged unions / ADT)

```ebnf
enum                 = "enum" IDENTIFIER [ enum_header ] "{" enum_variant { "," enum_variant } [ "," ] "}" ;
enum_header          = "(" type IDENTIFIER { "," type IDENTIFIER } ")" ;
enum_variant         = IDENTIFIER [ "=" expression | "(" expression { "," expression } ")" ] ;

union                = "union" IDENTIFIER [ generic_params ] [ where_clause ] "{" union_variant { "," union_variant } "}" ;
union_variant        = IDENTIFIER [ "(" [ type { "," type } ] ")" ] ;
```

`enum` variants carry no payload (an optional header gives each variant constant fields); `union` variants carry payloads.
Build a variant with `Type::Variant(args)`; the type arguments of a generic union can be inferred.

### Interface

```ebnf
interface            = [ attributes ] "interface" IDENTIFIER [ generic_params ] "{" { interface_member } "}" ;
interface_member     = field_decl | method_signature | operator_signature ;
method_signature     = [ modifiers ] type IDENTIFIER [ generic_params ] "(" [ param_list ] ")" ";" ;
operator_signature   = type "operator" operator_symbol "(" [ param_list ] ")" ";" ;
```

### Struct and Impl

```ebnf
struct               = [ attributes ] "struct" IDENTIFIER [ generic_params ] [ where_clause ] [ struct_base ] ( ";" | struct_body ) ;
struct_base          = ":" [ "interface" ] type { "," type } ;
struct_body          = "{" { member } "}" ;
member               = field_decl | property | method | constructor | operator_decl | const_decl ;

field_decl           = [ attributes ] [ modifiers ] [ "mut" ] type IDENTIFIER [ "=" expression ] ";" ;
property             = [ modifiers ] type IDENTIFIER ( "{" { getter | setter } "}" | "=>" expression ";" ) ;
getter               = "get" ( ";" | "=>" expression ";" | block ) ;
setter               = "set" ( ";" | "=>" expression ";" | block ) ;
method               = [ attributes ] [ modifiers ] [ "async" | "sync" ] type IDENTIFIER [ generic_params ] "(" [ param_list ] ")"
                       [ where_clause ] [ throws_clause ] { contract_clause } ( ";" | "=>" expression ";" | block ) ;
constructor          = IDENTIFIER "(" [ param_list ] ")" block ;
operator_decl        = [ modifiers ] type "operator" operator_symbol "(" [ param_list ] ")" ( "=>" expression ";" | block ) ;
operator_symbol      = "+" | "-" | "*" | "/" | "%" | "==" | "<" | "~" | "!" | "&&" | "||" | "get[]" | "set[]" ;
modifiers            = { "public" | "private" | "static" | "unsafe" } ;

impl                 = "impl" ( type | IDENTIFIER [ generic_args ] "for" type ) "{" { member } "}" ;
```

`impl T { ... }` adds methods to a struct, enum or primitive; `impl Iface for T { ... }` also declares conformance, checked
at compile time. A big struct is typically split across files with `impl` blocks. Inside instance methods a bare field or
property name means `this.name`. `operator` members are static.

### Function

```ebnf
function             = [ attributes ] [ "unsafe" ] [ "async" | "sync" ] [ "constexpr" | "consteval" ] type IDENTIFIER [ generic_params ]
                       "(" [ param_list ] ")" [ where_clause ] [ throws_clause ] { contract_clause } ( block | "=>" expression ";" ) ;
param_list           = parameter { "," parameter } ;
parameter            = [ attributes ] type [ "..." ] IDENTIFIER [ "=" expression ] | "..." IDENTIFIER | "..." ;
```

`T... name` (last) collects extra arguments into `arr<T>`; `...name` alone means `object... name` (std); a bare `...` in an
extern is a C variadic. Calls accept named arguments after positional ones (`clamp(50, high: 10, low: 0)`). Functions,
methods, constructors and operators can be overloaded by parameter types.

### Error handling (throw / throws / try)

```ebnf
throws_clause        = "throws" [ "(" type { "," type } ")" ] ;
throw_statement      = "throw" expression ";" ;
try_expression       = "try" expression [ "?:" expression ] ;
```

(* Errors are values, not exceptions: a throwing function returns a `{ tag, payload }` record by value.

- `throws(T...)` lists what a function may raise; bare `throws` converts every error to the core `Error`.
- `throw value;` sets the error state and returns.
- `try expr ?: fallback` yields the fallback on failure; a bare `try expr` propagates (inside a `throws` caller).
- `switch call() { Result v -> ..., ErrorType e -> ..., Error e -> ... }` matches the outcome of a throwing call.
- Runtime panics (bounds, null, overflow in `t` mode, ...) are `R<code>` errors from `runtime_errors.djinn`, reported with
  a source snippet and shadow-stack in debug builds and with message and `file:line` in release builds. *)

### Contracts (require / ensure)

```ebnf
contract_clause      = ( "require" | "ensure" ) ( "(" expression ")" | block ) ;
```

`require` runs at function entry, `ensure` before each return (the value is the `return` pseudo-variable). A function with
contracts is implicitly throwing; `require` clauses decided by constant arguments are checked at compile time.

```djinn
i32 clamp(i32 value, i32 lo, i32 hi)
    require(lo <= hi)
    ensure(return >= lo)
{
    return value;
}
i32 ok = try clamp(5, 1, 10) ?: 0;
```

### Constexpr / Consteval

```ebnf
constexpr_decl       = ( "constexpr" | "consteval" ) ( type IDENTIFIER "=" expression ";" | function_rest ) ;
```

`constexpr`: evaluated at compile time when possible, runtime otherwise. `consteval`: must be evaluated at compile time.
The evaluator is a tree-walking interpreter over the type-checked AST (`semantic/const_eval/`); results are written back into
the AST as literals. A compile-time `if` keeps only the taken branch.

### Macros

```ebnf
macro_decl           = "macro" IDENTIFIER "{" { macro_rule } "}" ;
macro_rule           = [ "local" ] "(" [ macro_param { "," macro_param } ] ")" "=>" ( "{" token_stream "}" | "void" ) ;
macro_param          = [ "local" ] ( fragment_type IDENTIFIER | IDENTIFIER ) ;
fragment_type        = "expression" | "identifier" | "literal" | "type" | "block" ;
```

(* Expanded at parse time by token substitution and re-parse; hygienic. Bare identifiers in a rule are literal token
matchers. `local` evaluates the argument once through a temporary (`local` before `(` applies to all expression
parameters). Several rules per macro: first match by arity and literal tokens wins; ambiguous rules are rejected;
warning W6001 when a non-local expression parameter is used more than once. `=> void` expands to `0`.

```djinn
macro square { (local expression v) => { v * v } }
macro calc {
    (double, local expression v) => { v + v }
    (expression v) => { v }
}
i32 x = square(foo());   // foo() evaluated once
i32 c = calc(double, 5);
```
*)

### Reflection and member queries

```ebnf
typeof_expr          = "typeof" "(" ( type | function_name | interface_name | expression ) ")" ;
member_query         = type_name "#" ( "fields" | "methods" | "properties" | "attributes" | "constructors" | "interfaces" ) ;
inspect_decl         = "$" "inspect" qualified_name "{" { "generate" "{" { member } "}" } "}" ;
```

`typeof(type)` gives `TypeInfo*`, `typeof(function)` gives `MethodInfo*`, `typeof(Interface)` a `TypeInfo*` that is also a
`TypeInfoExt`. `Type#fields` and friends are compile-time lists; `$inspect` appends generated members to its target.

### Generics

```ebnf
generic_params       = "<" generic_param { "," generic_param } ">" ;
generic_param        = IDENTIFIER [ "=" type ] ;
generic_args         = "<" type { "," type } ">" ;
where_clause         = "where" constraint { ";" "where" constraint } ;
constraint           = IDENTIFIER ":" type { "," type } ;
```

Generic structs, unions, interfaces, functions and methods are monomorphized on demand; type arguments are inferred from
the arguments or the expected type when omitted. `impl Box<T> { ... }` names its own parameters.

### Types

```ebnf
type                 = [ "mut" ] base_type { "*" | "?" | "[" [ expression ] "]" } ;
base_type            = primitive_type | qualified_name [ generic_args ] | "void" | "auto" | "var" | "ptr" [ "<" type ">" ] ;

primitive_type       = integer_type | float_type | native_type | "bool" | "char" | "str" | "string" | "isize" | "usize" ;
integer_type         = ( "i" | "u" ) DIGITS { integer_suffix } ;    (* i8..i128, u8..u128, i32w, u32n, i32nt, ... *)
float_type           = "f" DIGITS ;                                  (* f32, f64 *)
native_type          = "nint" [ overflow_suffix ] | "nfloat" | "ndouble" ;
integer_suffix       = "n" | overflow_suffix ;
overflow_suffix      = "w" | "t" | "c" | "s" ;
```

- `T*` is a safe pointer, `ptr` / `ptr<T>` are raw pointers (dereference, indexing, arithmetic and int-to-pointer casts need
  `unsafe`), `T?` is `optional<T>` (`T*?` uses the pointer niche), `T[]` is `arr<T>`, `i8[n]` is a stack array.
- Overflow suffix: `w` wrapped (default, C-style), `t` trapped (panic), `c` checked (throws `Overflow`), `s` saturating.
  `n` marks a non-zero type (`i32n` cannot hold 0), combinable in either order (`i32nw`).
- `isize` / `usize` are always 32 bits; `nint` has the target pointer width. `char` is a 32-bit Unicode scalar value.
  `str` is a trivial view `{ data, length }`, `string` an owned heap text.

### Statements

```ebnf
block                = "{" { statement } "}" ;
statement            = [ attributes ] ( return_stmt | if_stmt | for_stmt | while_stmt | do_while_stmt | switch_stmt | break_stmt
                     | continue_stmt | throw_statement | yield_stmt | spawn_stmt | unsafe_block | block | local_decl | destructure
                     | expression_stmt ) ;

return_stmt          = "return" [ expression ] ";" ;
break_stmt           = "break" ";" ;
continue_stmt        = "continue" ";" ;
yield_stmt           = "yield" [ expression ] ";" ;                   (* bare yield suspends a coroutine; in a switch-arm block it yields the arm value *)
spawn_stmt           = "spawn" expression ";" ;
unsafe_block         = "unsafe" block ;
local_decl           = [ "mut" ] [ "const" ] type IDENTIFIER [ "=" expression ] ";" ;
destructure          = "auto" "{" IDENTIFIER { "," IDENTIFIER } "}" "=" expression ";" ;

if_stmt              = "if" "(" expression ")" block [ "else" ( if_stmt | block ) ] ;
for_stmt             = "for" "(" ( for_classic | for_each | for_range ) ")" block ;
for_classic          = [ statement_expr ] ";" [ expression ] ";" [ expression ] ;
for_each             = type IDENTIFIER "in" expression ;                (* over an arr<T> / slice / collection *)
for_range            = [ type IDENTIFIER "in" ] range_expr ;
range_expr           = ( "[" | "(" ) expression ".." expression ( "]" | ")" ) | expression ( ".." | "..=" ) expression ;
while_stmt           = "while" "(" expression ")" block ;
do_while_stmt        = "do" block "while" "(" expression ")" ";" ;

switch_stmt          = "switch" "(" expression ")" "{" { switch_case } "}" ;
switch_case          = ( "case" expression | "default" ) ":" { statement } ;
expression_stmt      = expression ";" ;
```

Range bounds: the start is inclusive unless the bracket is `(`; the end is inclusive with `..=` or `]`, exclusive with `..`
or `)`. `for (0..5) { }` repeats without a variable. The `switch` statement has no fallthrough; `break` leaves it.

### Expressions

Lowest to highest precedence:

```ebnf
expression           = assignment ;
assignment           = coalesce [ assign_op assignment ] ;
assign_op            = "=" | "+=" | "-=" | "*=" | "/=" | "%=" | "&=" | "|=" | "^=" | "<<=" | ">>=" | "??=" ;
coalesce             = or_expr [ "??" coalesce ] ;
or_expr              = and_expr { "||" and_expr } ;
and_expr             = bit_or { "&&" bit_or } ;
bit_or               = bit_xor { "|" bit_xor } ;
bit_xor              = bit_and { "^" bit_and } ;
bit_and              = equality { "&" equality } ;
equality             = comparison { ( "==" | "!=" ) comparison } [ "is" is_target ] ;
is_target            = type [ IDENTIFIER ] | qualified_name "::" IDENTIFIER { IDENTIFIER } ;
comparison           = shift { ( "<" | "<=" | ">" | ">=" ) shift } ;
shift                = term { ( "<<" | ">>" ) term } ;
term                 = factor { ( "+" | "-" ) factor } ;
factor               = unary { ( "*" | "/" | "%" ) unary } ;
unary                = ( "!" | "-" | "~" | "*" | "&" | "++" | "--" ) unary | cast | await_expr | try_expression | postfix ;
cast                 = "(" type ")" unary ;
await_expr           = "await" unary ;
blocking_wait        = postfix "." "sync" ;   (* not followed by "(" or "<"; same node as await_expr, blocking *)
postfix              = primary { "." IDENTIFIER [ generic_args ] | "?." IDENTIFIER | "!." IDENTIFIER | "[" expression "]"
                     | "(" [ arg_list ] ")" | "++" | "--" } ;

primary              = INTEGER_LITERAL | FLOAT_LITERAL | STRING_LITERAL | INTERP_STRING | CHAR_LITERAL | "true" | "false" | "null"
                     | IDENTIFIER | "this" | "(" expression ")" | array_literal | brace_initializer | new_expression
                     | type_expression | switch_expression | intrinsic_call | local_decl_expr ;

array_literal        = "[" [ expression { "," expression } ] "]" ;
brace_initializer    = [ type ] "{" [ init_element { "," init_element } ] "}" ;
init_element         = [ "." IDENTIFIER "=" ] expression ;
new_expression       = "new" type [ "(" [ arg_list ] ")" | brace_initializer ] ;
type_expression      = IDENTIFIER [ generic_args ] "::" IDENTIFIER [ "(" [ arg_list ] ")" ] ;
intrinsic_call       = ( "sizeof" | "alignof" | "typeof" | "likely" | "unlikely" | "expect" | "prefetch" | "bounds_check" ) "(" arg_list ")" ;
arg_list             = argument { "," argument } ;
argument             = [ IDENTIFIER ":" ] expression ;
```

- `p?.m` yields a nullable pointer (null when `p` is null); `p!.m` unwraps (error on a value that is not nullable); `a ?? b`
  falls back when `a` is null; `a ??= b` assigns when null.
- `&function` is the address of a plain, non-generic function as `ptr`.
- `expr is T` / `expr is T name` tests a boxed `object` and optionally binds the unboxed value; `expr is Enum::Variant a b`
  tests a union value and binds the payload.
- `sync` is a contextual modifier (a method may still be called `sync`); `await` is an error inside a `sync` function. `task.sync` blocks the calling thread until the task completes (C# `GetAwaiter().GetResult()`) and warns (E6005) inside async functions. `await task` suspends in async functions and runs the event loop in the others; `spawn task;` schedules a task.

#### Switch expression

```ebnf
switch_expression    = "switch" expression "{" { switch_arm [ "," ] } "}" ;
switch_arm           = ( IDENTIFIER | "_" ) [ IDENTIFIER { IDENTIFIER } ] "->" arm_body ;
arm_body             = expression | block ;
```

(* Matches union variants (an optional binding per payload field; `_` catches the rest; every variant must be covered
or `_` present; all arms yield the same type) and the outcome of throwing calls (`Result v` / `_ v` for success, `Error e`
or an error type name for failures, tried in source order, otherwise the error propagates). An arm block produces its value
with `yield expr;`; `return` is not allowed in an arm block. *)
