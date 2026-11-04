# Djinn bootstrap subset

The source of `djinnc/` may only use the constructs below. Both stage0 (C++) and djinnc itself must compile all
of them. A construct outside this list is forbidden in `djinnc/src` until the djinnc codegen supports it.

`djinnc` does not depend on `std`: every external symbol is declared in `src/support/system/libc.djinn`.

## Declarations

- `namespace djinnc;` in every file
- free functions, `extern "C" { ... }` blocks (including variadic `...`)
- `struct` with fields, `public` / private methods, `public static` methods
- `static` factory methods returning `T*` (heap allocated with `Memory.zalloc`)

## Types

- `isize` (signed) and `usize` (for values that cannot be negative) are always 32 bits, on every target; `sizeof` has the type `isize`. `nint` is the integer with the width of the target pointer (`--target <triple>`, default the host), 16, 32 or 64 bits, and `ptr` is the address type.

- `i8 i16 i32 i64 u8 u16 u32 u64 f64 bool void`
- pointers: `T*` for struct pointers; raw pointers are `ptr` (opaque, the old `void*`) and `ptr<T>` (`ptr<u8>`, `ptr<ptr<i8>>`, the old `i8*`, `u8*`, `void**`). Both are plain pointers to stage0 and djinnc for now (no `unsafe` enforcement). `unsafe { ... }` blocks and the `unsafe` function modifier are parsed and ignored. No references, no optionals
- `sizeof(T)`, casts `(T)expr` between integers, floats and pointers
- pointer arithmetic `p + n`, indexing `p[i]`, field access through pointer `p.field`

## Statements

- local variables (`T name = expr;`, `mut T name = expr;`)
- `if / else if / else`, `while`, `do-while`, `for`, `break`, `continue`, `return`
- `switch (integer) { case <const>: ... default: ... }` as a statement: no fallthrough, `break` leaves the switch, `continue` targets the enclosing loop
- `enum Name { A, B = 5, C }` (variants without a payload need no `()`, neither when declared nor when used: `Name::A`) and tagged enums `union Msg { Empty(), Number(i32), Pair(i32, i32) }`: `Msg::Pair(1, 2)` builds a value, payload-less enums are `i32` tags with `==`, `!=` and `case Name::A():`. `switch value { Empty -> 1, Number n -> n, Pair a b -> a * b }` is an expression and must cover every variant. A payload can be any type: the enum is a tag plus an inline byte area sized to the largest variant, and a type that contains itself by value (not through a pointer) is an error.
- `interface Name { Type field; Ret method(params); }`, `struct X : interface Name` (or `struct X : Name`), `impl X { methods }` and `impl Name for X { methods }`: conformance (fields and method signatures) is checked at compile time; there is no interface-typed value or dynamic dispatch, no generic interface, and `impl` takes a single struct, enum or primitive target (`impl Hashable for u64 { u64 hash() { ... } }`; `this` is the primitive value and `x.hash()` works on any primitive receiver and as a `where K : Hashable` bound). `impl A, B for X` lists several interfaces, `impl Hashable for u8, u16, i32 { ... }` repeats the body for each type, and `impl` on an enum adds methods whose `this` is the enum value (e.g. `switch this { ... }`).
- assignment to locals, fields and indexed pointers

## Expressions

- integer, float, bool, string (`i8*`) and `null` literals
- `+ - * / %`, comparisons, `&& || !`, `a ?? b` on pointers (right associative, lowest precedence)
- calls, method calls, static calls

## Structs in codegen

- fields (pointer, integer, float or struct-typed), `const` members, instance and `public static` methods, `this`
- member access through pointers (`p.field`, `p.method()`), `Struct.method()` and `Struct.CONST`
- by-value struct locals, parameters, returns and copies, plus struct initializers `{ .x = 1, .y = 2 }` (the target struct comes from the context: declaration, return, argument, assignment or an outer field)

## Globals

- `unsafe static mut void* name = null;` is used for the process arena (`Memory.arena()`). Typed struct pointers cannot be
  used as the global's type yet (stage0 reports the struct as not found), so the global is `void*` plus a cast.

## Forbidden

`try`/`throws`, `ensure`, closures, destructuring.

Each plain enum is its own type: `==`/`!=` only between values of the same enum (compared by tag); ordering, arithmetic and comparisons with integers or other enums are errors, so go through `getValue()` (returns the `i32` tag; a cast `(Kind)(i32)value` rebuilds the enum). `switch value { A -> 1, _ -> 0 }` accepts a `_` catch-all arm in place of the missing variants. `NodeKind` and `TokenKind` in the compiler source are real enums (their name/text/precedence tables are `switch` expressions); other enum-like `i32` constants in `static` structs remain.

