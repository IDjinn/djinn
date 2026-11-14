# Djinn Lang

## Philosophy

Djinn is a compiled language that uses LLVM IR as its backend with a C runtime. Strongly inspired by C, C++ and C#,
the main focus is a language with great Developer Experience, simplicity, and high performance.

The compiler generates async code by default (LLVM coroutines; an `async` function that can never suspend is compiled
as a plain function, see `--no-async-elision`).

## Language at a glance

Full references: `README.md` (tour), `GRAMMAR.md` (EBNF syntax, keep it in sync with parser changes), `djinnc/SUBSET.md` (what the compiler actually supports, the most
detailed one), `djinnc/USAGE.md` (options), `djinnc/LIBRARY.md`, `examples/`.

- **Types**: `i8`–`i64`, `u8`–`u64`, `f32`/`f64`, `nint`/`nfloat`/`ndouble`, `bool`, `str` (trivial view), `string` (owned
  heap text), `arr<T>`, `slice<T>`, pointers (`T*`, `ptr<T>`), `T?` nullable with `??`, `object`, `auto`. Integer overflow
  modes via literal suffix or type: `w`rapped / `t`rapped / `c`hecked / `s`aturating.
- **Declarations**: structs (methods, properties, static methods, brace init), `enum`/`union` as tagged unions with
  payloads, interfaces + `impl`, generics with `where` constraints (monomorphized), namespaces/`import`, type aliases,
  `extern "C"` blocks for FFI.
- **Expressions**: `$"interpolation {x:6}"`, `is` pattern matching (`obj is i32 v`), range-for (`for (i32 i in 0..10)`),
  `switch`, `auto { x, y } = expr;` destructuring, `likely`/`unlikely`/`sizeof`/`typeof`/`prefetch` intrinsics.
- **Errors are values**: `result<T, E>`, `optional<T>` and error propagation; there are no real exceptions. Runtime panics
  are `R<code>` errors from `djinnc/src/support/source/runtime_errors.djinn`.
- **Mutability**: immutable by default, `mut` opts in. Pointer ops need `unsafe`.
- **Attributes**: `[Name(args)]`, mapped to LLVM function/parameter attributes (`ForceInline`, `Hot`, `Cold`, `Pure`,
  `Restrict`, `Align`, `Unroll`, `Vectorize`, `Export`, ...). Unknown name is an error. `attribute X(targets);` declares new ones.
- **Macros**: hygienic, multi-rule, pattern matched (`expression`/`identifier`/`literal`/`type`/`block` fragments, `local`
  for single evaluation).

### Ownership and borrow checker

Implemented in `djinnc/src/semantic/` (`symbols/ownership.djinn`, `symbols/borrow.djinn`, `checker/type_checker_ownership.djinn`).

- Every type is **Trivial** (copied: numbers, `bool`, pointers, `str`, `arr<T>`, payload-less enums, structs of trivial
  fields) or a **Value** (moved: structs implementing `Disposable`, structs with a field that needs disposal, tagged enums,
  `string`).
- Move semantics: a local moves when returned, assigned to a field/index, used in a struct initializer or passed by value;
  using a moved variable is an error, assigning re-initializes it. A Value parameter is owned (and disposed) by the callee.
  Extern functions, operators and property accessors borrow their parameters.
- `Disposable` (`void disposable()`) runs at end of scope in reverse order, before `return`/`throw`/propagation, on
  `break`/`continue` and on reassignment; drop flags exist only for variables that are moved or uninitialized. Temporaries,
  values moved into containers and coroutines cancelled while suspended are not disposed. `Cloneable<T>` is the explicit copy.
- **Borrow checker**: `T* p = &x;` (safe pointer to a local) borrows `x` until `p` leaves scope. While live, assigning,
  `x++` or moving `x` is an error, and a second `&x` is an error when `x` is `mut` (exclusive); borrows of immutable `x`
  are shared. Diagnostic `BORROW_CONFLICT`. Limits: only a declaration initialized directly with `&x` is tracked (not
  borrows passed to calls or stored in fields), reads are not checked, there is no flow analysis (the borrow lasts the
  whole scope), and `return &local;` is an error.
