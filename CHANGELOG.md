# Changelog

## [Unreleased]

### Compiler

- Runtime configuration: `--async-threads=N`, `[Runtime(threads = N)]` on `main` and `async-threads: N` in `djinn.proj` (in that order of precedence, default 0 = logical cores; the pool workers themselves start only when coroutines are scheduled onto them, see ASYNC_MODEL.md); at run time `DJINN_THREADS` and `threads=N` in `runtime.properties` override the compiled value.
- `sync` function modifier: `await` is rejected inside it (E3061). Postfix `task.sync` is a blocking wait, with warning E6005 inside async functions.
- A `sync main` in a program with no async function left after elision starts no runtime (no `__djinn_runtime_init`/shutdown).
- `private` is now enforced (E3062): a private function or method is callable within its own namespace, or from methods of the same type; from another namespace it is an error. `public` stays the default.
- Warning E6006: a `public` function that blocks on a task or holds an async call without awaiting must declare `async` or `sync`.
- A `sync main` starts no runtime unless async work is reachable from it (spawn, `.sync`, a remaining coroutine); unreachable async functions no longer keep it.
- The runtime no longer starts idle worker threads (nothing schedules onto the pool yet); the thread setting is still resolved, `0` means the logical core count and is the new default.
- A function that uses `await` is async without writing `async` (not `sync` ones, where it stays E3061, and not `main`, which keeps its signature). Its callers now get a `task<T>` and must `await` it; the body stays in the `.djlib` interface so consumers see the task signature.

## [0.4.0] - 2026-11-13

### Standard library

- `map`: one allocation for keys, values and states, power-of-two mask instead of `%`, mixed `Hashable` hash, tombstones counted in the load factor, `hash()` independent of insertion order, `keys()`, `values()`, `clear()`. Sequential lookups no longer degrade to a quadratic scan.
- `array`: `pop`, `insert`, `remove_at`, `swap_remove`, `clear`, `index_of`, `contains`, `reverse`, `first`, `last`, `get[]`; `reserve` never shrinks; no `malloc(0)`; OOM-checked allocation; wrapping loop counters; `hash()` no longer overflows.
- New collections: `slice`, `Sorting` (`sort`, `binary_search`, `is_sorted`), `set`, `bag`, `stack`, `queue` (deque), `priority_queue` (4-ary heap), `ring_buffer`, `bitset`, `linked_list`.
- Memory: `arena`, `pool` and `allocator` (heap, arena or pool); `array` and `map` accept an allocator.
- Text: `string_builder`, `Text`, `Numbers`, `Chars` and `str`/`string` methods (`split`, `replace`, `repeat`, `toUpper`, `toLower`, `count`, `parseI64`, `parseU64`, `parseHex`, `parseF64`, UTF-8 helpers).
- Encoding and formats: `byte_buffer`, `Hex`, `Base64`, `Hash` (FNV-1a, xxHash64, SHA-256), streaming `csv_reader`/`csv_writer` and `toml_reader`.

### Tooling

- Conformance: `std_library.djinn` and new `std.djinn` cases for the collections, text, encoding and hashing modules.

## [0.3.0] - 2026-11-12

### Compiler

- Async: recursive cycles of async functions that never suspend and only tail-call each other (`return await g(...)`) compile to `musttail` calls and run in constant stack.
- Tiered JIT forward stubs use `musttail` for register-sized signatures and fall back to a plain tail hint otherwise, avoiding a backend abort on `sret` returns.
- Functions proven to terminate (no loop, recursion, suspension or hidden call) are marked `mustprogress`; `willreturn` is never implied.

### Tooling

- Conformance runner and tests: async tail-recursion, IR and `tests/djinnc/async_elision.sh` / `tiering.sh` coverage.

## [0.2.0] - 2026-11-12

### Language

- `char` type with Unicode literals, `\uXXXX`/`\UXXXXXXXX` escapes, UTF-8 interpolation and `str` overloads.
- Nullable values and pointers: `null`, `== null`, `??`, `??=`, `!.`, `?.` and implicit wrapping.
- Destructuring (`auto { a, b } = expr`), `for (a..b)` without a loop variable, `const` locals, `$"""` blocks, error switch arms catching several types.
- Ownership: `Trivial`/`Value`, `Disposable`, `Cloneable`, `owner<T>`, `shared<T>`, owned `string`, borrowed views; arguments move into the callee.
- Compile-time text: constexpr `str`/`string`, folded interpolation and formatters, stack text builder.
- Intrinsics: `alignof`, `sizeof(expr)`, `typeof(variable)`, `expect`, ABI, endianness, CPU features and platforms; function addresses and `System.hook`.
- `nint` overflow-mode suffixes, static methods on primitive types, qualified types, `Align` on functions.
- Async functions that never suspend compile as plain functions (warning E6004, `--no-async-elision`).

