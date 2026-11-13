# Djinn Language (VS Code)

Language support, build, debug and profiling for Djinn.

- **Language server**: diagnostics from `djinnc --check`, hover, go to definition, references, rename, completion, signature help, outline and semantic highlighting.
- **Build**: `Djinn: Build`, `Djinn: Build and Run`, `Djinn: Check Project`, and a `djinn` task type with the `$djinnc` problem matcher.
- **Debug**: `Djinn: Debug` builds with debug info at `-O0` and starts the native debugger (`cppvsdbg` on Windows, `cppdbg` elsewhere, from the C/C++ extension `ms-vscode.cpptools`). Breakpoints work in `.djinn` files.
- **Profile with perf**: CPU, allocations and touched memory, shown as inline hints in the editor, a tree view and an assembly view.

## Setup

The extension looks for the tools in this order: the setting, a copy bundled in the extension (`bin/`, `toolchain/`), what the language server reports, and a Djinn checkout found from the workspace or from the extension folder.

Working from a checkout:

1. Build the language server: `djinn-lsp/build.sh <djinnc> [runtime dir]`.
2. `npm install` in this folder, then run the extension from VS Code (F5), or package it with `npx @vscode/vsce package` and install the `.vsix`.
3. For project builds, make `std.djlib` and the runtime library available (`tools/build_std.sh`, `tools/build_runtime.sh`) and point `djinn.libDir` and `djinn.runtimeLib` at them. Without `std.djlib` the standard library is compiled from source.

Settings: `djinn.server.path`, `djinn.compilerPath`, `djinn.runtimeDir`, `djinn.stdDir`, `djinn.runtimeLib`, `djinn.libDir`, `djinn.llvmBinDir`, `djinn.build.*`, `djinn.debug.optimization`, `djinn.perf.*`.

## Profile with perf

`perf` runs on Linux: natively on a Linux host, or through WSL on Windows. The program is compiled for Linux with debug info, recorded, and the result is imported (nothing is injected into the binary). Needs `perf`, `objdump`/`addr2line` (binutils) and, for allocation profiling, `python3` on the Linux side.

Because the profiled build is made on Linux, the extension needs a Linux `djinnc` and `libdjinn_runtime.a`: set `djinn.perf.compiler` and `djinn.perf.runtimeLib` (build them on Linux, see `tools/bootstrap.sh` and `tools/build_runtime.sh`), or bundle them in `toolchain/linux/`.

Commands:

- `Djinn: Profile with perf` samples the CPU. Hot lines get a heat background and a hint with the percentage, the samples and the operation behind the cost (integer division, memory load, overflow check, calls, …).
- `Djinn: Profile memory allocations` places probes on the allocator (`__djinn_alloc`, `__djinn_alloc_zeroed`, `__djinn_realloc`, `__djinn_free`), pairs allocations with frees and reports per call site: allocated bytes, live at exit (leaks), live at peak, or allocation count (`Djinn: Choose memory metric`). Probes add a few microseconds per allocation.
- `Djinn: Profile touched memory pages` records page faults (resident growth, not allocator sizes).
- `Djinn: Profile and compare optimization levels` records the program at several levels (for example O1 and O3) and opens a table with each function's samples per level. `Djinn: Compare saved profiles` does the same for profiles already recorded.
- `Djinn: Stop profiling` ends a recording (status bar button or the Djinn Profile view). `Djinn: Import perf profile`, `Djinn: Toggle profile hints` and `Djinn: Clear profile` manage results.

The **Djinn Profile** view (Explorer) is a namespace tree ordered by cost; functions expand to their hot lines. The filter button hides everything outside the project (std, runtime, libc, kernel). `Djinn: Show assembly (profile)` opens the disassembly beside the source, each instruction with its share of samples and the source line next to the first instruction that came from it; it follows the file and cursor.

Results are written to `.djinn/perf/` of the profiled project. Each sample is attributed to the nearest frame in your project, or in the standard library when the stack has none. Djinn coroutine frames can stop the unwinder early, so callers are not always known.

### `launch.json`

Every option can be set in a launch configuration (F5 / Run and Debug), so nothing depends on one machine. Use `"mode": "profile"` with the `djinn` debug type:

```json
{
  "type": "djinn",
  "request": "launch",
  "name": "Djinn: Profile allocations",
  "mode": "profile",
  "target": "${workspaceFolder}",
  "args": ["--example"],
  "env": { "KEY": "value" },
  "cwd": "${workspaceFolder}",
  "profile": {
    "kind": "allocations",
    "metric": "live",
    "optimization": "O3",
    "duration": 30,
    "frequency": 499,
    "callGraph": "fp",
    "runner": { "type": "wsl", "distro": "<wsl distro name>", "user": "root", "perf": "perf" }
  }
}
```

- `kind`: `cpu`, `allocations` or `pages`. `metric` (allocations): `alloc`, `live`, `peak`, `count`.
- `levels`: `["O1", "O3"]` records each level in turn and opens the comparison table (instead of `optimization`).
- `duration`: seconds per run; `0` records until the program exits or you stop it.
- `runner.type`: `wsl` (default on Windows) or `native` (default on Linux; `"sudo": true` runs it through sudo). `distro`, `user`, `perf` (path of the perf executable) and `workDir` (where the profiled build is made, default `$HOME/.djinn-perf`) adapt it to the machine.
- `args` is a list (each item is quoted), `env` sets variables for the program. Omitted values fall back to the `djinn.perf.*` settings.
- The target is never taken from inside the extension's own folders; set `target` when the workspace has no `djinn.proj`.

The snippets "Djinn: Profile CPU", "Profile allocations", "Compare optimization levels" and "Profile on a Linux host" create these configurations.

## Debug builds

Debug builds use `-O0` (`djinn.debug.optimization`) and, when available, a `std.djlib` built with debug info in a `debug/` folder next to the normal one, so locals and struct members are visible and breakpoints work in the standard library too.
