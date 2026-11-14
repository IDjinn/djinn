
# Djinn Lang

## Philosophy

Djinn is a compiled language that uses LLVM IR as its backend with a C runtime. Strongly inspired by C, C++ and C#,
the main focus is a language with great Developer Experience, simplicity, and high performance.

The compiler generates async code by default.

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
  `stage0-final` tag. Every semantic or codegen error has its own diagnostic code.

## Standard Library

Files in `std/` directory

- `types/types.djinn` — core types (size, bool, str, immutable string with a static flag, arr\<T\>, optional\<T\>, result\<T,E\>, TypeInfo, object),
  primitive impl blocks (Hashable, constants), string operators
- `types/constraints.djinn` — interfaces (Hashable, Comparable, Equatable, Addition, Serializable)
- `collections/array.djinn` — generic `array<T>` with push, get, set, reserve, destroy
- `collections/map.djinn` — generic `map<Key, Value>` hash map
- `collections/` also: `slice`, `sorting` (`Sorting.sort`/`binary_search` on `slice<T>`), `set`, `bag`, `stack`, `queue` (deque),
  `priority_queue` (4-ary min-heap), `ring_buffer`, `bitset`, `linked_list`; `array` and `map` take an optional `allocator`
- `memory/` also: `arena`, `pool`, `allocator` (heap, arena or pool handle)
- `text/` — `string_builder`, `Text` (join, number to text, utf-8), `Numbers`, `Chars`, `str`/`string` methods
  (`split`, `replace`, `repeat`, `toUpper`, `parseI64`, `utf8At`, ...) and `interner`/`symbol` (scoped or `interner.shared`)
- `encoding/` — `byte_buffer`, `Hex`, `Base64`; `hashing/` — `Hash` (FNV-1a, xxHash64, SHA-256)
- `format/` — `csv_reader`/`csv_writer`, `toml_reader` (streaming)
- `collections/range.djinn` — `range` struct (start, end, step, bounds) with length(), contains(), is_empty()
- `sys/console.djinn`, `sys/io.djinn`, `sys/debug.djinn` — I/O, assertions
- `sys/libc.djinn` — FFI bindings (malloc, free, printf, memcpy, etc.)
- `memory/arena.djinn` — `std::memory::arena`: bump allocator with `mark`/`reset_to`/`reset`, blocks from `__djinn_alloc`
- `filesystem/` — `std::filesystem`: validated `Path`, `Directory` capability, `File`, `FsError`; `std::filesystem::native` for
  the unsafe layer (see `std/filesystem/README.md`)
- `builtin/coro.djinn` — coroutine utilities