### Compiler

- Range analysis drops proven-safe overflow, division, shift and bounds checks; `--verify-ranges`.
- Faster `--run` startup, tiered JIT and LLVM/driver optimizations; fewer heap allocations in async, allocation and formatting.
- `--std` links a prebuilt `std.djlib`; array literals that do not escape live on the stack.
- Standardized runtime errors and bound-checked `str`/`string` indexers.
- The legacy C++ compiler (stage0) and its LSP were removed.

### Standard library

- `std::filesystem`: capability-based, async by default (`_sync` variants), native IOCP and io_uring.
- `std::math`: type-safe `Math`, constexpr libm folding, bit-based NaN/infinity.
- String and array QoL, `atomic<T>`.

### Tooling

- `djinn-lsp` suggestions, library discovery and `--std` checking of test files.
- CI takes the seed from the `v0.2.0-seed.1` release.

## [0.1.1] - 2026-11-08

- Windows x86_64 package (`djinn-<tag>-windows-x86_64.zip` with `LLVM-C.dll`) in the release workflow.
- Windows job in CI: bootstrap, fixpoint, samples and the full conformance suite.

## [0.1.0] - 2026-11-08

First release of the self-hosted `djinnc` compiler, built from the `stage0-final` seed. Linux x86_64 only.

### Compiler

- Seed-based bootstrap: seed, stage1, stage2, stage3 with a fixpoint check; the C++ compiler is no longer part of the build.
- Every semantic and codegen error has its own diagnostic code, with token length and arguments; `--diagnostics-format=json`, `--check` and typed attribute payloads.
- Diagnostics are reported once, report where they end (`Expected.at_range`) and resolve attribute constants in their namespace.
- `T*` is non-null and `T*?` is the nullable pointer; sources that hold `null` are declared nullable.
- Implicit conversions between values of the wrong kind are rejected, and undefined arithmetic is reported.
- Integer constants are masked to their width, and namespaces are shared across files.
- `djinn.proj` can list libraries and extra sources; overload names survive in declarations read from a library.
- `--run` (JIT) works with the prebuilt runtime on Windows and on Linux.
- `uwtable` is emitted so crashes can unwind.

### Runtime and standard library

- Runtime split into modules, with child processes (`Process.start`, `Process.wait_async`), `Task.delay` and `Json` (vendored yyjson 0.13.0 behind a small C wrapper).
- Every runtime panic ends with a stack trace; the crash handler prints the faulting address, module and access type.
- Signed division overflow and signed remainder by -1 are reported instead of trapping.
- 128-bit division and float conversion helpers in the runtime.

### Native test system

- Three projects: `libs/testing`, `djinnc/testing` and `tests/conformance`.
- `[Test]` methods are discovered through reflection with inline sources; `djinnc test` runs them, async tests included.
- Test data graph with typed bindings, `From`, validation, component workers and blocked results.
- Fluent test plan (`typeof(Struct.method)`), workflows, shared nodes, `--workflow`, `--graph dot/json`.
- `[Mutates]`, `Artifact`, `Skip`, `Resource`, `Teardown`, `Case`, junit output, seed, bench, per-node timeout, `--tag`, `--fail-fast` and `test --watch`.
- `TestPolicy` for per-test retry and timeout.
- The C++ tests are frozen; new tests are written in Djinn under `tests/conformance`.

### Tooling

- GitHub Actions CI on Ubuntu 24.04 with LLVM 21: bootstrap, conformance, link/crash/library conformance and the djinnc unit tests.
- Release workflow: pushing a `v*` tag bootstraps the compiler and publishes a `linux-x86_64` tarball with its SHA256.
- VS Code extension with Djinn syntax highlighting.

### Fixed on Linux

- The JIT could not load the runtime (`__ehdr_start` unresolved).
- Native stack traces were empty with `--lld` because `ld.lld` was called without `--eh-frame-hdr`.
- `Process.run` returned the raw `system()` wait status, so a child's exit code was lost.
- The conformance runner compares exit codes modulo 256 outside Windows.

[0.1.0]: https://github.com/IDjinn/djinn-lang-v3/releases/tag/v0.1.0

[0.1.1]: https://github.com/IDjinn/djinn-lang-v3/releases/tag/v0.1.1
