# Djinn bootstrap subset

The source of `djinnc/` may only use the constructs below, and the published seed (see `PROMOTION.md`) must compile
all of them. A new language feature enters the compiler first; the compiler source may only use it after a new seed
that supports it is published. A construct outside this list is forbidden in `djinnc/src` until the seed supports it.
The C++ compiler (stage0) was the seed until the tag `stage0-final`; the rules below that mention stage0 describe
that history.

`djinnc` does not depend on `std`: every external symbol is declared in `src/support/system/libc.djinn`.

## Declarations

- `namespace djinnc;` in every file
- free functions, `extern "C" { ... }` blocks (including variadic `...`)
- `struct` with fields, `public` / private methods, `public static` methods
- `static` factory methods returning `T*` (heap allocated with `Memory.zalloc`)

## Types

- `isize` (signed) and `usize` (for values that cannot be negative) are always 32 bits, on every target; `sizeof` has the type `isize`. `nint` is the integer with the width of the target pointer (`--target <triple>`, default the host), 16, 32 or 64 bits, and `ptr` is the address type.

- `i8 i16 i32 i64 u8 u16 u32 u64 f64 bool void`
- pointers: `T*` for struct pointers; raw pointers are `ptr` (opaque, the old `void*`) and `ptr<T>` (`ptr<u8>`, `ptr<ptr<i8>>`, the old `i8*`, `u8*`, `void**`). Stage0 treats both as plain pointers and ignores `unsafe`. djinnc keeps `ptr`/`ptr<T>` as a distinct raw pointer type and requires an `unsafe { ... }` block or an `unsafe` function for: dereferencing, indexing or doing arithmetic on a raw pointer, casting an integer (other than the constant `0`) to a pointer, and casting a raw pointer to a typed pointer (`T*`). Casting `T*` to `ptr<T>` and a pointer to an integer stays safe. `T*` itself is not restricted yet. No references, no optionals
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

`ensure`/`require` contracts, closures, destructuring.

## Errors

