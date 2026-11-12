# Changelog

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
