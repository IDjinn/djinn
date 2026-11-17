# Using djinnc (self-hosted compiler)

`djinnc` is the Djinn compiler written in Djinn. A seed `djinnc` (release `stage0-final`) builds it; the result is
*stage1*. Stage1 can build `djinnc/` again (*stage2*), and stage2 builds it once more (*stage3*). The bootstrap is
correct when the IR of stage2 and stage3 is identical (fixpoint).

```
seed          --compiles-->  djinnc/  =>  stage1
stage1        --compiles-->  djinnc/  =>  stage2
stage2        --compiles-->  djinnc/  =>  stage3     stage2.ll == stage3.ll
```

## Requirements

- A seed `djinnc` (the `stage0-final` release, or any later `djinnc`) to build the compiler; `tools/bootstrap.sh --seed <djinnc>` does the whole chain.
- LLVM 21 with the C API shared library (`LLVM-C.dll` / `libLLVM-C.so`). `native-libs` in
  [djinn.proj](djinn.proj) points to the local install; adjust `-L...` to your machine.
- `clang` on `PATH` (or `DJINN_CLANG`), used to link. Windows: the clang that ships with Visual Studio is enough.
- `LLVM-C.dll` (or the `.so`) must be on `PATH` / `LD_LIBRARY_PATH` when running a djinnc executable.
- For `--lld` on Windows: `lld-link` and the MSVC/SDK library paths (run from a Visual Studio developer shell so `LIB`
  is set).
- Bash (Git Bash on Windows) for the test and bootstrap scripts.

## 1. Build stage1

From the repository root:

```bash
djinn -r djinnc
```

`-r` makes the directory scan recursive. The executable is written to `djinnc/build/djinnc` (`.exe` on Windows),
as set by `output` in `djinn.proj`. Running it with no arguments prints the usage and exits with 2; that is expected.

## 2. Compile a program

```bash
djinnc hello.djinn -o hello --runtime-dir runtime
./hello
```

A directory containing a `djinn.proj` is also accepted; djinnc reads the sources, the output path and `native-libs`
from it:

```bash
djinnc djinnc -o build/stage2/djinnc --runtime-dir runtime
```

Several `.djinn` files can be passed at once; they share types and namespaces and are processed in sorted order, so
the output is deterministic.

The runtime (the `.c` files in `runtime/`) is compiled together with the program unless you pass a prebuilt library.
`--runtime-dir` is the directory that holds those two files (normally the repository `runtime/` directory).

## Options