A tagged enum with exactly two variants, one without payload and one with a single pointer payload (`union optional<T> { Some(T), None() }` instantiated with a pointer), uses the pointer niche: the value is 8 bytes with no tag, `None` is the null pointer and a `Some` holding null reads as `None`.

`T?` is sugar for `optional<T>` for any `T` (and `T*?` for `optional<T*>`, which uses the pointer niche): an `optional<T>` union must be in scope.

## Generics

- `struct Pair<K, V> { ... }` and `union optional<T> { Empty(), Value(T) }`; instances are monomorphized on demand (`Pair<i32, i64>`, nested `Wrapper<Pair<i32, i32>>`) with their methods.
- `where T : A, B; where U : C` constrains type parameters; a struct or enum type argument must satisfy the interfaces, checked at instantiation. A generic type can also list interfaces (`struct X<T> where T : I : J`).
- `optional<i32>::Value(1)` builds a generic enum value; the type arguments can be left out when the expected type (`return result::Err(e)` in a `result<i32, E>` function) or the payload arguments (`optional::Some(7)`) determine them; struct initializers and `switch` work on instances.
- Generic interfaces: `interface Comparable<T> { i32 compare(T other); }`, used as `struct P : Comparable<P>` or in bounds (`where T : Comparable<T>`); interfaces can declare `operator` members.
- Generic functions: `T larger<T>(T a, T b) where T : Comparable<T> { ... }`; type arguments are inferred from the arguments (including `Pair<K, V>` and `T*` parameters) or given explicitly, as in `first<i64>(1, 2)`.
- `impl Box<T> { ... }` and `impl Iface for Box<T> { ... }` add methods and interfaces to every instance; the impl names the type parameters itself.
- Generic methods: `T pick<U>(U marker, T other)` in a struct or impl, and `public static T twice<T>(T item)`; inferred from the arguments or explicit (`holder.convert<i64>(30)`).
- A generic constraint made only of operator members (`Equatable<T>`, `Addition<T>`) is satisfied by numbers and pointers, which have those operators natively.

## Constructors

- `Point(i32 x, i32 y) { ... }` inside a struct body or `impl`; arguments are positional or named (see Named arguments).
- `Point p = Point(1, 2);` builds a value, `Point* heap = new Point(1, 2);` allocates zeroed memory through the runtime allocator (`__djinn_malloc`, which traces the allocation) and returns a pointer. Generic types work the same way: `Box<i32>(7)`, `new Box<i32>(9)`.
- A struct without a constructor can only be built with `Name()` (zero-initialized) or a `{ .field = value }` initializer.

- Operator overloading: `operator +(T left, T right) -> T { ... }` inside `impl T { }` or the struct body defines a static operator method; binary expressions on struct values call it. `!=` is derived from `==`. A one-parameter operator (`operator -(T value) -> T`, also `~` and `!`) overloads the unary form. `&&` and `||` can be overloaded for structs (both operands are evaluated). `operator get[](T collection, I index) -> R` and `operator set[](T* collection, I index, V value) -> void` overload `x[i]` and `x[i] = v`; `&x[i]` is not allowed on them.

## Overloading

- Functions, methods, constructors and operators can share a name when their parameter types differ; a redefinition with the same parameter types is still an error.
- The call picks the candidate whose parameter types match best (exact type beats numeric conversion); no match or a tie is a compile error. Overloads after the first get a `$n` suffix in the symbol name.


## Core types: `str` and `arr<T>`

The core library (`runtime/core/*.djinn`, read from `--runtime-dir`) is compiled with every program and declares `str { i8* data; u32 length; }` and `arr<T> { T* data; u32 length; }`, both with `is_empty()` and `ptr()`.

- `T[]` is `arr<T>`; `[a, b, c]` is an array literal, allocated with `__djinn_malloc`. The element type comes from the context or the first element; an empty literal needs a context.
- A string literal is `i8*` unless the expected type is `str`, which gives `{ data, length }`.
- `array[i]` indexes `arr<T>` (read and write); `length` is a field.

## Range-for

