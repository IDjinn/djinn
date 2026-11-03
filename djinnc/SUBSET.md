# Djinn bootstrap subset

The source of `djinnc/` may only use the constructs below. Both stage0 (C++) and djinnc itself must compile all
of them. A construct outside this list is forbidden in `djinnc/src` until the djinnc codegen supports it.

`djinnc` does not depend on `std`: every external symbol is declared in `src/support/libc.djinn`.

## Declarations

- `namespace djinnc;` in every file
- free functions, `extern "C" { ... }` blocks (including variadic `...`)
- `struct` with fields, `public` / private methods, `public static` methods
- `static` factory methods returning `T*` (heap allocated with `Memory.zalloc`)

## Types

- `i8 i16 i32 i64 u8 u16 u32 u64 f64 bool void`
- pointers `T*`, `T**`, `void*`; no references, no optionals
- `sizeof(T)`, casts `(T)expr` between integers, floats and pointers
- pointer arithmetic `p + n`, indexing `p[i]`, field access through pointer `p.field`

## Statements

- local variables (`T name = expr;`, `mut T name = expr;`)
- `if / else if / else`, `while`, `do-while`, `for`, `break`, `continue`, `return`
- `switch (integer) { case <const>: ... default: ... }` as a statement: no fallthrough, `break` leaves the switch, `continue` targets the enclosing loop
- `enum Name { A(), B = 5, C }` and tagged enums `enum Msg { Empty(), Number(i32), Pair(i32, i32) }`: `Msg::Pair(1, 2)` builds a value, payload-less enums are `i32` tags with `==`, `!=` and `case Name::A():`. `switch value { Empty -> 1, Number n -> n, Pair a b -> a * b }` is an expression and must cover every variant. A payload can be any type: the enum is a tag plus an inline byte area sized to the largest variant, and a type that contains itself by value (not through a pointer) is an error.
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

Enum-like values are `i32` constants held in `static` structs until `==` on enums exists in both compilers.

## Generics

- `struct Pair<K, V> { ... }` and `enum optional<T> { Empty(), Value(T) }`; instances are monomorphized on demand (`Pair<i32, i64>`, nested `Wrapper<Pair<i32, i32>>`) with their methods.
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

- Operator overloading: `operator +(T left, T right) -> T { ... }` inside `impl T { }` or the struct body defines a static operator method; binary expressions on struct values call it. `!=` is derived from `==`.

## Overloading

- Functions, methods, constructors and operators can share a name when their parameter types differ; a redefinition with the same parameter types is still an error.
- The call picks the candidate whose parameter types match best (exact type beats numeric conversion); no match or a tie is a compile error. Overloads after the first get a `$n` suffix in the symbol name.


## Core types: `str` and `arr<T>`

The core library (`runtime/core.djinn`, read from `--runtime-dir`) is compiled with every program and declares `str { i8* data; u32 length; }` and `arr<T> { T* data; u32 length; }`, both with `is_empty()` and `ptr()`.

- `T[]` is `arr<T>`; `[a, b, c]` is an array literal, allocated with `__djinn_malloc`. The element type comes from the context or the first element; an empty literal needs a context.
- A string literal is `i8*` unless the expected type is `str`, which gives `{ data, length }`.
- `array[i]` indexes `arr<T>` (read and write); `length` is a field.

## Range-for

`for (i32 i in [1..10])`, `[0..5)`, `0..5` and `0..=5` loop over a range. The start is always inclusive; `[a..b]` and `..=` include the end, `[a..b)` and `..` exclude it. The parser lowers it to a plain `for` with a hidden `__limitN` variable, so the end is evaluated once. Ranges with an open start, `(a..b]`, are not supported (stage0 does not have them either).

## Named arguments

Calls, method calls and constructors (`Point(y: 4, x: 3)`, `new Point(x: 1, y: 2)`, `clamp(50, high: 10, low: 0)`) accept `name: value` arguments after any positional ones. They are matched to the parameter names of the callee (the overload whose names fit is picked) and reordered into parameter order, so evaluation follows parameter order. Not available for enum variants, intrinsics or calls through generic inference of unnamed callees.

## `string` and interpolation

`core.djinn` also declares `string { i8* data; u32 length; u32 capacity; }` with `is_empty()`, `ptr()` and `operator +` (concatenation). A string literal gets type `string` when that is the expected type. Only a `$"..."` literal interpolates, as in C#: `$"count={count}"` or `$"sum={p.x + p.y}"` has type `string`, and its parts can be integers, bools, floats, `i8*`, `str` and `string`. A plain `"..."` never interpolates, so `"{count}"` is just text. Inside `$"..."`, `{{` and `}}` are literal braces and a lone `}` is an error. The lexer splits an interpolated literal into `INTERP_BEGIN`/`INTERP_MIDDLE`/`INTERP_END` tokens around the ordinary expression tokens. The builder (`__djinn_text_*`) is Djinn code in `core.djinn`; sizes are checked against the `u32` limit, and allocation failure is reported only by `__djinn_malloc`.

## Inference

`auto` and `var` are interchangeable keywords: `var total = a + b;` takes the type of the initializer.

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
`[Name]`, `[Name(16)]`, `[Name(key = "text")]` and `[A, B]` before functions, methods, structs and fields. Known names and targets are built in
(the `attribute` declarations of `std` are not read): `ForceInline`, `NoInline`, `NoReturn`, `Hot`, `Cold`, `NoSync`, `NoUnwind`, `WillReturn`,
`NoRecurse` and `Llvm("attr")` become LLVM function attributes; `Align`, `Volatile`, `ReadOnly`, `NoMangle`, `Reflect` and `Deprecated` are
validated but have no effect yet. Every function is implicitly `nounwind`. An unknown name is an error; a wrong target is a warning.
Parameter attributes are not supported.

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
