# Compiler Explorer for Djinn

Runs a local [Compiler Explorer](https://github.com/compiler-explorer/compiler-explorer) with `djinnc` registered as the `Djinn` language: assembly, LLVM IR view and execution (exit code and stdout).

## Use

```bash
tools/bootstrap.sh ...                 # produces a djinnc (or set DJINNC=<path>)
tools/compiler-explorer/setup.sh       # clones CE into build/compiler-explorer, patches it, npm install
tools/compiler-explorer/run.sh         # http://localhost:10240
```

On Windows PowerShell use `tools\compiler-explorer\setup.ps1` and `run.ps1` (a `.sh` file is not run directly there; they call Git's bash).

`setup.sh` takes the newest `djinnc` from `build/bootstrap*/stage2` and writes `djinn.local.properties` with its path and `--runtime-dir`. Rerun it after moving to a new djinnc. `CE_DIR` and `CE_COMMIT` override the checkout location and revision.

`run.sh` exports `DJINN_STD_DIR`, so `--std` works in the compiler options box. Linking for execution needs `clang` (and on Windows the MSVC and LLVM `bin` directories) in `PATH`, as for `tools/playground.sh`.

## What is installed into Compiler Explorer

`files/` is copied over the checkout and `apply.mjs` patches the four registries:

| File | Purpose |
|---|---|
| `lib/compilers/djinn.ts` | `DjinnCompiler`: `--emit-asm -o` for assembly, `--emit-ir` for the IR view |
| `etc/config/djinn.defaults.properties` | compiler definition; the exe path comes from `djinn.local.properties` |
| `static/modes/djinn-mode.ts` | Monaco syntax highlighting |
| `examples/djinn/default.djinn`, `public/logos/djinn.svg` | default example and logo |
| `apply.mjs` | adds `djinn` to `lib/languages.ts`, `types/languages.interfaces.ts`, `lib/compilers/_all.ts`, `static/modes/_all.ts` |

## What the views show

Assembly, IR and AST contain only the files in the editor. The runtime (`core.djinn`), the std (`--std`) and the C/C++ library bindings are dependencies: their functions are not emitted, only declarations that user code calls. To see std code, paste it into the editor.

The compiler-generated async infrastructure (the entry `main` that starts the runtime and the `__djinn_coro_*` wrappers) is hidden too; add `--show-async` to the compiler options to show it. The AST view is `djinnc --emit-ast`, and clicking a node jumps to its source line. `-O0` to `-O3`, `-Os` and `-Oz` are accepted in the compiler options box.

## djinnc options used

`--emit-asm` writes assembly to `-o`; `--emit-ir` writes `<-o>.ll`; `--emit-ast` prints the AST with `<line:col>`; `--version` is used for the version label.

## Library view

The `djinnc (library view)` compiler builds the source as a `.djlib` (`--emit-lib-view`) and shows the library inspection in the output pane: header, section sizes, integrity and the interface that consumers see (declarations without bodies, macros and generics kept).