| Option | Effect |
|---|---|
| `-o <path>` | Output executable (default `a.out`). |
| `--runtime-dir <dir>` | Directory with the runtime `.c` sources (default `runtime`; an installed djinnc uses `<install>/runtime` unless the current directory has its own `runtime/core`). The std directory and the prebuilt runtime library (`<install>/std`, `<install>/lib`) are found the same way. |
| `--runtime-lib <lib>` | Link a prebuilt runtime instead of recompiling it (built by `tools/build_runtime.sh`). |
| `--link-arg <arg>` | Extra linker argument; repeatable. |
| `-O0`, `-O1`, `-O2`, `-O3`, `-Os`, `-Oz` | Optimization level: runs `default<ON>` through `LLVMRunPasses` and sets the backend codegen level. Without it the pipeline is `default<O0>`. |
| `--lld` | Call the linker directly: `lld-link` on Windows, `ld.lld` on POSIX. Needs `--runtime-lib`. |
| `--cpu <name\|native>` / `--features <+a,-b>` | Target CPU and feature list for code generation (default `generic`); `native` uses the host CPU and its features. |
| `--lib-dir <dir>` | Where `libs:` in `djinn.proj` finds each `<name>.djlib` (default `build/libs`). |
| `--inspect-lib <file>` | Print a `.djlib` header, sections, integrity and interface. |
| `--sections-only` | With `--inspect-lib`: only the header and the section sizes, no interface dump. |
| `--std` / `--std-dir <dir>` | Compile the `std/` library too (also `libs: ['std']` in `djinn.proj`, or `DJINN_STD_DIR`); see [STD_ROADMAP.md](STD_ROADMAP.md). |
| `--target <triple>` | Target triple (default: the host). x86 and x86_64 build objects and executables; `--target web` compiles the program to JavaScript, see [The web target](#the-web-target); `--target wasm` (`wasm32-unknown-unknown`) builds a WebAssembly module, see [WebAssembly](#webassembly); other triples only support `--emit-ir`. While cross-compiling, procedural macros still run on the host, a library is looked up in `<lib-dir>/<triple>/` first, and a library built for the host only lends its macros (see LIBRARY.md). |
| `--tiered`, `--tier-threshold=<n>`, `--tier-settle=<ms>` | With `--run`: tiered JIT with three tiers. Tier 0 is unoptimized code that only counts how many times each function is entered and each loop iterates. A function that reaches `n` hits (default 1000) is promoted once no new function has started running for `ms` milliseconds (default 100, at most about one second of waiting): a background thread recompiles just the hot functions at `-O1` with a counter on every conditional branch (tier 1). When a tier-1 function has seen `4n` branch events it is recompiled again at `-O2` (or the `-O` level given) with `!prof branch_weights` from those counters (tier 2). Every function forwards to its newest version, and the program runs the whole time. There is no on-stack replacement, so a loop already running in an older tier stays there until its function is called again; coroutines, variadic functions, functions taking structs by value and `main` always stay in tier 0. Needs the runtime library built by `tools/build_runtime.sh` (it ships `tier.o`) and does not support `-g`. The JIT uses the large code model in this mode. |
| `--run` | Run `main` in process through ORC LLJIT (`driver/jit.djinn`) instead of writing an object and linking. Needs `--runtime-lib` and the host target; the exit code of `main` is the exit code of djinnc. The JIT backend uses the code generation level of `-O` (none by default, so startup stays fast), and without a resident `.djlib` everything the program cannot reach from `main` is dropped before compiling. |
| `--no-link` | Stop after generating code; writes `<output>.ll`. |
| `--emit-ir` / `--keep-ir` | Write `<output>.ll` (IR). `--keep-ir` also links. |
| `--emit-asm` | Write the assembly to `-o` and stop. |
| `--show-async` | In the view modes, also show the compiler-generated async infrastructure (the entry `main` that starts the runtime and event loop, and the `__djinn_coro_*` wrappers). Hidden by default. |
| `--async-threads=<n>` | Worker threads the compiled program starts with (default 0: the logical core count). At run time `DJINN_THREADS` and `threads=<n>` in `runtime.properties` override it. `[Runtime(threads = n)]` on `main` and `async-threads: n` in the `compiler:` section of `djinn.proj` set the compiled value too; precedence: this flag, then the attribute, then `djinn.proj`, then 0 (auto). See `djinnc/ASYNC_MODEL.md`. |
| `--strict-externs` | An `extern` is visible only in the file that declares it. `internal extern` shares it with the files of the same namespace and `public extern` with every file. Off by default. |
| `--no-async-elision` | Keep every `async` function a coroutine. By default an async function that can never suspend is compiled as a plain function and reported with warning `E6004` (see `djinnc/SUBSET.md`). |
| `--emit-ast` | Print the AST (with `<line:col>`) to stdout and stop. |
| `--version` | Print the compiler version. |

`--emit-ir`, `--emit-asm` and `--emit-ast` are view modes: they show only the files given as inputs. The runtime (`runtime/core/`) and the std loaded by `--std` are dependencies, so their functions are not emitted (only declarations when referenced) and their declarations are not dumped; pass a std file as an input to see it. `--keep-ir`, `--no-link` and linked builds keep everything.
| `--emit-tokens` / `--emit-ast` | Dump the token list or the AST and exit. |
| `--stats` | Print files, tokens, AST nodes and arena usage, plus a `PerformanceMonitor` lap per phase (lex, parse, codegen, write-ir, object, link) and the total, in ms. |
| `test <dir> [options] [-- args]` | Build the project in `<dir>` with its `*_test.djinn` files (and `test-libs:` from `djinn.proj`), reflection on, then run the result. `--watch` reruns the build and the tests whenever a project file changes (`--watch-runs <n>` stops after n runs). Everything after `--` goes to the test program (`--filter`, `--tag`, `--workflow`, `--graph`, `--graph-file`, `--junit`, `--seed`, `--bench`, `--bench-out`, `--bench-ref`, `--bench-tolerance`, `--fail-fast`, `--jobs`, `--report`, `--list`). Without a `main` in the test files, the driver generates one that runs the tests; `entry:` in `djinn.proj` names the normal `main` file to leave out. The exit code is the test program's. |
| Platform files | In a project (and the std and core), `name.<platform>.djinn` replaces `name.djinn` for the target: `windows`, `linux`, `macos`, `android`, `ios`, `web`, then the groups `desktop` / `mobile`, then `native`. Variants for other platforms are left out (`--target` picks the platform). |
| `--tests` | Include `*_test.djinn` in a project build without running anything. Normal builds skip those files. |

Objects are emitted directly through LLVM-C (`LLVMTargetMachineEmitToFile`); the x86 target is always initialized and WebAssembly when it is the target, so the LLVM-C library djinnc links needs both (the official LLVM 21 release has every target).

### The web target

`djinnc app.djinn --target web -o public/app` (or a project directory) compiles the program to one JavaScript file,
`public/app.js`, loaded by a plain `<script src="app.js" defer>`. There is no WebAssembly and no runtime to download:
after the type checker, the JavaScript emitter (`codegen/js`) walks the typed tree and writes only what `main`
reaches, in front of which it inlines the small runtime (`runtime/js/djinn.js`) and the `.js` files of the bindings
the program uses.

- A function is a plain JS function (`Point.sum` becomes `app$Point$sum(self)`), a struct value an object literal with
  every field in declaration order (one shape per struct), a `fn` value a JS closure, `str` and `string` JS strings,
  `arr` and `slice` JS arrays, an enum its tag. A struct with a `mut` field is copied when it is stored, as Djinn copies
  struct values; one of immutable fields is shared, since nobody can tell.
- Integers are JS numbers. Checked arithmetic (no suffix) stops on overflow like the native build, `w` wraps (`| 0`,
  `>>> 0`) and `s` saturates; 64-bit integers are exact up to 2^53, and checked 64-bit arithmetic stops beyond that.
- Libraries become bindings: `std` is `runtime/js/std` and a library `name` with a `libs/<name>/js` folder (`ui`) is
  replaced by the Djinn sources and `.js` files there (`shared.txt` lists sources of the library itself that need
  nothing native, compiled as they are). A library without one still runs its procedural macros on the host
  (`ui_macros`).
- `[Js("template")]` on a function or method makes every call the template, with `$this` for the receiver, `$0`, `$1`,
  ... for the arguments and `$*` for all of them; the function itself is never emitted. That is how a binding reaches
  the browser with no wrapper in between: `[Js("$read($this)")] public T get()` makes `count.get()` the call
  `$read(count)`.
- Not supported yet (a `WEB_NOT_SUPPORTED` diagnostic says so): pointers and `unsafe` memory, `async`, `throws`, enum
  payloads, variadic packing outside `[Js]` bindings.
- The platform is `web`, so `name.web.djinn` files and `[Platform(web)]` apply, and `Platform.Web` is true.

### WebAssembly

`djinnc app.djinn --target wasm -o public/app.wasm` (or a project directory) builds a freestanding WebAssembly module
(wasm32, no WASI) and copies `djinn.js`, the host that loads it, next to it. `wasm-ld` links it with the web runtime,
`runtime/web/web_runtime.c`, which `clang --target=wasm32-unknown-unknown` compiles on each link unless
`DJINN_WEB_RUNTIME_LIB` names a prebuilt one. Run it in a page with
`<script type="module" src="djinn.js" data-wasm="app.wasm"></script>`, or under Node.js with `node tests/web/run.mjs
app.wasm`.

- The runtime has the allocator, the libc functions Djinn declares (with 64-bit sizes, as on the desktop), `printf`,
  math (from JavaScript's `Math`), JSON, the logger and a single-threaded event loop that never blocks: `Task.delay`
  sets a browser timer, and an `async main` returns at once and reports its exit code when it finishes. Files,
  processes, sockets and threads fail as error values.
- A synchronous wait (`.sync`, or a sync function that awaits) works only while nothing waits for a timer; otherwise it
  fails with a runtime error. Make the caller async.
- `extern "mod" { ... }` imports its functions from the WebAssembly module `mod` (`extern "C"` and plain `extern` stay
  C functions); `[Export("name")]` exports a function under that name. Both mean nothing on other targets.
- `libs/ui` builds for the web too: the page is the real DOM (see libs/ui/README.md).

### Environment variables

| Variable | Effect |
|---|---|
| `DJINN_CLANG` | clang executable used to link (default `clang`). |
| `DJINN_LLD_LINK` | `lld-link` executable (Windows `--lld`). |
| `DJINN_LD_LLD` | `ld.lld` executable (POSIX `--lld`). |
| `DJINN_CRT_DIR` | Directory with `crt1.o`, `crti.o`, `crtn.o` (POSIX `--lld`, default `/usr/lib/x86_64-linux-gnu`). |
| `DJINN_DYNAMIC_LINKER` | Dynamic loader (POSIX `--lld`, default `/lib64/ld-linux-x86-64.so.2`). |
| `DJINN_USE_LLD` | Test scripts only: when set, they add `--lld` if a runtime library is given. |
| `DJINN_WASM_LD` | `wasm-ld` executable (`--target wasm`, default `wasm-ld`). |
| `DJINN_WEB_RUNTIME_LIB` | A prebuilt web runtime (`libdjinn_runtime.a` for wasm32) instead of compiling `runtime/web` on each link. |

### Linking with a prebuilt runtime and lld

`--runtime-lib` needs a release (non-ASan) build of the runtime. Build it with the script:

```bash
bash tools/build_runtime.sh --out build/runtime
djinnc program.djinn -o program --runtime-lib build/runtime/djinn_runtime.lib --lld
```

On Windows, with `--lld`, the `-L<dir>` and `-l<name>` entries of `native-libs` are translated to `/libpath:<dir>` and
`<name>.lib`. The POSIX `ld.lld` path has not been exercised yet.

## Language subset

djinnc only compiles the subset described in [SUBSET.md](SUBSET.md): functions, `extern` blocks, structs with
methods and `this`, namespaces, pointers, `static`/`const`, `??` on pointers and the usual control flow. Generics,
enums, `switch`, interfaces, async, exceptions and string interpolation are not supported yet.

## Testing

### Unit tests

```bash
djinnc test djinnc
djinnc test libs/testing
```

A `[Test]` that takes a parameter receives the value returned by the `[Test]` of that type; `[From("name")]` picks one when there are several. Tests linked this way run in one worker, a failure blocks the ones below it, and `--list` rejects missing producers, ambiguity and cycles (see `tests/graph`).

The unit tests live next to the code in `*_test.djinn` (arena, atoms, `U32Map`). `tests/djinnc/unit.sh <djinnc> <runtime lib>` runs both projects.

### Samples and error cases

The conformance runner holds these tests, with the source inline in `tests/conformance/src/suites/samples.djinn` and
`errors.djinn`. Build it and run it from the repository root:

```bash
DJINN_USE_LLD=1 bash tests/conformance/build.sh <djinnc> <runtime lib> build/runner
build/runner --compiler <absolute djinnc> --runtime-lib <runtime lib> --filter SamplesTests
```

To add a test, add a `[Test]` method to any struct in `tests/conformance/src/suites`. The runner finds it through
reflection, so there is nothing to register:

```djinn
[Test]
void returns_three() {
    str source = """
i32 main() {
    return 3;
}
""";
    Verify.source(source).runs(Expected.exit(3));
}
```

An error case uses `Verify.source(source).diagnostics(Expected.error(DiagnosticErrors.USE_AFTER_MOVE).at(3, 9))`. Any
diagnostic that is missing or extra fails the test.

### Fixpoint

[tests/djinnc/fixpoint.sh](../tests/djinnc/fixpoint.sh) builds stage2 with the given stage1, then stage3 with stage2,
and compares `stage2.ll` with `stage3.ll`.

```bash
tests/djinnc/fixpoint.sh <stage1 djinnc> <runtime dir> [runtime lib]
```

### Full bootstrap and benchmark

[tools/bootstrap.sh](../tools/bootstrap.sh) (PowerShell wrapper: [tools/bootstrap.ps1](../tools/bootstrap.ps1)) does the
whole chain:

1. The seed builds stage1.
2. stage1 builds stage2, stage2 builds stage3.
3. The IR of stage2 and stage3 is compared (fixpoint).
4. Every sample is compiled and run with stage1, stage2 and stage3; exit code and stdout must match the expectation
   and each other.
5. Stage2 compiles `djinnc/` three times; the best time, tokens, AST nodes and arena bytes go to `bench.json` and are
   compared with [tools/bench.reference.json](../tools/bench.reference.json). A regression above 10% in time or arena
   bytes fails the run.

```bash
tools/bootstrap.sh --seed <path to djinnc> --runtime-dir <runtime dir> [--runtime-lib <lib> --lld] [--out <dir>]
tools/bootstrap.sh ... --update-ref        # rewrite the benchmark reference on the reference machine
```


## Troubleshooting

- **`LLVM-C.dll` not found** when running djinnc: add the LLVM `bin` directory to `PATH`.
- **Undefined `__asan_*` symbols** when linking a prebuilt runtime: the library was built with ASan; use a release build.
- **`undefined symbol: LLVM...` with `--lld` on Windows**: the `-L`/`-l` of `native-libs` were not translated, which
  happens with a stage1 built before that change; rebuild stage1.
- **Error messages cite only the first file**: known limitation of the codegen diagnostics.
