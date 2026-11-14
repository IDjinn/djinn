# Djinn

[![Build](https://github.com/IDjinn/djinn-lang-v3/actions/workflows/ci.yml/badge.svg)](https://github.com/IDjinn/djinn-lang-v3/actions/workflows/ci.yml)

A compiled, statically-typed systems language that targets LLVM IR with a C runtime. Inspired by C, C++ and C#, Djinn
focuses on developer experience, simplicity, and high performance — with async-by-default codegen.

```djinn
void main() {
    printf("hello world!");
}
```

## Why Djinn

- **Native performance**: direct LLVM IR codegen, no VM, no GC. `-O1`..`-O3`/`-Os`/`-Oz` run LLVM's default pipeline;
  attributes (`[Hot]`, `[Pure]`, `[Restrict]`, `[Unroll]`, `[Vectorize]`, ...) map to LLVM attributes and loop metadata,
  and range analysis feeds the optimizer.
- **JIT and tiering**: `--run` executes a program in process through ORC LLJIT; `--tiered` promotes hot functions
  through three tiers using runtime counters and branch profiles.
- **Async by default**: LLVM coroutines, event loop and thread pool, `spawn` / `await` built into the language; async
  functions that can never suspend are compiled as plain functions.
- **Memory safety without a GC**: move semantics, `Disposable` cleanup at end of scope, a borrow checker for
  `&local` borrows, immutable-by-default variables, bounds-checked `str`/`string`/`arr`, and `unsafe` for raw pointers.
- **Modern type system**: generics with `where` constraints, tagged unions, interfaces and `impl`, nullable types
  (`T?`, `?.`, `??`), operator overloading, named arguments, pattern matching via `is` and `switch`.
- **Errors are values**: `result<T, E>`, `optional<T>`, `throws` / `try` with contracts (`require` / `ensure`); no
  unwinding.
- **Compile-time programming**: `constexpr` / `consteval`, hygienic macros, compile-time `if`, member queries
  (`T#fields`) and `$inspect` code generation.
- **Reflection**: opt-in `TypeInfoExt` (fields, methods, attributes, interfaces, enum variants), zero-cost when unused;
  the test framework discovers `[Test]` through it.
- **Libraries that just work**: `.djlib` bundles object code with the Djinn interface (macros, generics, constexpr and
  reflection survive separate compilation).
- **Great DX**: self-hosted compiler, LSP server, diagnostics with codes and suggestions, built-in test runner
  (`djinnc test`) with watch mode, benchmarks and JUnit output, Compiler Explorer and VS Code integrations.

## A Quick Tour

Generics, enums, and pattern matching:

```djinn
union optional<T> {
    Some(T),
    None()
}

result<i32, MathError> div(i32 a, i32 b) {
    if (b == 0) { return result::Err(MathError::DivByZero()); }
    return result::Ok(a / b);
}
```

Structs with methods, properties, and ownership:

```djinn
struct User {
    string name;
    i32 age;

    string display { get => name; }

    static User new(string name, i32 age) => User { .name = name, .age = age };
}
```

Async and parallelism:

```djinn
async i32 fetch_count() {
    i32 n = await load_from_disk();
    return n;
}

async i32 main() {
    i32 result = await fetch_count();
    return result;
}
```

Macros (hygienic, multi-rule, pattern-matched):

```djinn
macro square {
    (local expression v) => { v * v }
}

i32 x = square(foo());   // foo() evaluated exactly once
```

Ownership and borrowing:

```djinn
struct Buffer : Disposable {
    i32* data;
    void disposable() { free(data); }
}

void main() {
    Buffer a = Buffer.create();
    Buffer b = a;          // a moves into b
    // use(a);             // error: use after move
    i32 x = 1;
    i32* p = &x;           // x is borrowed while p is in scope
    // x = 2;              // error: BORROW_CONFLICT
}                          // b.disposable() runs here
```

Compile-time evaluation:

```djinn
consteval i32 factorial(i32 n) {
    if (n <= 1) { return 1; }
    return n * factorial(n - 1);
}

constexpr i32 BUFFER = 64 * 1024;
```

## Features

- **Types**: `i8`..`i64`, `u8`..`u64`, `f32`/`f64`, `nint`/`nfloat`/`ndouble`, `bool`, `char` (Unicode scalar), `str`
  (view), `string` (owned), `arr<T>`, `slice<T>`, pointers (`T*`, `ptr<T>`), `object`, `auto`; integer overflow modes
  (`w`rapped / `t`rapped / `c`hecked / `s`aturating) and non-zero types (`i32n`)
- **Control flow**: if/else, while, do-while, for (classic, range, each), `switch` statement and expression, break/continue
- **Ranges**: `for (i32 i in 0..10)`, `..=` inclusive, bracket bounds `[0..10)`
- **Structs**: brace init, constructors, `new`, methods (block / `=>`), static methods, properties, `impl` blocks,
  operator overloading (including `get[]` / `set[]`), overloading by parameter types, named and variadic arguments
- **Generics**: structs, unions, interfaces, functions and methods; monomorphization; `where` constraints
- **Unions**: tagged unions / ADTs with payloads, generic; `enum` with header fields per variant
- **Interfaces**: fields and methods, generic interfaces, `impl Iface for T`, operator constraints
- **Pattern matching**: `obj is i32 value`, `x is Enum::Variant a b`, `switch value { Some v -> v, None -> 0 }`
- **Ownership**: move semantics, use-after-move detection, `Disposable`, borrow checker, `owner<T>` / `shared<T>`
- **Mutability**: immutable by default, `mut` to opt in
- **Nullable**: `T?`, `p?.member`, `p!.member`, `a ?? b`, `a ??= b`
- **Errors**: `throws`, `throw`, `try ... ?: fallback`, `require` / `ensure`, runtime panics with `R<code>` codes and hooks
- **Async/Await**: LLVM coroutines, `yield`, `spawn`, event loop runtime, async sockets and files
- **FFI**: `extern "C"` functions and blocks, variadics
- **Macros**: `expression` / `identifier` / `literal` / `type` / `block` fragments, `local` modifier, multi-rule dispatch
- **Attributes**: parameterized (`[align(16)]`), LLVM attribute mappings, loop hints, `[llvm("...")]` escape hatch,
  user-declared with `attribute`
- **Strings**: `$"count={n:6}"` interpolation with formats, `"""` multi-line literals
- **Number literals**: `420_000`, `800'000'000`, `1e9`, `2.5e-3`, overflow-mode suffixes (`123w`, `123t`, `123c`, `123s`)
- **Intrinsics**: `sizeof`, `alignof`, `typeof`, `likely`, `unlikely`, `expect`, `prefetch`
- **Libraries**: `--library` mode, `.djlib` format, `djinn.proj` projects, cross-module generic dedup (`LinkOnceODR` + COMDAT)
- **Reflection**: `[Reflect]` or `--reflect-all`; `typeof(function)`; compile-time member queries and `$inspect`
- **Tooling**: LSP server, `--inspect-lib`, `djinnc test`, tiered JIT, `--emit-ir` / `--emit-asm` / `--emit-ast`

## Getting started

Requirements: LLVM 21 with the C API (`LLVM-C.dll` / `libLLVM-C.so` on `PATH`), `clang`, and Bash. The C++ compiler
(stage0) was removed, so you need a seed `djinnc` (the `stage0-final` release or a later one).

```bash
bash tools/bootstrap.sh --seed <path to djinnc> --runtime-dir runtime     # seed -> stage1 -> stage2 -> stage3, fixpoint, samples
bash tools/build_runtime.sh --out build/runtime                           # prebuilt runtime library

djinnc hello.djinn -o hello --runtime-dir runtime && ./hello              # compile and link
djinnc hello.djinn --run --runtime-lib build/runtime/djinn_runtime.lib    # JIT
djinnc test libs/testing                                                  # run a project's tests
```

Full option list: [djinnc/USAGE.md](djinnc/USAGE.md). Language syntax: [GRAMMAR.md](GRAMMAR.md); what the compiler
supports in detail: [djinnc/SUBSET.md](djinnc/SUBSET.md); libraries: [djinnc/LIBRARY.md](djinnc/LIBRARY.md).

## Standard Library

Lives under `std/` (consumed as `std.djlib`, or with `--std`):

- `types/`: core types (`size`, `bool`, `str`, `string`, `arr<T>`, `optional<T>`, `result<T, E>`, `TypeInfo`, `object`)
  and constraint interfaces (`Hashable`, `Comparable`, `Equatable`, `Disposable`, `Cloneable`, ...)
- `collections/`: `array`, `map`, `set`, `bag`, `stack`, `queue`, `priority_queue`, `ring_buffer`, `bitset`,
  `linked_list`, `slice`, `range`, `sorting`
- `memory/`: `arena`, `pool`, `allocator`, `owner<T>`, `shared<T>`
- `text/`: `string_builder`, `Text`, `Numbers`, `Chars`, string methods, `interner`
- `encoding/` (`byte_buffer`, `Hex`, `Base64`), `hashing/` (FNV-1a, xxHash64, SHA-256), `format/` (CSV, TOML)
- `filesystem/`: validated `Path`, `Directory` capability, `File`
- `sys/`: `console`, `io`, `debug`, `libc`, `atomic`, `math`, `process`, `logger`, `system` (panic hooks), `spectre` (terminal UI)
- `net/` (async sockets), `util/` (`json`, `version`), `builtin/` (coroutine utilities)

## Architecture

```
djinnc/       Self-hosted compiler (lexer, parser, semantic analysis, LLVM codegen, driver, JIT), written in Djinn
std/          Standard library (.djinn sources)
runtime/      C runtime (scheduler, thread pool, coroutines, io, sockets, diagnostics)
libs/         Libraries built with djinnc (testing framework)
djinn-lsp/    Language server, written in Djinn
tools/        Bootstrap, runtime/std builders, Compiler Explorer, VS Code extension
tests/        tests/conformance (the Djinn test suite, where every new test goes) and tests/djinnc
docs/         Fumadocs documentation site (submodule)
```

Compiler pipeline: `source -> Lexer -> Parser (AST) -> semantic analysis -> LLVM-C codegen -> object -> clang/lld + runtime`.
Contributor and agent guidelines: [AGENTS.md](AGENTS.md).

## License

See `LICENSE`.