`for (i32 i in [1..10])`, `[0..5)`, `0..5` and `0..=5` loop over a range. The start is always inclusive; `[a..b]` and `..=` include the end, `[a..b)` and `..` exclude it. The parser lowers it to a plain `for` with a hidden `__limitN` variable, so the end is evaluated once. `(a..b]` and `(a..b)` exclude the start: the loop begins at `a + 1`. A `(` after `in` is a range only when `..` appears directly inside it, so `(n)..5` is still the ordinary range.

## Named arguments

Calls, method calls and constructors (`Point(y: 4, x: 3)`, `new Point(x: 1, y: 2)`, `clamp(50, high: 10, low: 0)`) accept `name: value` arguments after any positional ones. They are matched to the parameter names of the callee (the overload whose names fit is picked) and reordered into parameter order, so evaluation follows parameter order. Not available for enum variants, intrinsics or calls through generic inference of unnamed callees.

## `string` and interpolation

`core.djinn` also declares `string { i8* data; u32 length; u32 capacity; }` with `is_empty()`, `ptr()` and `operator +` (concatenation). A string literal gets type `string` when that is the expected type. Only a `$"..."` literal interpolates, as in C#: `$"count={count}"` or `$"sum={p.x + p.y}"` has type `string`, and its parts can be integers, bools, floats, `i8*`, `str` and `string`. An expression can carry a format, `{value:[-][0]width[.precision]}`: `{n:6}` right-aligns, `{n:-6}` left-aligns, `{n:06}` zero-pads numbers, `{x:.2}` prints a float with fixed decimals and `{s:.3}` truncates text (`{x:8.2}` combines both). The lexer reads the part after a top-level `:` (not `::`, not inside parentheses or after a `?`) as an `INTERP_FORMAT` token, the parser packs it into the preceding text part and the runtime pads with `__djinn_text_*_format`. Widths go up to 4096 and precision up to 99. A plain `"..."` never interpolates, so `"{count}"` is just text. Inside `$"..."`, `{{` and `}}` are literal braces and a lone `}` is an error. The lexer splits an interpolated literal into `INTERP_BEGIN`/`INTERP_MIDDLE`/`INTERP_END` tokens around the ordinary expression tokens. The builder (`__djinn_text_*`) is Djinn code in `core.djinn`; sizes are checked against the `u32` limit, and allocation failure is reported only by `__djinn_malloc`.

## Inference

`auto` and `var` are interchangeable keywords: `var total = a + b;` takes the type of the initializer.

## Std and imports

`import a::b;` makes the names of namespace `a::b` visible in the namespace declared in the same file (namespaces are flat: `std::types` is one namespace, not `types` inside `std`). `struct size : u32;` declares an alias. `--std` loads `std/` (see `STD_ROADMAP.md`). The source of `djinnc/src` keeps using none of this.

## Playground

`tools/playground.sh [djinnc flags]` (or `tools/playground.ps1`) compiles `playground/main.djinn` with the newest bootstrapped djinnc, runs it and prints the exit code. `DJINNC` and `DJINN_RUNTIME_DIR` override the compiler and the runtime directory. `Type { .field = value }` builds a struct without an expected type.

## Properties and implicit `this`
`T name { get => expr; set { ... } }`, `T name => expr;` (read-only) and auto properties desugar to `get:NAME`/`set:NAME` methods.
Inside instance methods a bare field or property name means `this.name`.

## `object` and `is`
Assigning any value to `object` boxes it (`{TypeInfo*, void*}`, id = FNV-1a of the type name). `x is T` and `x is T name`
test the boxed type and optionally bind the unboxed value. `x is Enum::Variant [a b ...]` tests an enum value and binds the variant payload.

## Async
`async T f()` returns `task<T>` and lowers to a presplit LLVM coroutine; `await task` suspends inside async functions and
runs the event loop in sync ones; `spawn task;` schedules it. `async main` is driven by the runtime event loop (i32 or void);
a sync `main` can still `await`. `yield` is not a coroutine yield (it is the switch-arm value in stage0) and is not supported.

