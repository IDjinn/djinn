# Changelog

## [Unreleased]

### Added
- Closures: `fn(A, B) -> R` types, `(a, b) => expr` and `(i32 a) => { ... }` lambdas with captures (copied or moved, read-only inside), calls through locals, fields and expressions, function names as `fn` values, and `.djlib` support. New errors E3064 (assigning a captured variable), E3065 (moving a captured value) and E3066 (untyped lambda parameter without an expected type).
- Macros: `name!{...}` and `name![...]` delimiters, statement and declaration macros, `block`, `statement`, `tokens` and variadic (`expression... xs` with `$for`) fragments, bound `type` parameters, hygienic template locals, generic arguments with commas, trailing commas, `ns::name!(...)` calls, and warning W6006 when a function shares the name of a visible `name(...)` macro.

- Procedural macros: `proc macro name => handler;` and `proc attribute Name => handler;` with the `std::meta` token API (`Token`, `TokenStream`); a program that imports the library runs them while it is parsed.
- `libs/ui` and `libs/ui_macros`: the UI library (reactive core with signals, memos and effects, retained tree, `html!` markup with components, `if`/`for` regions and keyed lists, render modes declared with `[Application(render: ...)]`, `[Server]`, `[Client]` and `[Static]`, an HTML writer that escapes and sanitizes every value, and a test host that logs tree operations), with `examples/ui-showcase` and `tests/djinnc/ui.sh`.
- UI CSS engine (`libs/ui/src/style`): tokenizer, nesting, `@layer`, `@media`, `@property`, selectors with `:is()`/`:where()`/`:not()` and states, cascade with layers and `!important`, custom properties, `calc()`, `oklch()`/`color-mix()` colors; and a default light/dark theme (`Theme.set`, `--ui-*` variables) applied out of the box. `App.run` writes a full themed page.
- UI layout engine (`libs/ui/src/layout`): block and inline flow, flexbox (grow, shrink, wrap, gaps, alignment, auto margins, automatic minimum), grid (`fr`, `minmax()`, `repeat(auto-fit, ...)`, spans, auto-placement, track sizing), absolute, fixed and relative positioning. `Layout.compute(root, width, height)` caches per box and input, so a change lays out again only the boxes around it.
- UI paint, text and native host: display list and software rasterizer (`libs/ui/src/paint`), glyph atlas with GDI fonts (`libs/ui/src/text`), `libs/win32` (window, message pump, mouse and key events to DOM events), `libs/vulkan` (Vulkan renderer, opt-in with `DJINN_UI_GPU=1`, software fallback) and `libs/spirv` (`spirv!{...}` compile-time SPIR-V assembler macro used for the shaders). `examples/ui-native` is the client-mode showcase and `examples/ui-bench` the speed, memory and CPU benchmark.
- Installers: optional components (UI libraries, Vulkan renderer) in the Windows wizard, `install.ps1` (`-Ui`, `-Vulkan`) and `install.sh` (`--ui`, `--vulkan`); the picks are kept in `.components` so updates repeat them.
- UI styles: `@supports` evaluated for real, `light-dark()` and system colors following `color-scheme`, logical properties, viewport units (`dvh`, `vi`, `vmin`, ...), `outline`, `overflow-wrap`, grid, inset, `order` and `aspect-ratio` properties, the media features `pointer`, `prefers-contrast` and `forced-colors`, and the host environment setters (`Styles.set_text_scale`, `set_coarse_pointer`, `set_more_contrast`, `set_forced_colors`). A change in the tree now restyles only the node, its subtree and its siblings.
- UI default theme rewritten after the Chrome team's modern web guidance: tokens joined with `light-dark()` (with a fallback), cascade layers with `:where()` selectors, rem sizes with the root font size left to the user, fluid headings and gutters, touch-sized targets, outline focus rings, more-contrast and forced-colors support, and the responsive layout classes `.page`, `.stack`, `.cluster`, `.tiles` and `.split`.
- `std::text::Utf8`: strict UTF-8 validation (`sequence_length`, `is_valid`, `first_invalid`, `sanitize`) with an ASCII fast path.

### Fixed
- A function from a `.djlib` owned its `Value` parameters but callers treated it as borrowing them (like an `extern` function) and disposed them again after the call: closures and strings passed to library functions were freed twice.
- Instances of the closure templates (`__closureN<...>`) used by a library were left out of its object, so a program that did not use the same `fn` types failed to link.
- A `[Platform]` declaration that was left out dropped every declaration a macro expansion had queued before it, so a procedural attribute that emitted one item per platform lost them all.
- A lambda passed to an overloaded call is checked once per candidate; only the instance the code creates is emitted now (the others referenced locals of other functions), and lambdas are no longer listed as methods by reflection.
- A string literal passed to a generic parameter infers `str` instead of `i8*`.
- `str.isValidUtf8()` accepted overlong forms, UTF-16 surrogates and bytes past U+10FFFF.
- A library built against the source std (`--std --std-dir`) no longer defines the std globals again, which made linking it with a program fail with duplicate symbols.
- Declarations produced by a macro belong to the file of the call (imports, library interface, dependency stripping), not to the file of the macro template.

