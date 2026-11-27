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
STRING_LITERAL       = '"' { any_char | string_escape } '"' | '"""' { any_char } '"""' ;
string_escape        = "\\" ( "n" | "t" | "r" | "0" | "\\" | '"' | "'" | "{" | "}" | "u" HEX4 | "U" HEX8 ) ;   (* same escapes as char literals; any other escape is an error; block strings are raw *)
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
extern_block         = [ "public" | "internal" ] "extern" [ STRING_LITERAL ] ( "{" { extern_function } "}" | extern_function ) ;
extern_function      = [ attributes ] type IDENTIFIER "(" [ param_list ] [ "," "..." ] ")" ";" ;
extern_binding       = "extern" ( "C" | "JS" ) "{" { [ attributes ] extern_struct } "}" ;
extern_struct        = "struct" IDENTIFIER [ generic_params ] "{" { [ attributes ] extern_method } "}" ;
extern_method        = [ "public" ] [ "static" ] type IDENTIFIER [ generic_params ] "(" [ param_list ] ")" ";" ;
```

`extern "C"` and `extern "JS"` can also declare structs, the interop bindings of a platform. The struct has no fields, constructors, properties or bodies: a value of it is an opaque handle, and it cannot be instantiated (`E3068`). The methods are provided by the platform: in `extern "JS"` each one needs a `[Js("template")]` (`$this`, `$0`..`$9`, `$*`) and exists only with `--target web`; in `extern "C"` each one needs `[Symbol("c_name")]` and links against that C symbol. Calling a binding on the wrong target is `E3069`; a method without its `[Js]` or `[Symbol]` is `E3070`. `abstract` is not needed (nor allowed) inside the block. Any other string (`extern "mod"`) is still a WebAssembly module and declares functions only.

With `--strict-externs`, an extern is visible only in the file that declares it (without it, every extern is visible everywhere; externs of the core library are always visible). `public extern` makes it visible to every file that sees its namespace (core, `std` and shared libc declarations use it). `internal extern` makes it visible to every file of the same namespace only.

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

`[Platform(p, ...)]` keeps a declaration (a top-level declaration or a struct member) only when the target is one of the
platforms `windows`, `linux`, `macos`, `android`, `ios`, `web`, or a group: `desktop` (windows, linux, macos), `mobile`
(android, ios), `native` (everything but web); otherwise it is dropped while parsing. In a project, a file
`name.<platform>.djinn` (same words) replaces `name.djinn` on that platform: the exact platform wins over its group, the
group over `native`, and variants for other platforms are left out. `Platform.Android`, `.Ios`, `.Web`, `.Desktop` and
`.Mobile` join `Platform.Windows`, `.Linux` and `.MacOs` as compile-time constants.

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
struct               = [ attributes ] [ "constexpr" | "abstract" ] "struct" [ "mut" ] IDENTIFIER [ generic_params ] [ primary_ctor ] [ where_clause ] [ struct_base ] ( ";" | struct_body ) ;
primary_ctor         = "(" [ param_list ] ")" ;   (* record form: each parameter becomes a field plus a constructor that assigns it *)
struct_base          = ":" [ "interface" ] type { "," type } ;
struct_body          = "{" { member } "}" ;
member               = field_decl | property | method | constructor | operator_decl | const_decl | invariant_clause ;

field_decl           = [ attributes ] [ modifiers ] [ "mut" ] type IDENTIFIER [ "=" expression ] ";" ;
property             = [ modifiers ] type IDENTIFIER ( "{" { getter | setter } "}" | "=>" expression ";" ) ;
getter               = "get" ( ";" | "=>" expression ";" | block ) ;
setter               = "set" ( ";" | "=>" expression ";" | block ) ;
method               = [ attributes ] [ modifiers ] [ "abstract" ] [ "async" | "sync" ] type IDENTIFIER [ generic_params ] "(" [ param_list ] ")"
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
function             = [ attributes ] [ "abstract" ] [ "unsafe" ] [ "async" | "sync" ] [ "constexpr" | "consteval" ] type IDENTIFIER [ generic_params ]
                       "(" [ param_list ] ")" [ where_clause ] [ throws_clause ] { contract_clause } ( block | "=>" expression ";" | ";" ) ;

A function with `;` instead of a body must be `abstract` (or a method of an `abstract` / `extern` struct): the platform provides it, through `[Js("template")]` on the web or `[Symbol("name")]` natively (`E3070` without either, `E3069` for a call on a target that has no provider).
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

### Contracts (require / ensure / invariant)

```ebnf
contract_clause      = ( "require" | "ensure" ) "(" expression ")" ;
invariant_clause     = "invariant" "(" expression ")" ";" ;      (* contextual word, inside a struct body *)
old_expression       = "old" "(" expression ")" ;                 (* contextual, only inside ensure *)
```

`require` runs at function entry, `ensure` before every return: `result` is the returned value and `old(x)` the value `x`
had at entry (a trivially copyable value, `E7001`). An `invariant` is checked when every method and constructor that is
neither static nor private returns, and only the methods of its struct may write its fields or build it with an
initializer (`E7002`). A clause may only call functions without effects (`E7009`).

The contracts mode decides what a failed clause does: `check` (default) traps with `R10013`, `observe` reports and goes
on, `ignore` evaluates nothing (and never becomes an assumption). It is set with `--contracts=<mode>` or `contracts:` in
`djinn.proj`; a library keeps the mode it was built with, also for the bodies a consumer compiles from its interface.

```djinn
i32 clamp(i32 value, i32 lo, i32 hi)
    require(lo <= hi)
    ensure(result >= lo && result <= hi)
{
    return value < lo ? lo : (value > hi ? hi : value);
}
```

### Effects and regions (atomic / cooperative)

```ebnf
atomic_stmt          = "atomic" [ "(" [ expression { "," expression } ] ")" ] block [ "after_commit" block ] ;
cooperative_stmt     = "cooperative" block ;
```

Effects (`writes`, `io`, `suspends`, `unknown`) are inferred for every function. `[Pure]` functions must have none
(`E7003`), `[Effects(...)]` declares them on an extern and is an audited ceiling on a function with a body (`E7004`).
An `atomic` region saves its operands (places: variables, fields, dereferences) and restores them when an error leaves
it; a value operand that owns memory is undone by move. The region cannot suspend (`E7005`), nothing may fail after its
first external effect (`E7006`), parts of a value operand that own memory cannot be replaced (`E7007`), and every write
must land in an operand or a local of the region (`E7008`). `after_commit` runs when the region completes without an
error and cannot leave it (`E7011`). `cooperative` only forbids suspension. `--obligations[=json]` lists every guarantee
with its provenance and the inferred effects.

### Native errors (`[NativeError]`)

`[NativeError(detect = <condition on result>, capture = errno | last_error | return_code)]` on an `extern "C"` function
that declares `throws(E)` makes a failed call throw `E { .code = <captured> }` (`E7012` for a malformed attribute).

### Constexpr / Consteval

```ebnf
constexpr_decl       = ( "constexpr" | "consteval" ) ( type IDENTIFIER "=" expression ";" | function_rest ) ;
```

`constexpr`: evaluated at compile time when possible, runtime otherwise. `consteval`: must be evaluated at compile time.
The evaluator is a tree-walking interpreter over the type-checked AST (`semantic/const_eval/`); results are written back into
the AST as literals. A compile-time `if` keeps only the taken branch.

### Macros

```ebnf
macro_decl           = "macro" IDENTIFIER [ "!" ] "{" { macro_rule } "}" ;
macro_rule           = [ "local" ] "(" [ macro_param { "," macro_param } ] ")" "=>" ( "{" token_stream "}" | "void" ) ;
macro_param          = [ "local" ] ( fragment_type [ "..." ] IDENTIFIER | IDENTIFIER ) ;
fragment_type        = "expression" | "identifier" | "literal" | "type" | "block" | "statement" | "tokens" ;
macro_call           = [ qualified_name "::" ] IDENTIFIER ( "!" ( "(" tokens ")" | "[" tokens "]" | "{" tokens "}" ) | "(" tokens ")" ) ;
repetition           = "$for" "(" IDENTIFIER "in" IDENTIFIER [ "," TOKEN ] ")" "{" token_stream "}" ;   (* inside a body *)
```

(* Called as `name!(args)`, `name![args]` or `name!{args}`, or `name(args)` when declared without `!` (a macro declared
`macro name!` is separate from `macro name` and only called with the `!`). Expanded at parse time by token substitution
and re-parse: every macro of every file is collected before parsing, so declaration order does not matter. The call
site decides the shape: in an expression the body must be one expression; as a statement (followed by `;`, or any
`name!{...}`) it may be several statements, which join the enclosing block; at declaration level it produces
declarations. Arguments are matched fragment by fragment (an `expression` is parsed, so `f<A, B>(x)` is one argument);
a trailing comma is accepted. A variadic `expression... xs` takes the remaining comma-separated arguments and is
expanded with `$for(x in xs) { ... }` or `$for(x in xs, sep) { ... }`. An `expression` argument of several tokens is
parenthesized. Bare identifiers in a rule are literal token matchers. Hygiene: locals the template declares (`T name =`,
`T name;`, `T name in`) get fresh names. `local` evaluates the argument once through a temporary (`local` before `(`
applies to all expression parameters). Several rules per macro: the first whose fragments parse wins; ambiguous rules are
rejected; warning W6001 when a non-local expression parameter is used more than once. `=> void` expands to `0` (nothing
as a statement). Macros belong to their namespace: a call sees the macros of its namespace and of imported namespaces,
or names one with `ns::name!(...)`. A function with the name of a visible `name(...)` macro warns (W6006). A parse
error inside an expansion is reported at the call; expansion nests at most 64 levels.

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

#### Procedural macros

```ebnf
proc_macro_decl      = "proc" "macro" IDENTIFIER "=>" IDENTIFIER ";" ;       (* handler: TokenStream f(TokenStream input) *)
proc_attribute_decl  = "proc" "attribute" IDENTIFIER "=>" IDENTIFIER ";" ;   (* handler: TokenStream f(TokenStream args, TokenStream item) *)
```

A procedural macro is ordinary Djinn code in a library (built with `--std`, importing `std::meta`) that receives the
call's tokens and returns new ones. It is called like a declarative macro (`name!(...)`, `name![...]`, `name!{...}`); a
`proc attribute Name` is written `[Name]` or `[Name(args)]` before a declaration and replaces it with what it returns.
The program that imports the library runs the handler while parsing (the library object is loaded in a JIT inside the
compiler; the program itself does not use the JIT), so it needs `--runtime-lib` and the host target. Tokens carry the
span of the input token they came from (`Token.at(span)`); `Token.error(span, message)` reports an error there.

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
base_type            = primitive_type | anonymous_struct | qualified_name [ generic_args ] | "void" | "auto" | "var" | "ptr" [ "<" type ">" ] | fn_type ;
anonymous_struct     = "{" type IDENTIFIER { "," type IDENTIFIER } [ "," ] "}" ;  (* a struct declared in place; equal field lists are the same type *)
fn_type              = "fn" "(" [ type { "," type } ] ")" [ "->" type ] ;    (* "fn" is a type only before "(" *)

primitive_type       = integer_type | float_type | brain_float_type | native_type | "bool" | "char" | "str" | "string" | "isize" | "usize" ;
integer_type         = ( "i" | "u" ) DIGITS { integer_suffix } ;    (* i8..i128, u8..u128, i32w, u32n, i32nt, ... *)
float_type           = "f" DIGITS ;                                  (* f16, f32, f64 *)
brain_float_type     = "bf16" ;                                       (* x86, ARM, AArch64 and RISC-V only; E3071 elsewhere *)
native_type          = "nint" [ overflow_suffix ] ;
integer_suffix       = "n" | overflow_suffix ;
overflow_suffix      = "w" | "t" | "c" | "s" ;
```

- `T*` is a safe pointer, `ptr` / `ptr<T>` are raw pointers (dereference, indexing, arithmetic and int-to-pointer casts need
  `unsafe`), `T?` is `optional<T>` (`T*?` uses the pointer niche), `T[]` is `arr<T>`, `i8[n]` is a stack array (any primitive or struct type: `Point[n]` gives a `Point*`).
- Overflow suffix: `w` wrapped (default, C-style), `t` trapped (panic), `c` checked (throws `Overflow`), `s` saturating.
  On a cast the suffix picks the conversion: `(i16w)x` truncates like C, `(i16s)x` clamps to the range of `i16`, and a plain
  `(i16)x` panics when the value does not fit (R10005).
  `n` marks a non-zero type (`i32n` cannot hold 0), combinable in either order (`i32nw`).
- `fn(A, B) -> R` is a closure type (no `->` means `void`, at most 8 parameters): a `{ code, environment }` value that
  moves, never copies, and frees its environment when disposed. A function name converts to it without allocating.
- `isize` / `usize` are always 32 bits; `nint` has the target pointer width. `char` is a 32-bit Unicode scalar value.
  `str` is a trivial view `{ data, length }`, `string` an owned heap text.

### Statements

```ebnf
block                = "{" { statement } "}" ;
statement            = [ attributes ] ( return_stmt | if_stmt | for_stmt | while_stmt | do_while_stmt | switch_stmt | break_stmt
                     | continue_stmt | throw_statement | yield_stmt | spawn_stmt | unsafe_block | atomic_stmt | cooperative_stmt | block | local_decl | destructure
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
or `)`. `for (0..5) { }` repeats without a variable. The `switch` statement has no fallthrough, except that a `case`/`default` label with no statements shares the body of the arm after it (`case 1: case 2: body`); `break` leaves it. Its value is an integer, a payload-less enum, a `str` or a `string`; text labels have the same type as the value and are tested in order with `operator ==`.

### Expressions

Lowest to highest precedence:

```ebnf
expression           = assignment ;
assignment           = conditional [ assign_op assignment ] ;
conditional          = coalesce [ "?" assignment ":" assignment ] ;
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
                     | "(" [ arg_list ] ")" | "++" | "--" | value_switch } ;