## Attributes
`[Name]`, `[Name(16)]`, `[Name(key = "text")]` and `[A, B]` before functions, methods, structs, fields and parameters. The builtin names and
targets are in `ast/attributes/attributes.djinn`: `ForceInline`, `NoInline`, `NoReturn`, `Hot`, `Cold`, `NoSync`, `NoUnwind`, `WillReturn`,
`NoRecurse`, `InlineHint`, `OptSize`, `MinSize`, `NoFree`, `NoMerge`, `Speculatable` and `Llvm("attr")` become LLVM function attributes; `Const` and `Pure` become `memory(none)` and `memory(read)`. On parameters, `ReadOnly`, `WriteOnly`, `Restrict` (`noalias`), `NonNull`, `NoCapture` (`captures(none)`) and `Align(n)` become LLVM parameter attributes (the type must be a pointer). `Volatile`, `NoMangle` and `Deprecated` are validated but have no LLVM effect; `Reflect` (structs, enums, unions, interfaces) drives reflection, see below. Only attributes that cannot introduce undefined behavior are implicit: every defined function is `nounwind` and `__djinn_malloc` returns `noalias`; everything else is opt-in, and a wrong promise is undefined behavior. `likely(cond)` and `unlikely(cond)` emit `llvm.expect`.
An unknown name is an error; a wrong target is a warning.

`attribute Name(targets);` and `attribute Name(targets) { fields }` declare attributes (the targets expression is skipped, so declared
attributes are valid everywhere); the form with fields also defines a struct `Name`. `[attribute(...)] struct XAttribute {...}` declares `X`
and `XAttribute`. `[intrinsic]` and `[no_mangle]` structs are parsed and dropped (the core provides `task<T>` and the coroutine primitives).

A parameter marked `[Location]` whose type is a struct with `fileName`, `line` and `column` is filled by the compiler with the call site
when the call omits it (only the last parameter, no overloads).

Intrinsics: `unlikely(bool)`, `assume(bool)`, `debugtrap()`, `trap()`, `unreachable()`. Struct initializers also accept positional values
(`{ 0, 0, 0 }`).

## Ownership
Non-copy values (structs, tagged enums, `str`, `string`, `arr<T>`) move on `T x = y;` and `x = y;`. Using a moved variable is an error;
assigning to it re-initializes it. Integers, floats, `bool`, pointers and payload-less enums copy. Passing to a function does not move,
and there is no borrow checking (same as stage0).

## Macros
`macro name { (params) => { expression } ... }`. Parameters are `expression x`, `identifier x`, `literal x`, `type T` or a bare literal token
(`add`, `debug`, ...); `local` (on a parameter or before the parameter list) evaluates the argument once. `=> void` expands to `0`.
Rules are chosen by arity and fragment kind, in order. Expansion happens in the parser by AST substitution, so precedence is preserved,
a macro must be declared before it is used, and `type` parameters cannot be referenced from the body. Using a non-`local` expression
parameter more than once warns.

## constexpr and consteval
`constexpr T NAME = expr;` (global or local), `constexpr`/`consteval` functions and compile-time `if` (`if constexpr cond { }`, `if consteval cond { }` or
`if cond { }` without parentheses) run in a compile-time evaluator. Supported values are integers, floats, `bool`, payload-less enums and `i8*` strings; functions may use
locals, assignment, `if`, `while`, `do`, `for`, `switch`, `break`, `continue`, recursion (depth 512, 1,000,000 steps) and calls to other constexpr/consteval
static functions. Integers wrap to their declared width. A `constexpr` variable needs a constant initializer and forward references between globals are resolved
on demand (cycles are errors). A call with constant arguments to a `constexpr` function is folded to a literal and otherwise stays a normal call; a `consteval`
call that cannot be evaluated is an error (except inside another constexpr/consteval body). `constexpr` and `async` cannot be combined, and structs and pointers other than strings
are not supported in the evaluator yet. Strings are `i8*` values that always point into a string literal: a literal, `s[i]`, `*s`, `s + n`, passing and returning them, `constexpr i8* NAME = "..."` and locals work, and an index or offset past the terminating NUL is an error. There is no concatenation, comparison of pointers or building of new strings. A folded string becomes a literal in the generated code.

The evaluator works on the type-checked AST, with no bytecode step: expression results travel in two registers (`ri`, `rf`) chosen by the static type,
locals live in one flat frame stack of parallel `i64`/`f64` arrays (slots are numbered once per function), type shapes are cached per type id, and a result
is written back into the AST node as a literal (`IntLiteral`, `BoolLiteral`, `FloatConst`), so code generation pays no lookup and reads of constexpr
variables become literals too. Compile-time `if` keeps only the taken branch.

## Reflection
`typeof(Type)` returns a `TypeInfo*` (`kind`: 0 signed int, 1 float, 2 pointer, 3 struct/`object`, 4 unsigned int and `bool`, 5 `str`, 6 `string`, 7 enum, 8 union,
9 interface; a string literal is `i8*`, so kind 2). `flags` bit 0 says the value is the head of a `TypeInfoExt`. Boxing to `object` and `is` use the same lazily generated constant.
Two more forms of `typeof` exist when the name is not a type: `typeof(function)` returns a `MethodInfo*` for a non-generic, non-overloaded function (always complete,
whatever the reflection mode), and `typeof(Interface)` returns a `TypeInfo*` of kind 9 that is also a `TypeInfoExt`.

