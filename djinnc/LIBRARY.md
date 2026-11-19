# Djinn libraries (`.djlib`)

A `.djlib` is a single file with the compiled object, the Djinn interface of the library (a compact token stream, never source text) and the optimizable bitcode of its small functions, so consumers keep the
full language semantics (macros, attributes, generics, constexpr, reflection) instead of only seeing symbols.

## CLI

```
djinnc lib.djinn --library -o lib.djlib          # build a library (no entry point is generated)
djinnc app.djinn --lib lib.djlib -o app.exe      # consume it (repeat --lib for several)
djinnc --inspect-lib lib.djlib                   # header, sections, integrity and the interface
djinnc --inspect-lib lib.djlib --sections-only   # header and sections only
djinnc lib.djinn --emit-lib-view -o view.txt     # build + inspection text (used by Compiler Explorer)
```

`DJINN_BUILD_ID` is stored in the header as the build id when set (commit hash, CI number...).

Rebuilding a library whose manifest, interface, object and bitcode are byte for byte the same (and the same compiler) leaves the existing file untouched, so its timestamp does not change and build systems do not rebuild the consumers. The build id is not compared.

## Projects

A `djinn.proj` builds a library with `library-mode: true`. `libs:` lists what the project uses: `std`, or a name that resolves
to `<lib dir>/<name>.djlib`, where the directory comes from `--lib-dir` (default `build/libs`). `sources:` adds files outside
`src/`, relative to the project. `reflection-mode: all` is the same as `--reflect-all`.

```
compiler:
  library-mode: true
  output:
    file: "djinnc_testing.djlib"
    directory: "build/libs"
  libs: [
    'std',
    'testing'
  ]
  sources: [
    '../src/support/source/diagnostic_code.djinn'
  ]
```

A library can be built on another one. A `.djlib` has no dependency list, so the final program lists all of them.
Import a library after `namespace`: an `import` above it does not expose the names.

## Compression

The interface and bitcode sections are stored as LZ4 blocks (`djinnc/src/support/text/lz4.djinn`, standard LZ4 block format) when that is smaller, under the kinds 5 and 6, which readers that do not know them ignore. On std this is about 43% smaller for the interface and 51% for the bitcode. The object stays raw, because the linker needs it extracted on disk. Section checksums and the interface hash are the std text hash (`djinnc/src/support/text/text_hash.djinn`, eight independent lanes that LLVM vectorizes; FNV-1a is a serial chain and cannot be), announced by header flag bit 1; libraries without the flag are still read with FNV-1a. Checksums cover the stored bytes, a section that does not decode is reported as corrupted, and the compiler expands the sections in memory when it loads the library, so the interface hash and everything else see the raw bytes. The writer decodes what it compressed and compares it with the original; on a mismatch it warns and stores the section raw. `--no-compress` writes the sections raw. `--inspect-lib` shows the raw size and, on a second line, the stored size.

## Supported platforms

`targets: [windows, linux]` under `compiler:` in `djinn.proj` lists the platforms a project supports (the platform words of
`[Platform(...)]`: `windows`, `linux`, `macos`, `android`, `ios`, `web`, and the groups `desktop`, `mobile`, `native`; an unknown
word is an error; no `targets:` means any platform). Building for a platform outside the list is an error, and so is `--run` of it.
A library stores the list as a bit mask after the link list of its manifest (`--inspect-lib` prints `targets:`). A consumer
refuses a library that does not support the platform being built for (`library 'x.djlib' supports windows; building for linux`),
and an application whose `targets` are wider than those of a library it uses (`the project supports windows, linux, but library
'x.djlib' supports only windows`). Libraries without the list, including older ones, are accepted everywhere.

## Version policy

A compiler reads libraries written by a compiler of the same major.minor version (offset 28; the patch is ignored) and
rejects others with a message naming the compiler that wrote them: build the library again. The header also stores a hash of
the interface section (offset 96, same hash). A consumer refuses a library whose interface does not match it (`is stale`), and
`--inspect-lib` prints it. A hash of 0 (libraries from before the field) is not checked. The format version (offset 8)
still guards the layout itself.