- Heap ownership types live in `std/memory`: `owner<T>` (single owner, frees on dispose), `shared<T>` (atomic refcount),
  plus `arena`, `pool` and `allocator`.

### Compile-time evaluation

`constexpr` / `consteval` functions and variables run in a tree-walking evaluator over the type-checked AST
(`semantic/const_eval/`), writing results back into the AST as literals. Compile-time `if` keeps only the taken branch;
`[Foldable]` extern math functions can be called on the host. Range analysis (`semantic/range/`, `djinnc/RANGE.md`) proves
bounds and overflow facts for the optimizer and the checked arithmetic modes.

### Reflection

`typeof(T)` gives a `TypeInfo*` (kind, flags). Types marked `[Reflect]` (or all, with `--reflect-all`; `--reflect-none`
disables; `--reflect-annotated` is the default) get a `TypeInfoExt` with fields (offset, `mut`, attributes), methods
(function pointers, parameters, flags), attributes, implemented interfaces, and `EnumInfo`/`VariantInfo`/`HeaderInfo` for
enums and unions. Use the `Reflection` struct (`Reflection.ext/field/method/implements/enumeration/variant`). Nothing is
generated for types that are not boxed, `typeof`'d or reflected, so it is zero-cost when unused. `typeof(function)` returns a
`MethodInfo*`; `Type#fields`, `#methods`, `#properties`, `#attributes`, `#constructors`, `#interfaces` and `$inspect` are
compile-time queries. The test runner finds `[Test]` methods through reflection. `TypeInfo`/`FieldInfo`/`MethodInfo`/... are
declared in the core and overridden by `std`; keep both layouts in sync.

### JIT and tiering

`djinnc prog.djinn --run --runtime-lib <lib>` executes `main` in process through ORC LLJIT (`driver/jit.djinn`); dead code
unreachable from `main` is dropped first. `--tiered` adds a three-tier JIT (`driver/tiering.djinn`, `runtime/tier.c`): tier 0
unoptimized with hit counters, tier 1 `-O1` with branch counters for hot functions, tier 2 `-O2` with `!prof branch_weights`.
Coroutines, variadics, struct-by-value functions and `main` stay in tier 0; no on-stack replacement; incompatible with `-g`.
Related tests: `tests/djinnc/tiering.sh`, `jit_panic.sh`.

### Libraries (`.djlib`)

`--library` builds a single file with object code plus the Djinn interface source, so macros, attributes, generics,
constexpr and reflection survive separate compilation; generics dedup across modules (`LinkOnceODR` + COMDAT). `djinn.proj`
(`library-mode`, `libs`, `sources`, `reflection-mode`, `native-libs`, `entry`, `test-libs`) describes projects. Inspect with
`djinnc --inspect-lib`.

### Async

`async`/`await`, `spawn`, `yield` on LLVM coroutines, scheduled by the C runtime (`runtime/scheduler.c`, thread pool, event
loop, `io_socket.c`). A sync function can still `await` (it runs the event loop). Planned, not implemented: async inferred by default with a `sync` opt-out and a postfix `.await`. Coroutine wrappers: `codegen/coro_wrappers.djinn`, `codegen/code_generator_coroutines.djinn`.

## Code Guidelines

- Generated code should be as simple as possible to be easily extensible later.
- Do NOT write line-by-line comments, unless explaining complex expressions (e.g. math) or something that only
  meaningful variable names could explain. Do NOT document code sections with comments.
- Run the tests related to every edit as soon as you make it, so a regression shows up in minutes. Prefer the
  narrowest run that covers the change: `--filter <suite or test name>` for the conformance runner, and
  `tests/djinnc/unit.sh` for `djinnc` unit tests, the dependency graph and the `djinn.proj` scripts.