A struct, enum, union or interface marked `[Reflect]` (or every struct, enum and union with `--reflect-all`; `--reflect-none` disables it, `--reflect-annotated` is the default)
gets a `TypeInfoExt` global: `FieldInfo` (name, type id, offset, `mut` flag, attributes), `MethodInfo` (name, function pointer, return type id, parameter count, flags
2 static / 4 async / 8 variadic / 16 extern, attributes, `ParamInfo` table with name, type id, flags and attributes), `AttributeInfo` (values flattened to text), the
names of the implemented interfaces (`interfaces`, `interfaceCount`) and a `detail` pointer. `(TypeInfoExt*)typeof(T)` or `(TypeInfoExt*)obj.type` works; the
`Reflection` struct of the core does the checking: `Reflection.ext(info)` (null when the type is not reflected), `Reflection.field`, `Reflection.method`,
`Reflection.implements(ext, "Name")`.

For an enum or union `detail` is an `EnumInfo`, reached through `Reflection.enumeration(info)`: `variants` (`VariantInfo`: name, tag `value`, `payloadCount`,
`payloadTypeIds`, `payloadOffsets`) and, for an enum with header fields, `headers` (`HeaderInfo`: name, type id, byte `size`, `rowCount` and the per-variant `table`
indexed by the tag, the same read-only table the compiler uses for `Kind::WHILE.name`). `Reflection.variant(info, tag)`, `Reflection.variant_named`, `Reflection.header(info, "name")`,
`Reflection.header_integer(header, tag)` and `Reflection.header_text(header, tag)` read them; the first header (the flag) is the tag itself. Methods of enums and unions
are listed in `methods`. An interface lists its fields and method signatures (null function pointers) in `fields` and `methods`; a struct, enum or union lists the interfaces it
implements. `[Reflect]` is accepted on structs, enums, unions and interfaces; it is a warning (not silent) on a type alias, on a generic type that is never instantiated and
under `--reflect-none`. The attributes of a generic instance are those of its template; attributes of the methods of an instance are not carried. Nothing is generated for types that
are neither boxed, `typeof`'d nor reflected. The core declares these structs and `Reflection`; `std` overrides `TypeInfo`, `AttributeInfo`, `FieldInfo`, `ParamInfo`, `MethodInfo`
and `TypeInfoExt` (the stage0 emits the same layout, so keep both in sync).

### Member queries and `$inspect`
`Type#fields`, `#methods`, `#properties`, `#attributes`, `#constructors` and `#interfaces` are compile-time queries, always available (whatever the reflection mode) and
resolved by the compiler into read-only tables: they produce `FieldList`, `MethodList`, `PropertyList` (`PropertyInfo`: name, type id, getter, setter), `AttributeList` and
`NameList` values (`items`, `length`). `#methods` leaves out constructors and property accessors; an enum has no `#fields`. Every list implements `IFormatable<string>`
(`format()` joins the names); `IFormatable<T>` (`T format()`) is declared in the core. The queries and the `MemberKinds` classification are shared by the
reflection tables, so a future compile-time macro stage can call the same functions. `Console.write*` does not use `IFormatable` yet.

`$inspect Type { generate { members } }` (the name is `$`-prefixed so it cannot collide with user code) runs once per declaration before the types are collected and
appends the generated members to the target struct/enum/union (`$inspect Person { generate { public i32 extra; } }`). `--no-generate`, or `generate: false` in `djinn.proj`,
keeps the block for diagnostics but injects nothing. A target that is not declared in the program is an error.

## Variadic parameters, stack arrays and coroutine primitives
- `T... name` (last parameter) receives the extra arguments as `arr<T>`; for `object... name` each argument is boxed. In `std`, `...name`
  with no type means `object... name`. `...` without a name stays a C variadic (externs).
- `i8[n]` allocates `n` elements on the stack and yields `i8*`.
- Constants of the enclosing struct can be used without the type name inside its methods.
- A bodyless method is allowed only in `[intrinsic]` and `[no_mangle]` structs. The `coro` primitives (`handle`, `suspend`, `done`, `resume`,
  `destroy`) of an `[intrinsic]` struct map to the LLVM coroutine intrinsics.