## File layout (all integers little-endian)

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | magic `DJINNLIB` |
| 8 | 4 | format version (1). Readers must reject a greater value |
| 12 | 4 | header size (128). Readers skip to this offset |
| 16 | 4 | flags. bit 0: built with `--std`. bit 1: checksums use the text hash (see below); without it they are FNV-1a-64 |
| 20 | 4 | section count |
| 24 | 4 | section table offset (128) |
| 28 | 4 | compiler version, `major<<16 \| minor<<8 \| patch` (256 = 0.1.0), for comparison |
| 32 | 32 | version label, NUL padded free text (`0.1.0-dev`, `0.2.0-rc.1`, `nightly`...), for display |
| 64 | 32 | build id, NUL padded free text (commit hash...) |
| 96 | 8 | interface hash: checksum of the interface section (0 in libraries written before it existed) |
| 104 | 24 | reserved, zero |

Section table: one 32 byte entry per section: `u32 kind, u32 pad, u64 offset, u64 size, u64 checksum`.

| Kind | Section | Content |
|---|---|---|
| 1 | manifest | `u32 len + name`, `u32 len + target triple`, file count, then `u32` link count and that many `u32 len + text` link arguments |
| 2 | interface | binary token stream, see below |
| 3 | object | native object file |
| 5 | interface, compressed | `u32 raw size` + an LZ4 block that decodes to the interface section (written instead of kind 2 when smaller) |
| 6 | bitcode, compressed | same for the bitcode section (instead of kind 4) |
| 4 | bitcode | LLVM bitcode of the small, self-contained exported functions (see below), always written in library mode. Readers that do not know the kind ignore it |

The format version stays 1. A library whose interface is the older minified text (no `DJI1` magic) is rejected with a message to build it again; a file with a greater version is rejected as unsupported. The interface is the token stream of the declarations, not text. It starts with the magic `DJI1` and holds, as varints:
the atom table (every distinct identifier and literal once, most frequent first so common ones take one byte), the phrase
table (qualified names `a::b::c` and attributes `[Name]` that repeat, referenced by index instead of spelled out), then
per file its path (common directory stripped) and the tokens: one kind byte (bit 7 = whitespace before the token)
followed by an atom or phrase index for the kinds that carry text. The bodies of non generic, non constexpr functions,
constructors, operators and property accessors are replaced by `{}`. Generics, macros, constexpr and struct layouts stay
complete, and comments never reach the file. The consumer does not run the lexer on it: it pushes the tokens directly.
Modifiers (`private`, `async`, `sync`, `unsafe`) are kept in the text, so a consumer enforces `private` (E3062) and sees `sync`/`async` signatures the same way as for source.

## How it works

- Build: bodies are recorded by the parser (`Library.record_body`); the object is produced with no entry point and
  with core/std definitions demoted to declarations; sections are packed and checksummed.
- Consume: interface files are unpacked into tokens and parsed as header sources (`SourceFile.is_library_interface`); their macros are collected with every
  other macro before parsing and are visible to files that import the library namespace. Tokens a macro expands keep the
  call site, so declarations it produces in the consumer are not treated as header declarations. Header
  functions become `extern`, header globals become declarations; the object is extracted next to the output and
  linked, then removed.
- Procedural macros: a library that declares `proc macro` / `proc attribute` exports one entry per macro; a consumer runs
  it from the library object at compile time (ORC JIT, `driver/proc_macros.djinn`). Objects of every loaded library are
  kept for that (`Library.macro_objects`). `std::meta` code is linkonce, so it stays in the macro library object.
- Dedup across modules: generic instances, constexpr functions and struct-instance methods are `linkonce_odr` in a
  comdat; typeinfo is `linkonce_odr`; reflection tables are internal.

