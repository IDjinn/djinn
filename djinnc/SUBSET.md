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
- pointers `T*`, `T**`, `void*`; no references, no optionals, no `arr<T>`, no `string`
- `sizeof(T)`, casts `(T)expr` between integers, floats and pointers
- pointer arithmetic `p + n`, indexing `p[i]`, field access through pointer `p.field`

## Statements

- local variables (`T name = expr;`, `mut T name = expr;`)
- `if / else if / else`, `while`, `do-while`, `for`, `break`, `continue`, `return`
- `switch (integer) { case <const>: ... default: ... }` as a statement: no fallthrough, `break` leaves the switch, `continue` targets the enclosing loop
- `enum Name { A(), B = 5, C }` and tagged enums `enum Msg { Empty(), Number(i32), Pair(i32, i32) }`: `Msg::Pair(1, 2)` builds a value, payload-less enums are `i32` tags with `==`, `!=` and `case Name::A():`. `switch value { Empty -> 1, Number n -> n, Pair a b -> a * b }` is an expression and must cover every variant. Payload types are scalars; generic enums are not supported yet.
- `interface Name { Type field; Ret method(params); }`, `struct X : interface Name` (or `struct X : Name`), `impl X { methods }` and `impl Name for X { methods }`: conformance (fields and method signatures) is checked at compile time; there is no interface-typed value or dynamic dispatch, no generic interface, and `impl` takes a single struct or enum target. `impl A, B for X` lists several interfaces, and `impl` on an enum adds methods whose `this` is the enum value (e.g. `switch this { ... }`).
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

async/await, `try`/`throws`, `ensure`, string
interpolation, closures, `auto`, destructuring.

Enum-like values are `i32` constants held in `static` structs until `==` on enums exists in both compilers.

## Generics

- `struct Pair<K, V> { ... }` and `enum optional<T> { Empty(), Value(T) }`; instances are monomorphized on demand (`Pair<i32, i64>`, nested `Wrapper<Pair<i32, i32>>`) with their methods.
- `where T : A, B; where U : C` constrains type parameters; a struct or enum type argument must satisfy the interfaces, checked at instantiation. A generic type can also list interfaces (`struct X<T> where T : I : J`).
- `optional<i32>::Value(1)` builds a generic enum value; struct initializers and `switch` work on instances.
- Generic interfaces: `interface Comparable<T> { i32 compare(T other); }`, used as `struct P : Comparable<P>` or in bounds (`where T : Comparable<T>`); interfaces can declare `operator` members.
- Generic functions: `T larger<T>(T a, T b) where T : Comparable<T> { ... }`; type arguments are inferred from the arguments (including `Pair<K, V>` and `T*` parameters) or given explicitly, as in `first<i64>(1, 2)`.
- `impl Box<T> { ... }` and `impl Iface for Box<T> { ... }` add methods and interfaces to every instance; the impl names the type parameters itself.
- Not yet: generic methods, explicit constructors.
- Operator overloading: `operator +(T left, T right) -> T { ... }` inside `impl T { }` or the struct body defines a static operator method; binary expressions on struct values call it. `!=` is derived from `==`.