- Before opening a pull request, run everything CI runs, in this order, and fix every failure first:
  1. the stages: build `djinnc` from stage0, then with itself, and confirm the fixpoint (`tests/djinnc/fixpoint.sh`:
     stage2 IR must equal stage3 IR);
  2. the complete conformance suite, including crash tests (`tests/conformance/ctest.sh <djinnc> --crash --jobs 8`);
  3. the unit tests (`tests/djinnc/unit.sh <djinnc> <runtime lib>`).
  On Windows run them from a Visual Studio developer prompt with `DJINN_USE_LLD=1`. A green filtered run is not
  enough: a change that passes its own tests can still break the compiler's own source (it compiles itself) or
  another suite, and CI runs the full set on Linux and Windows.
- A new feature or rule needs tests for it: new cases in `tests/conformance/src/suites/`, a script under
  `tests/djinnc/` when it involves `djinn.proj` or command-line options, and updates to every existing test whose
  expectation the change moves.
- A new language feature must be checked against the library system (`djinnc/LIBRARY.md`): decide whether a `.djlib`
  interface, object or loader needs to change for it (macros, operators, attributes, reflection, generics, interfaces,
  impls, enums, numbers, structs), and add a case to `tests/conformance/src/suites/library.djinn` when it crosses the
  library boundary. `std` is consumed as `std.djlib`, so a feature that only works from source breaks `--std`.
- A new language feature or a change to existing behavior must also update the documentation: the `docs` submodule (`docs/content/docs/`) gets the new or changed page in its own commit, and the pull request commits the updated submodule pointer. Do not leave the pointer stale.
- The compiler is `djinnc/`, written in Djinn. The C++ compiler (stage0) was removed; it stays available in the
  `stage0-final` tag. Every semantic or codegen error has its own diagnostic code (`DiagnosticErrors`).

## Build and test

Requirements: LLVM 21 with the C API (`LLVM-C.dll`/`libLLVM-C.so` on `PATH`), `clang`, Git Bash. A seed `djinnc`
(tag `stage0-final`, or any later `djinnc`) is always needed.

```bash
bash tools/build_runtime.sh --out build/runtime                       # runtime lib (djinn_runtime.lib / libdjinn_runtime.a)
djinnc djinnc -o build/stage2/djinnc --runtime-dir runtime            # build the compiler (a dir with djinn.proj is accepted)
bash tools/bootstrap.sh --seed <djinnc> --runtime-dir runtime [--runtime-lib <lib> --lld]   # seed->stage1->2->3, fixpoint, samples, bench
bash tests/djinnc/fixpoint.sh <stage1 djinnc> <runtime dir> [runtime lib]
```

Conformance suite (`ctest.sh` builds a seeded `djinnc`, then the runner, then runs it):

```bash
bash tests/conformance/ctest.sh <seed djinnc> --filter <suite or test name>
bash tests/conformance/ctest.sh <seed djinnc> --crash --jobs 8        # full run, as CI does
bash tests/conformance/ctest.sh <seed djinnc> --require Link --crash --library
```

With a runner already built (`tests/conformance/build.sh <djinnc> <runtime lib> <out>`):
`<runner> --compiler <abs djinnc> --runtime-lib <lib> --filter SamplesTests`.

Unit tests: `bash tests/djinnc/unit.sh <djinnc> <runtime lib>` (runs the `djinnc` and `libs/testing` projects plus the
scripts in `tests/djinnc/`). `djinnc test <dir>` builds and runs a project's `*_test.djinn` (`-- --filter ...` goes to the
test program, `--watch` reruns on change).

To add a conformance test, add a `[Test]` method to any struct in `tests/conformance/src/suites/`; it is found through
reflection, no registration. Source is inline (`Verify.source(src).runs(Expected.exit(3))`); error cases use
`.diagnostics(Expected.error(DiagnosticErrors.X).at(line, col))` and fail on any missing or extra diagnostic.

## Compiler architecture

