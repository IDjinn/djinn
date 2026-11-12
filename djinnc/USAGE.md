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
| `--runtime-dir <dir>` | Directory with the runtime `.c` sources (default `runtime`). |
| `--runtime-lib <lib>` | Link a prebuilt runtime instead of recompiling it (built by `tools/build_runtime.sh`). |
| `--link-arg <arg>` | Extra linker argument; repeatable. |
| `-O0`, `-O1`, `-O2`, `-O3`, `-Os`, `-Oz` | Optimization level: runs `default<ON>` through `LLVMRunPasses` and sets the backend codegen level. Without it the pipeline is `default<O0>`. |
| `--lld` | Call the linker directly: `lld-link` on Windows, `ld.lld` on POSIX. Needs `--runtime-lib`. |
| `--cpu <name\|native>` / `--features <+a,-b>` | Target CPU and feature list for code generation (default `generic`); `native` uses the host CPU and its features. |
| `--lib-dir <dir>` | Where `libs:` in `djinn.proj` finds each `<name>.djlib` (default `build/libs`). |
| `--std` / `--std-dir <dir>` | Compile the `std/` library too (also `libs: ['std']` in `djinn.proj`, or `DJINN_STD_DIR`); see [STD_ROADMAP.md](STD_ROADMAP.md). |
| `--target <triple>` | Target triple (default: the host). Sets the width of `usize`/`isize`; non-x86 targets only support `--emit-ir`. |
| `--tiered`, `--tier-threshold=<n>`, `--tier-settle=<ms>` | With `--run`: tiered JIT with three tiers. Tier 0 is unoptimized code that only counts how many times each function is entered and each loop iterates. A function that reaches `n` hits (default 1000) is promoted once no new function has started running for `ms` milliseconds (default 100, at most about one second of waiting): a background thread recompiles just the hot functions at `-O1` with a counter on every conditional branch (tier 1). When a tier-1 function has seen `4n` branch events it is recompiled again at `-O2` (or the `-O` level given) with `!prof branch_weights` from those counters (tier 2). Every function forwards to its newest version, and the program runs the whole time. There is no on-stack replacement, so a loop already running in an older tier stays there until its function is called again; coroutines, variadic functions, functions taking structs by value and `main` always stay in tier 0. Needs the runtime library built by `tools/build_runtime.sh` (it ships `tier.o`) and does not support `-g`. The JIT uses the large code model in this mode. |
| `--run` | Run `main` in process through ORC LLJIT (`driver/jit.djinn`) instead of writing an object and linking. Needs `--runtime-lib` and the host target; the exit code of `main` is the exit code of djinnc. The JIT backend uses the code generation level of `-O` (none by default, so startup stays fast), and without a resident `.djlib` everything the program cannot reach from `main` is dropped before compiling. |
| `--no-link` | Stop after generating code; writes `<output>.ll`. |
| `--emit-ir` / `--keep-ir` | Write `<output>.ll` (IR). `--keep-ir` also links. |
| `--emit-asm` | Write the assembly to `-o` and stop. |
| `--show-async` | In the view modes, also show the compiler-generated async infrastructure (the entry `main` that starts the runtime and event loop, and the `__djinn_coro_*` wrappers). Hidden by default. |
| `--no-async-elision` | Keep every `async` function a coroutine. By default an async function that can never suspend is compiled as a plain function and reported with warning `E6004` (see `djinnc/SUBSET.md`). |
| `--emit-ast` | Print the AST (with `<line:col>`) to stdout and stop. |
| `--version` | Print the compiler version. |

`--emit-ir`, `--emit-asm` and `--emit-ast` are view modes: they show only the files given as inputs. The runtime (`runtime/core/`) and the std loaded by `--std` are dependencies, so their functions are not emitted (only declarations when referenced) and their declarations are not dumped; pass a std file as an input to see it. `--keep-ir`, `--no-link` and linked builds keep everything.
| `--emit-tokens` / `--emit-ast` | Dump the token list or the AST and exit. |
| `--stats` | Print files, tokens, AST nodes and arena usage, plus a `PerformanceMonitor` lap per phase (lex, parse, codegen, write-ir, object, link) and the total, in ms. |
| `test <dir> [options] [-- args]` | Build the project in `<dir>` with its `*_test.djinn` files (and `test-libs:` from `djinn.proj`), reflection on, then run the result. `--watch` reruns the build and the tests whenever a project file changes (`--watch-runs <n>` stops after n runs). Everything after `--` goes to the test program (`--filter`, `--tag`, `--workflow`, `--graph`, `--graph-file`, `--junit`, `--seed`, `--bench`, `--bench-out`, `--bench-ref`, `--bench-tolerance`, `--fail-fast`, `--jobs`, `--report`, `--list`). Without a `main` in the test files, the driver generates one that runs the tests; `entry:` in `djinn.proj` names the normal `main` file to leave out. The exit code is the test program's. |
| `--tests` | Include `*_test.djinn` in a project build without running anything. Normal builds skip those files. |

Objects are emitted directly through LLVM-C (`LLVMTargetMachineEmitToFile`); only the x86 target is initialized.

### Environment variables

| Variable | Effect |
|---|---|
| `DJINN_CLANG` | clang executable used to link (default `clang`). |
| `DJINN_LLD_LINK` | `lld-link` executable (Windows `--lld`). |
| `DJINN_LD_LLD` | `ld.lld` executable (POSIX `--lld`). |
| `DJINN_CRT_DIR` | Directory with `crt1.o`, `crti.o`, `crtn.o` (POSIX `--lld`, default `/usr/lib/x86_64-linux-gnu`). |
| `DJINN_DYNAMIC_LINKER` | Dynamic loader (POSIX `--lld`, default `/lib64/ld-linux-x86-64.so.2`). |
| `DJINN_USE_LLD` | Test scripts only: when set, they add `--lld` if a runtime library is given. |

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