- Platform-specific code: `[Platform(windows, web, desktop, ...)]` on declarations and struct members, and `name.<platform>.djinn` files that replace `name.djinn` for the target; `Platform.Android`, `Platform.Ios`, `Platform.Web`, `Platform.Desktop` and `Platform.Mobile` constants.

### Changed
- Macros are token templates expanded and re-parsed (they were AST substitutions): every macro is collected before parsing, so a macro can be used before it is declared or from another file. Macros belong to their namespace and are visible only from it and from files that import it, so a user `log` macro no longer rewrites `log(...)` calls inside `std`. Parse errors inside an expansion are reported at the call.
- An installed `djinnc` now finds `runtime/`, `std/` and the prebuilt runtime library (`lib/`) next to its own `bin/` directory, so `--runtime-dir`, `--std-dir` and `--runtime-lib` are no longer needed. Explicit flags, `DJINN_STD_DIR` and a `runtime/core` in the current directory still take precedence.

## [0.5.2] - 2026-11-14

### Fixed

- `djinnc --version` printed a hardcoded `0.1`; it now prints the release version, which the release workflow stamps from the tag (the VS Code extension version too).

## [0.5.1] - 2026-11-14

### Added
- Installers (`installer/install.sh`, `installer/install.ps1`) with optional VS Code extension, cron or scheduled-task auto update, and versioned installs; releases now ship `djinn-lsp` and `djinn-lang.vsix`.
- Windows setup wizard (`installer/windows/djinn.iss`, Inno Setup) with extension, auto update and PATH checkboxes and an uninstaller entry.
- VS Code extension: uses the installed toolchain, offers to install it, `Djinn: Install Toolchain` and `Djinn: Update Toolchain`.

- `djinnc --help` prints grouped sections with examples (`-h` and `help` too); `djinnc interactive` asks what to do (build, check, run, test, IR) and runs the matching command; a bad command line prints a short usage.

### Changed
- Language server: `name!()` macros and same-named functions no longer share references, and files matched by the workspace `.gitignore` (such as `.claude/worktrees`) are not indexed.
- Highlighting: generic arguments and `TKey`-style type parameters are typed, `name!()` macros are coloured, `this.field` is distinct from parameters, `operator` is a keyword.

## [0.5.0] - 2026-11-14

### Compiler

- Compile-time evaluation (`constexpr`/`consteval`) has a compile-time heap (`__djinn_alloc`, `realloc`, `free`, `memcpy`, `memset` marked by `[ConstAlloc]`, `[ConstRealloc]`, `[ConstFree]`, `[ConstMemCopy]`, `[ConstMemSet]`), pointers with bounds checks, structs with fields, constexpr constructors, methods, `disposable()` at scope exit and user-defined struct operators.
- `constexpr struct Name { }` makes every method, constructor and operator of the struct constexpr; the std collections use it, so `array<T>` and `map<K,V>` evaluate at compile time and match run time (issue #111).
- Evaluation limits with their own E3051 reasons (4 MiB heap, 4096 blocks, 16 MiB of struct cells, 1,000,000 steps, 2 s) and a call trace on failures. 128-bit integers are rejected explicitly.
- Struct constants keep constexpr constructor and operator bodies in `.djlib` interfaces.

- Runtime configuration: `--async-threads=N`, `[Runtime(threads = N)]` on `main` and `async-threads: N` in `djinn.proj` (in that order of precedence, default 0 = logical cores; the pool workers themselves start only when coroutines are scheduled onto them, see ASYNC_MODEL.md); at run time `DJINN_THREADS` and `threads=N` in `runtime.properties` override the compiled value.
- `sync` function modifier: `await` is rejected inside it (E3061). Postfix `task.sync` is a blocking wait, with warning E6005 inside async functions.
- A `sync main` in a program with no async function left after elision starts no runtime (no `__djinn_runtime_init`/shutdown).
- `private` is now enforced (E3062): a private function or method is callable within its own namespace, or from methods of the same type; from another namespace it is an error. `public` stays the default.
- Error E3063: a `public` function that blocks on a task or holds an async call without awaiting must declare `async` or `sync`.
- A `sync main` starts no runtime unless async work is reachable from it (spawn, `.sync`, a remaining coroutine); unreachable async functions no longer keep it.
- The runtime no longer starts idle worker threads (nothing schedules onto the pool yet); the thread setting is still resolved, `0` means the logical core count and is the new default.
- Runtime: `Task.delay` uses a timer and the event loop sleeps when nothing is runnable (no more busy yield loop).
- A function that uses `await` is async without writing `async` (not `sync` ones, where it stays E3061, and not `main`, which keeps its signature). Its callers now get a `task<T>` and must `await` it; the body stays in the `.djlib` interface so consumers see the task signature.

### Standard library

- New `bitfield<T>`: up to 1024 flags, no heap, constexpr compatible, with comparison operators, `hash`, set algebra and `next_set` iteration.

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