primary              = INTEGER_LITERAL | FLOAT_LITERAL | STRING_LITERAL | INTERP_STRING | CHAR_LITERAL | "true" | "false" | "null"
                     | IDENTIFIER | "this" | "(" expression ")" | array_literal | brace_initializer | new_expression
                     | type_expression | switch_expression | intrinsic_call | local_decl_expr | lambda ;

array_literal        = "[" [ expression { "," expression } ] "]" ;
brace_initializer    = [ type ] "{" [ init_element { "," init_element } ] "}" ;
init_element         = [ "." IDENTIFIER "=" ] expression ;
new_expression       = "new" type [ "(" [ arg_list ] ")" | brace_initializer ] ;
type_expression      = IDENTIFIER [ generic_args ] "::" IDENTIFIER [ "(" [ arg_list ] ")" ] ;
intrinsic_call       = ( "sizeof" | "alignof" | "typeof" | "likely" | "unlikely" | "expect" | "prefetch" | "bounds_check" ) "(" arg_list ")" ;
arg_list             = argument { "," argument } ;
lambda               = "(" [ lambda_param { "," lambda_param } ] ")" "=>" ( expression | block ) ;
lambda_param         = [ "mut" ] [ type ] IDENTIFIER ;
argument             = [ IDENTIFIER ":" ] expression ;
```

- `p?.m` yields a nullable pointer (null when `p` is null); `p!.m` unwraps (error on a value that is not nullable); `a ?? b`
  falls back when `a` is null; `a ??= b` assigns when null.
- `&function` is the address of a plain, non-generic function as `ptr`. `[Abi(C)]` on a function (also `Stdcall`,
  `Fastcall`, `SysV`, `Win64`) makes it safe to hand that pointer to C code (a window procedure, a `qsort` comparator):
  the function keeps the named calling convention and stays in the binary, and its signature may only use integers,
  floats, `bool`, `char`, pointers and `void` (E3067); not async, generic, throwing, variadic or an instance method.
- `(a, b) => a + b` and `(i32 v) => { ... }` are lambdas. Untyped parameters take their types from the expected `fn`
  type; the return type comes from it or from the body. Locals used inside are captured: copied when trivial, moved when
  they are values (the variable is then moved), and read-only inside the lambda (E3064). A captured value cannot be moved
  out of the lambda (E3065), and an untyped parameter with no expected type is E3066. `await` inside a lambda is not
  supported yet. A value of a `fn` type is called like a function: `f(x)`, `this.on_click(id)`.
- `expr is T` / `expr is T name` tests a boxed `object` and optionally binds the unboxed value; `expr is Enum::Variant a b`
  tests a union value and binds the payload.
- A function is async when its return type is written `task<T>` and its body awaits (or it is `main`), or when it says `async`. An async function must return `task<T>` (`task<void>` for no value, `E3075`); inside it `return` takes a `T`, and the error type of the task comes from `throws(E)` (`E3077`). A `task<T>` function with no `await` and no `async` returns a task it got from elsewhere. A generic function counts as awaiting only when its written return type is `task`.
- `await task` is allowed only in async functions: it suspends the caller. Elsewhere it is `E3076`, and inside a `sync` function `E3061` (constructors, properties and operators cannot await).
- `sync` is a contextual modifier (a method may still be called `sync`). `task.sync` blocks the calling thread until the task completes (C# `GetAwaiter().GetResult()`) and warns (E6005) inside async functions. `spawn task;` schedules a task.
- A `public` function that blocks on or holds async work must declare `sync` or return `task<T>` (`E3063`).

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

#### Value switch (C# style) and conditional expression

```ebnf
value_switch         = "switch" "{" { value_arm [ "," ] } "}" ;
value_arm            = ( pattern | "_" ) [ "when" expression ] "=>" expression ;
pattern              = pattern_test { "or" pattern_test } ;
pattern_test         = [ "<" | "<=" | ">" | ">=" ] shift ;
```

(* `subject switch { 1 => a, 2 or 3 => b, > 100 => c, _ when cond => d, _ => e }` compares the subject (evaluated once)
with each pattern in source order (`==` unless a relation is written; integers, enums, `str`, `string` through `operator ==`)
and yields the first matching arm. A `_` arm without `when` is required. The arms are an ordinary chain of conditional
expressions: they yield the same type. `condition ? a : b` evaluates one branch; the branches have the same type (numbers
widen, a nullable pointer accepts a safe pointer, `null` and number literals take the other branch's type). *)

`f16` is an IEEE half and `bf16` a brain float (8 exponent bits, 7 mantissa bits). Both widen to `f32`/`f64` implicitly and convert to each other only with a cast. `bf16` exists only on x86, ARM, AArch64 and RISC-V targets; elsewhere (web, wasm, other architectures) it is `E3071`.

An anonymous struct type, `{ i32 result, f64 something } doMath(i32 a, i64 b) { return { .result = 1, .something = 0.5 }; }`, is turned by the parser into a struct named after its fields (`__anon_<hash>`): the same field types, names and order are the same type, and `auto { result, something } = doMath(1, 2);` destructures it. Its fields are immutable and it has no methods.