- `djinnc/src/`: `Lexer -> Parser (AST) -> semantic (analyzer, symbols, types, checker, const_eval, range, async) ->
  CodeGenerator (LLVM-C) -> object via LLVMTargetMachineEmitToFile -> clang/lld + runtime`. Everything is in
  `namespace djinnc;`, one type per file. Big types (`Parser`, `CodeGenerator`, `TypeChecker`, `SemanticAnalyzer`) are
  split by topic with `impl` blocks: the struct lives in e.g. `codegen/code_generator.djinn` and each method group in its
  own `code_generator_*.djinn` (impl files must be named after the struct file so they sort after it).
- `driver/` holds options, project (`djinn.proj`), library (`.djlib`), linker, JIT, tiering, watch mode.
- `runtime/`: C runtime (scheduler, threads, coroutines, io, sockets, filesystem, diagnostics, int128). `--runtime-lib`
  links the prebuilt one instead of compiling the sources each time.
- `libs/testing`: the Djinn test framework (`[Test]`, producers, `--bench`, `--junit`, workflows). `djinn-lsp/`: language
  server. `tools/`: bootstrap, runtime/std builders, Compiler Explorer, VS Code extension.
- `docs/`: git submodule (Fumadocs site).
- CI (`.github/workflows/ci.yml`) runs bootstrap, conformance and unit tests on Linux and Windows with `DJINN_USE_LLD=1`.

## Standard Library

Files in `std/` (namespaces `std::<folder>`; consumed as `std.djlib`, built by `tools/build_std.sh`; roadmap in
`djinnc/STD_ROADMAP.md`). `import` makes a namespace visible; `struct size : u32;` is a type alias; the std's
`str`/`string`/`arr`/`object`/`TypeInfo` replace the core's when `--std` is used.

- `types/types.djinn` — core types (size, bool, str, immutable string with a static flag, `arr<T>`, `optional<T>`,
  `result<T,E>`, `TypeInfo`, `object`), primitive impl blocks (Hashable, constants), string operators;
  `types/text_hash.djinn` — word-at-a-time string hash
- `types/constraints.djinn` — interfaces (Hashable, Comparable, Equatable, Addition, Serializable, Disposable, Cloneable)
- `collections/` — `array<T>` (push, get, set, reserve, destroy), `map<Key, Value>` hash map, `range` (start, end, step,
  bounds; length(), contains(), is_empty()), `slice`, `sorting` (`Sorting.sort`/`binary_search` on `slice<T>`), `set`,
  `bag`, `stack`, `queue` (deque), `priority_queue` (4-ary min-heap), `ring_buffer`, `bitset`, `linked_list`; `array` and
  `map` take an optional `allocator`
- `memory/` — `arena` (bump allocator with `mark`/`reset_to`/`reset`, blocks from `__djinn_alloc`), `pool`, `allocator`
  (heap, arena or pool handle), `owner<T>`, `shared<T>` (atomic refcount)
- `text/` — `string_builder`, `Text` (join, number to text, utf-8), `Numbers`, `Chars`, `str`/`string` methods (`split`,
  `replace`, `repeat`, `toUpper`, `parseI64`, `utf8At`, ...), `interner`/`symbol` (scoped or `interner.shared`)
- `encoding/` — `byte_buffer`, `Hex`, `Base64`; `hashing/` — `Hash` (FNV-1a, xxHash64, SHA-256)
- `format/` — `csv_reader`/`csv_writer`, `toml_reader` (streaming)
- `filesystem/` — validated `Path`, `Directory` capability, `File`, `FsError`; `std::filesystem::native` is the unsafe
  layer (see `std/filesystem/README.md`)
- `sys/` — `console`, `io`, `debug` (assertions), `libc` (FFI: malloc, free, printf, memcpy, ...), `atomic`, `intrinsics`,
  `math`/`math_native` (`Math.sqrt`, ... foldable at compile time), `process`, `system` (panic hooks), `task`, `logger`,
  `spectre` (terminal UI: tables, trees, spinners)
- `net/socket.djinn` — async sockets; `util/` — `json` (document reader over the runtime parser), `version`
- `builtin/coro.djinn` — coroutine utilities
