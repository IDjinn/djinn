# Djinn bootstrap subset

The source of `djinnc/` may only use the constructs below. Both stage0 (C++) and djinnc itself must compile all
of them. A construct outside this list is forbidden in `djinnc/src` until the djinnc codegen supports it.

`djinnc` does not depend on `std`: every external symbol is declared in `src/support/libc.djinn`.

## Declarations

- `namespace djinnc;` in every file
- free functions, `extern "C" { ... }` blocks (including variadic `...`)
- `struct` with fields, `public` / private methods, `public static` methods
- `static` factory methods returning `T*` (heap allocated with `Mem.zalloc`)

## Types

- `i8 i16 i32 i64 u8 u16 u32 u64 f64 bool void`
- pointers `T*`, `T**`, `void*`; no references, no optionals, no `arr<T>`, no `string`
- `sizeof(T)`, casts `(T)expr` between integers, floats and pointers
- pointer arithmetic `p + n`, indexing `p[i]`, field access through pointer `p.field`

## Statements

- local variables (`T name = expr;`, `mut T name = expr;`)
- `if / else if / else`, `while`, `do-while`, `for`, `break`, `continue`, `return`
- assignment to locals, fields and indexed pointers

## Expressions

- integer, float, bool, string (`i8*`) and `null` literals
- `+ - * / %`, comparisons, `&& || !`
- calls, method calls, static calls

## Globals

- `static mut void* name = null;` is used for the process arena (`Mem.arena()`). Typed struct pointers cannot be
  used as the global's type yet (stage0 reports the struct as not found), so the global is `void*` plus a cast.

## Forbidden

generics, enums, `switch`, interfaces, `impl`, async/await, `try`/`throws`, `??`, `ensure`, string
interpolation, closures, `auto`, destructuring.

Enum-like values are `i32` constants held in `static` structs until `==` on enums exists in both compilers.