## Link dependencies

A library project lists the system libraries it needs as quoted lines in its `djinn.proj` (`'-luser32'`, `'-lvulkan-1'`, `'-Ldir'`, or a path). They are stored in the manifest. When a program imports the library the compiler adds them to the link once, however many libraries ask for the same one, and verifies them: a path that does not exist is an error, and on Windows a `-lname` whose `name.lib` is not found (next to the library, in `../native`, in a `-L` directory or in `LIB`; common system libraries are assumed present) is reported as a warning before the linker fails. A directory that holds the import library is added to the search path. `--inspect-lib` lists them as `links:`.

## Bitcode and cross-library inlining

Every library stores a bitcode section, whatever its optimization level and with or without `-g`: a copy of the module
before optimization, with debug info and the `-g` stack-trace instrumentation removed, where only the small exported functions keep their bodies (at most 60 instructions, no
coroutines, no `main` or `__djinn_*`, and nothing that touches non constant library-private data or private functions).
Everything else is a declaration, and what no kept body uses (string constants, prototypes) is dropped, so the section stays
small and is the same with or without `-g`.

When a consumer compiles with `-O1` or higher (not `--tiered`; `-g` is fine), it parses each bitcode section into its own
LLVM context, marks the function bodies `available_externally` and links them into the program module. The
optimizer inlines them and drops the unused ones, while calls that stay are resolved against the library object.
A `-g` consumer inlines too: inlined library calls then have no debug frame of their own, which is the usual trade-off of inlining. A body the consumer already defines wins. If a section cannot be parsed (for instance it was written by another
LLVM), a warning is printed and the library is used without inlining. `--inspect-lib` always lists the bitcode line (`none` when the file has no section).

## Std as a library

`--std` (and `libs: ['std']`) loads `<lib dir>/std.djlib` when it exists, so the program does not compile std again; without it, std is compiled from source. `--run` and `--check` keep the library object in memory (the JIT adds it as an object file). Build it with `tools/build_std.sh <djinnc> <lib dir>/std.djlib [flags]`; the test scripts (`tests/conformance/build.sh`, `tests/djinnc/unit.sh`) do it and the conformance runner takes `--lib-dir`.

## Reflection and debug symbols

- Reflection: `[Reflect]` types of a library are reflected in the library object (typeinfo is `linkonce_odr`), and
  consumers see the same types through the interface, so `typeof` works across the boundary.
- Debug: building the library with `-g` embeds debug info for the library code in its object, pointing at the
  original source paths, so a debugger steps into library code from the consumer (`-g` on both sides works).

## Roadmap / not yet supported

- Debug synergy: store the original sources (or a source map) in the library so debuggers and Compiler Explorer can
  show library code when the original path is gone; the interface has no original line numbers, so consumer
  diagnostics point at `<lib>!<path>` at line 1 with the column as the position in the token stream.
- Reflection synergy: a reflection section with the type/attribute tables so `--inspect-lib` lists reflected types,
  fields and attributes, and registry-style lookups across several libraries.

- Library depending on other libraries (manifest has no dependency list; header bytes 96..127 are reserved for it).
- Per-function dead stripping of the std object (it is linked whole).
- `.djni` interface-only files.
- Static variable initializers and global constructors across libraries (header globals are declarations only).
- Reflection method pointers (`funcPtr`) and `[Reflect]` tables of library types when mixed with `--reflect-all`.
- Cross-target libraries in one file (one interface, several objects per triple). Today each target has its own `.djlib`: while cross-compiling, `<lib-dir>/<triple>/<name>.djlib` is preferred over `<lib-dir>/<name>.djlib`, and a library built for the host is loaded only for its procedural macros (they run in the JIT; nothing of it is linked), which is how `ui_macros` serves a web build. A prebuilt std is `<lib-dir>/<triple>/std.djlib`; without it the std is compiled from source.
- Compression of the object section (it stays raw: the linker needs it extracted on disk).