`throws(A, B)` after a function signature, `throw value;`, `try call() ?: fallback`, `try call()` (re-throw) and `switch call() { Result v -> ..., ErrorType e -> ..., Error e -> ... }` are supported. A function that throws returns a `{ i32 tag, payload }` record by value (the shape of Rust's `Result`); an error type is any struct listed in a `throws` clause, without hierarchy. A bare `throws` converts every error to the core `Error`. One arm can catch several error types without a hierarchy: `NotFound | Denied e -> e.code` expands to one arm per type, each checked with `e` typed as that error, so the body can use whatever the listed types share. Async functions box the record on the coroutine promise. `Error.stackTrace` is filled in debug builds.

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

`for (T x in collection)` loops over an `arr<T>` (`T[]`): `collection` is a variable, a field path, a call or a literal, evaluated once; `x` is a copy of each element and `break`/`continue` work. It is lowered in the parser to a counting `for` with hidden `__indexN` (and `__itemsN` when the collection is not a plain path). A `..` between `in` and `)` makes it a range loop instead.

`x++`, `++x`, `x--` and `--x` are one node: the operand is evaluated once and must be a variable, field or element (not a property or indexer) of an integer, float or pointer type; the postfix form yields the old value and the prefix form the new one. Raw pointers need `unsafe`; `constexpr` functions can use them on locals.

The compile-time constants `Platform.Windows/Linux/MacOs`, `Arch.X64/X86/Arm64`, `Build.Debug/Release` (debug means `-g`) and `Runtime.PointerSize` come from the target triple, so `--target` changes them; a struct or variable with the same name takes precedence.

`for (i32 i in [1..10])`, `[0..5)`, `0..5` and `0..=5` loop over a range. The start is always inclusive; `[a..b]` and `..=` include the end, `[a..b)` and `..` exclude it. The parser lowers it to a plain `for` with a hidden `__limitN` variable, so the end is evaluated once. `(a..b]` and `(a..b)` exclude the start: the loop begins at `a + 1`. A `(` after `in` is a range only when `..` appears directly inside it, so `(n)..5` is still the ordinary range.

## Named arguments

Calls, method calls and constructors (`Point(y: 4, x: 3)`, `new Point(x: 1, y: 2)`, `clamp(50, high: 10, low: 0)`) accept `name: value` arguments after any positional ones. They are matched to the parameter names of the callee (the overload whose names fit is picked) and reordered into parameter order, so evaluation follows parameter order. Not available for enum variants, intrinsics or calls through generic inference of unnamed callees.

## `string` and interpolation

`core.djinn` also declares `string { i8* data; u32 length; u32 capacity; }` with `is_empty()`, `ptr()` and `operator +` (concatenation). A string literal gets type `string` when that is the expected type. Only a `$"..."` literal interpolates, as in C#: `$"count={count}"` or `$"sum={p.x + p.y}"` has type `string`, and its parts can be integers, bools, floats, `i8*`, `str` and `string`. An expression can carry a format, `{value:[-][0]width[.precision]}`: `{n:6}` right-aligns, `{n:-6}` left-aligns, `{n:06}` zero-pads numbers, `{x:.2}` prints a float with fixed decimals and `{s:.3}` truncates text (`{x:8.2}` combines both). The lexer reads the part after a top-level `:` (not `::`, not inside parentheses or after a `?`) as an `INTERP_FORMAT` token, the parser packs it into the preceding text part and the runtime pads with `__djinn_text_*_format`. Widths go up to 4096 and precision up to 99. Without a precision a float prints as the shortest text that parses back to the same value, like C# `ToString()`: `0.1 + 0.2` is `0.30000000000000004`, `f32` values are not widened (`0.1f` is `0.1`), fixed notation is used while the decimal exponent is in `-5 < e < 15` and `1E+16`/`1.5E-07` style otherwise, and `NaN`, `Infinity`, `-Infinity` and `-0` are spelled out. Arrays and reflection use the same text. Interpolation of float literals is not folded at compile time yet. A plain `"..."` never interpolates, so `"{count}"` is just text. Inside `$"..."`, `{{` and `}}` are literal braces and a lone `}` is an error. The lexer splits an interpolated literal into `INTERP_BEGIN`/`INTERP_MIDDLE`/`INTERP_END` tokens around the ordinary expression tokens. The builder (`__djinn_text_*`) is Djinn code in `core.djinn`; sizes are checked against the `u32` limit, and allocation failure is reported only by `__djinn_malloc`.

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
`NoRecurse`, `InlineHint`, `OptSize`, `MinSize`, `NoFree`, `NoMerge`, `Speculatable` and `Llvm("attr")` become LLVM function attributes; `Const` and `Pure` become `memory(none)` and `memory(read)`. On parameters, `ReadOnly`, `WriteOnly`, `Restrict` (`noalias`), `NonNull`, `NoCapture` (`captures(none)`) and `Align(n)` become LLVM parameter attributes (the type must be a pointer). `NonNull` on a function (or method) marks a pointer return value `nonnull`, and `Align(n)` on a function sets its alignment; `Align(n)` on a struct pads its size to a multiple of `n` and aligns its stack slots and globals (`new` of a struct aligned above 16 uses `__djinn_malloc_aligned(size, alignment)`, a power-of-two alignment as in C++ `align_val_t`; release it with `__djinn_free_aligned`), and a non-power-of-two `n` is a warning. `Align` on a field is accepted with a warning and not applied. `Volatile` on a field or a `static` makes every load and store of it volatile. `Export` keeps a function external: at `-O1` and above, an executable turns every definition that is not `main`, a `__djinn_*` runtime symbol or `[Export]` into `internal` so LLVM can inline, remove and infer attributes on it (the same rule `--run` uses), so mark a function that C code or another object links against. `[Prefetch]` on a pointer parameter emits `llvm.prefetch` for that pointer at function entry, and the `prefetch(address)` intrinsic (or `prefetch(address, access, locality)` with literal `access` 0 read / 1 write and `locality` 0..3, default read and 3) emits it anywhere; both are hints with no effect on the result. A statement attribute goes before a loop: `[Unroll]`, `[Unroll(n)]` (`llvm.loop.unroll.enable` / `.count`), `[NoUnroll]`, `[Vectorize]` and `[NoVectorize]` (`llvm.loop.vectorize.enable`) become `!llvm.loop` metadata on the loop's back edge for `while`, `do`/`while`, `for` and `for (T x in a..b)`; on any other statement they are a warning. They live in function bodies, so they cross the library boundary through the interface source and need no `.djlib` change. `NoMangle` and `Deprecated` are validated but have no LLVM effect; `Reflect` (structs, enums, unions, interfaces) drives reflection, see below. Only attributes that cannot introduce undefined behavior are implicit: every defined function is `nounwind` and `__djinn_malloc` returns `noalias`; everything else is opt-in, and a wrong promise is undefined behavior. `likely(cond)` and `unlikely(cond)` emit `llvm.expect`.
An unknown name is an error; a wrong target is a warning.

`attribute Name(targets);` and `attribute Name(targets) { fields }` declare attributes (the targets expression is skipped, so declared
attributes are valid everywhere); the form with fields also defines a struct `Name`. `[attribute(...)] struct XAttribute {...}` declares `X`
and `XAttribute`. `[intrinsic]` and `[no_mangle]` structs are parsed and dropped (the core provides `task<T>` and the coroutine primitives).

A parameter marked `[Location]` whose type is a struct with `fileName`, `line` and `column` is filled by the compiler with the call site
when the call omits it (only the last parameter, no overloads).

Intrinsics: `unlikely(bool)`, `assume(bool)`, `debugtrap()`, `trap()`, `unreachable()`. Struct initializers also accept positional values
(`{ 0, 0, 0 }`).

## Ownership
A type is Trivial or a Value, derived from its fields. Trivial types copy on `T x = y;` and `x = y;`: integers, floats, `bool`,
pointers, `str`, `arr<T>`, payload-less enums, and structs whose fields are all Trivial. A struct that implements `Disposable`, or has
a field that needs disposal, is a Value and moves; tagged enums move too. Using a moved variable is an error; assigning to it
re-initializes it. A local also moves when it is returned, assigned to a field or an index, used as a field value in a struct
initializer, or passed by value to a function; a parameter of a Value type is owned by the callee, which disposes it. Extern
functions, operators and property accessors borrow their parameters. `string` is a Value that always owns a heap buffer (a literal
typed `string` is copied); `str` is a Trivial view.

`Disposable` (`std::types::constraints`) has `void disposable()`. The compiler calls it at the end of the block that declares the
variable, in reverse order, before `return`, `throw` and error propagation, on `break` and `continue`, and on reassignment. A struct
without its own `disposable()` disposes its Disposable fields, last first. A drop flag exists only for a variable that is moved or
declared without an initializer. Temporaries, values moved into containers and coroutines cancelled while suspended are not disposed.
`Cloneable<T>` (`T clone()`) is the interface for an explicit copy.

Borrows: `T* p = &x;` (local `x`, safe pointer) borrows `x` until `p` leaves scope. While the borrow is live, `x = ...`, `x++` and moving `x`
are errors, and a second `&x` is an error when `x` is `mut` (the borrow is exclusive; borrows of an immutable `x` are shared and can coexist).
Only a declaration initialized directly with `&x` is tracked: borrows passed to calls or stored in fields are not, reads of `x` are not
checked, and there is no flow analysis (a borrow lives for the whole scope of its pointer). `return &local;` is an error.

## Macros
`macro name { (params) => { expression } ... }`. Parameters are `expression x`, `identifier x`, `literal x`, `type T` or a bare literal token
(`add`, `debug`, ...); `local` (on a parameter or before the parameter list) evaluates the argument once. `=> void` expands to `0`.
Rules are chosen by arity and fragment kind, in order. Expansion happens in the parser by AST substitution, so precedence is preserved,
a macro must be declared before it is used, and `type` parameters cannot be referenced from the body. Using a non-`local` expression
parameter more than once warns.

## constexpr and consteval
`constexpr T NAME = expr;` (global or local), `constexpr`/`consteval` functions and compile-time `if` (`if constexpr cond { }`, `if consteval cond { }` or
`if cond { }` without parentheses) run in a compile-time evaluator. Supported values are integers, floats, `bool`, payload-less enums, `i8*` strings and `str`/`string` text; functions may use
locals, assignment, `if`, `while`, `do`, `for`, `switch`, `break`, `continue`, recursion (depth 512, 1,000,000 steps) and calls to other constexpr/consteval
static functions. Integers wrap to their declared width. A `constexpr` variable needs a constant initializer and forward references between globals are resolved
on demand (cycles are errors). A call with constant arguments to a `constexpr` function is folded to a literal and otherwise stays a normal call; a `consteval`
call that cannot be evaluated is an error (except inside another constexpr/consteval body). `constexpr` and `async` cannot be combined, and structs and pointers other than strings
are not supported in the evaluator yet. Strings are `i8*` values that always point into a string literal: a literal, `s[i]`, `*s`, `s + n`, passing and returning them, `constexpr i8* NAME = "..."` and locals work, and an index or offset past the terminating NUL is an error. `sizeof(T)` of an integer, float, bool or pointer type (including a generic `T` bound by instantiation) is a constant, so `if constexpr sizeof(T) == 4 { }` selects code per instantiation; `sizeof` of a struct is only known at code generation and is not evaluated. `str` and `string` values are NUL-terminated text held by the evaluator: literals, `+` between two texts, `==` and `!=`, `.length`, `$"..."` interpolation of integers, `bool` and text (no format specifiers, no floats), passing and returning them, and `constexpr str NAME = ...` all work. `a + b` on two `str` values is only valid at compile time (it is folded to a static `str`; outside a `constexpr`/`consteval` body a non-constant operand is an error). A `constexpr` variable cannot be a `string`, because a `string` always owns heap memory: use `str`. There is no comparison of pointers. A folded `str` becomes a static constant in the generated code and a folded `string` a heap copy.

String interpolation also folds in the code generator: when every part is a literal, an immutable local with a literal initializer, or an array literal of such items (integers, text and structs without a formatter, printed as `[ item, item ]`), the whole text is one constant and no text builder, boxing or reflection call remains. When the interpolation is typed `str` (for example an argument of a `str` parameter) the constant is static and nothing is allocated.

Structs of integers, floats, `bool` and text fields can be built and read inside the evaluator, and a `constexpr` or `consteval` instance method can be evaluated with `this` bound to such a struct. A struct that implements `IFormatable<string>` through a `constexpr` `format()` is therefore folded when it is an element of a constant array: its text is evaluated at compile time and printed quoted, as the runtime does, so no `format()` call, boxing or reflection remains.

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

## Nullable pointers, hooks and small language additions
- With `std`, `T*?` is `optional<T*>` (pointer niche). `p == null` and `p != null` compare it (also `null == p` and against a `T*`), and `p.field`
  / `p.method()` on it check for null and stop with `R10009`. `p!.member` is the same access written out, and is an error on a value that is not
  nullable (E3041). `p?.member` and `p?.method()` yield a nullable pointer (`null` when `p` is null) and need a pointer-typed member; chains such as
  `a?.next?.next` work. `a ?? b` accepts a nullable `a` (`b` is a `T*` or a `T*?`), and `a ??= b` assigns when `a` is null.
  Converting a `T*?` to a `T*` implicitly compiles with warning W6003; check it against `null` or use `!.`.
  The same operators work on nullable values: `T?` for an array, scalar or struct is `optional<T>`; `v == null`, `v != null`, `v ?? fallback`, `v!.member` (and the implicit unwrap of `v.member`) test its tag, and assigning a `T` or `null` to a `T?` wraps it. `?.` still needs a pointer member.
- `nints`, `nintt`, `nintw`, `nintc` are `nint` with an overflow mode, like `i32s` / `i32t` / `i32w` / `i32c`. `nint.MAX_VALUE` and `nint.MIN_VALUE` come from `std`.
- `Type.method(...)` calls a `static` method declared in `impl Type { }` of a primitive (`i32.clamp(x, 0, 9)`).
- `str[i]` and `string[i]` read a byte and are bound checked (`R10010`); when the text and the index are constants (`const str`, a literal) the
  index is checked at compile time (E3057) and folded to the byte.
- `const T X = e;` inside a function is a compile-time constant (same as `constexpr`). `mut const` is an error (E2013), in a struct and in a function.
- `for (0..5) { }` and `for (1..=3) { }` repeat without a loop variable.
- `alignof(T)` and `alignof(expr)`, `sizeof(expr)` and `typeof(variable)`, and `expect(value, expected)` (`llvm.expect` for an integer or bool).
- `$"..."` interpolates `{x}` (`{{` and `}}` are literal braces). With `n` dollar signs, `n` braces delimit the interpolation and fewer braces are literal:
  `$$"{x} is {{x}}"`. `$"""..."""` and `$$"""..."""` are multi-line forms without escapes.
- `&function` (a plain, non-generic, non-overloaded function) is its address as `ptr`.
- Hooks (`std::system`): `System.hook(HookKind.PANIC, &handler)` installs `void handler(i8* message, i8* file, u32 line)`, which runs instead of the
  default panic report and then the process aborts; it returns the previous handler. `System.unhook(kind)` removes it, and
  `System.print_default_panic_report` prints the standard report from inside a handler. The macro `hook(panic, handler)` is the short form.
- Runtime panics are defined once, in `djinnc/src/support/source/runtime_errors.djinn` (`RuntimeErrors`: code and text) and reported as `R<code>: <text>`.
  `bounds_check(index, length)` is the intrinsic `std` uses to raise `R10010`.
- `auto { x, y } = expr;` declares `x` and `y` in the enclosing scope from the fields of the same names of `expr`.
- `char` is a Unicode scalar value (32 bits, unsigned, its own type). `'a'`, `'é'`, `'😀'`, `'\n'`, `'\t'`, `'\r'`, `'\0'`, `'\\'`, `'\''` and `'\u00E9'` (4 hex digits) and `'\U0001F600'` (8 hex digits) are `char` literals (E1004 for an empty literal or more than one character). A `char` is `==` and `!=` comparable with a `str` or `string` (true when the text is exactly that one character; a length check answers first). A `char` converts to and from integers only with an explicit cast (`(i32)c`, `(char)n`); comparing or combining it with an integer is E3054, and it prints as UTF-8 in `$"..."`. `str` and `string` keep their UTF-8 byte storage (`i8* data`): `startsWith`, `endsWith`, `indexOf`, `lastIndexOf` and `contains` also take a `char`, encoded to UTF-8 before the search; `length` and indexing are still counted in bytes.
