# Changelog

## [Unreleased]

## [0.7.18] - 2026-11-27

### Fixed
- A `str` or `string` given as an `i8*` union variant payload, and a byte pointer given as a `str` or `string` payload, is converted as in a call instead of being stored as it was, which read the wrong bytes.

### Changed
- Breaking: an async function now writes `task<T>` as its return type (`task<void>` for no value). A function that returns `task<T>` and uses `await`, or is `main`, is async, so the `async` keyword is optional; with the keyword the `task<T>` is still required (`E3073`). `return` takes a `T`, and the error type of the task comes from `throws(E)` (`E3075`). The return type of a function is no longer rewritten because it awaits: `await` in a function that does not return a task is `E3074` (use `.sync` there), including `main`, constructors, properties and operators. A `task<T>` function with neither `await` nor `async` only passes a task on. Change `async i32 f()` to `task<i32> f()`; libraries must be rebuilt.
- The unused `task<T>` struct of `std::sys`, whose methods were never implemented, was removed: it hid the core `task`. `Task.pause` and `Task.delay` return `task<void>`.
- A union variant payload is checked like a call argument, in generic unions, `optional::Value` and `result::Ok` too: a narrowing or lossy conversion, a number given as a pointer and a pointer of another type are `E3054` (`Shape::Circle(half())` with an `i32` payload and an `f64 half()` compiled), `null` or a nullable pointer given as `T*` is `E3053`, and a struct given as a number or pointer, or the reverse, is `E3024`. A union inferred from its arguments takes the type of the first one, so `Pair::Both(1, wide)` with an `i64 wide` is now an error: name the type (`Pair<i64>::Both(1, wide)`) or cast.
- `djinnc` prints the source line under each diagnostic, with the reported span underlined (`^~~~`). The JSON format is unchanged.
- `E3054` says what could not be converted: the parameter, the function, the argument number and both types, and it underlines the whole expression, closing parenthesis included.
- The error for operands of different types names both types and points at the start of the expression instead of the operator.
- `djinn-lsp` also checks a project with a web entry (`*.web.djinn` or `index.html`) with `--target web`, so an error that only the web build reports appears in the editor, marked `(web build)`.

## [0.7.17] - 2026-11-27

### Fixed
- An installed `djinnc` can build a `ui` project with `--target web`: releases now carry the web bindings (`libs/ui/js` and the sources it shares). Without them every use of a `ui` type was `E3001: unknown type`; when a web build fails with an unknown type, the compiler now names the libraries that have no bindings and where it looked.
- `--target web` declares `Math` in `std::math`, as the native std does, so `import std::math;` finds it (it was in `std::sys`), and `Math.min`, `Math.max` and `Math.abs` take any number type instead of only `f64`.
- A local put into a union variant (`return optional::Value(value);`, `result::Ok(value)`) or wrapped into an `optional<T>` parameter is moved: it is no longer disposed while the union still holds it.
- `--run` loads the libraries the program declares (`-l`, `-L`, library files by path, and the system dependencies recorded in a `.djlib`), so a project that uses `win32` no longer fails with `Symbols not found: [ DispatchMessageA, ... ]`.
- `--run` on Windows no longer crashes when the app's code writes a global that lives in a `.djlib` (opening a `win32` window segfaulted).
- On Windows, `--run` and procedural macros no longer crash when the compiled code of a `.djlib` reads or writes a global that lives in another one (or takes its address): a library object now reaches such a global through a pointer it carries (`__imp_<name>`). Rebuild the libraries affected.
- A build, `--emit-ir` or `--emit-asm` whose output is in a folder that does not exist creates it instead of failing with `cannot write '....obj'`.
- A library that uses a generic function or struct declared in another library or in std (`Cell.put<i32>`, `array<u16>`) no longer fails to link with `undefined symbol`: the library object now defines the instances its code uses, and keeps its own copy of the constants of its dependencies. An optimized library also keeps the instances that an optimized app inlines calls to. Rebuild the libraries affected.
- An optimized program that links a library no longer fails with `undefined symbol: djinn_float_text` (or `Reflection.terminated`): the core functions that library objects call, std built with `-O2` included, are no longer internalized away.

### Changed
- A union never disposes its payload, and moving a payload that needs disposal out of one now moves what was matched: reusing that local after passing, storing or returning the bound name is error `E5001`, and moving it out of a field, element or pointer is `E5008`. Code that disposed the same payload twice this way no longer compiles. A local used as a variant payload cannot be used afterwards (`E5001`).
- An unqualified type or interface name declared by more than one imported namespace is error `E3072`, which names the candidates, instead of silently taking the one imported first. Qualify it (`a::Item`, `a::Item.id()`, `a::Color.Red`, `a::Shape::Dot()`). A type or alias of the current namespace still shadows imports, an alias now beating an imported struct of the same name; an imported type beats a std type the program did not import; and the target of an alias resolves in the namespace that declares the alias, not where it is used. The `testing` types `TextBuffer` and `NodeState` are now `TestTextBuffer` and `TestNodeState`, so a namespace that imports `ui` and `testing` can keep naming the `ui` ones; code that used the old `testing` names must rename them. `testing` and `std::text` both declare `Text`: a namespace that imports both must qualify it (`testing::Text`).
- A JIT error no longer dumps every symbol it touched: at most 10 missing symbols are named and the `Failed to materialize symbols` list becomes one line. The new `-v` / `--verbose` option prints the messages whole.

## [0.7.16] - 2026-11-24

### Fixed
- Warnings from a library's interface source (`E6007` and the like) are no longer printed when a project compiles against the library.
- A procedural macro that receives or returns an interpolated string (`$"clicked {n}
"` inside `html!{ ... }`) no longer fails with "the procedural macro produced '
', which is not a single token": the pieces of the string keep their own token classes (`INTERP_BEGIN`, `INTERP_MIDDLE`, `INTERP_END`, `INTERP_FORMAT`, 10 to 13) in `std::meta`.
- The `main` that `[Application]` generates called `App.run`, which a user struct named `App` shadowed; it now calls `ui::App.run`.

### Changed
- A `main` written in the file replaces the one `[Application]` generates, with warning `E6010`, instead of failing with `E3003`. Mark the hand-written one `[Platform(windows)]` to keep a single source for the native and web builds. Libraries that use `std::meta` or `[Application]` must be rebuilt.

## [0.7.15] - 2026-11-24

### Changed
- `djinnc new` and `djinnc init` show a dim placeholder name they fill on Tab, and need the name and `--target` when there is no terminal or with `--no-input`. Web and windows projects get the default theme as `style.css`. Libraries named in `libs:` also resolve from an installed `djinnc` (`lib` and `optional/*/lib`), so `ui` and `ui_macros` no longer need the source tree; a missing library is reported as such.
- The compiler folds constant text on its own. A literal, a constant interpolation or an immutable local initialised with one, passed to `Reflection.terminated` / `terminated_view` or converted to `i8*`, becomes the static data pointer with no call. A constructor called with constant text (`Error("message")`) is inlined and folded even at O0 (`sroa`, `instcombine`, `simplifycfg` run on modules that have such a call); no attribute is needed. `StringMeta.is_static` is `[ForceInline]`.

## [0.7.14] - 2026-11-24

### Changed
- `str` now carries the same `StringMeta` tag as `string` in the padding it already had (still 16 bytes): a literal, constexpr text or a static `string` viewed as `str` stays tagged STATIC, and `Reflection.terminated` / `terminated_view` keep the pointer when the tag is STATIC and the byte after the text is NUL. `throw Error("message")` therefore allocates nothing at run time; a `str` built any other way (`str.view`, a slice) is still copied. Layout change: every `.djlib` must be rebuilt.

## [0.7.13] - 2026-11-24

### Added
- `E7020`: a call whose constant arguments make a callee's `require` clause provably false (`half(3)` against `require(x % 2 == 0)`) is a compile error instead of a run-time panic. Only parameters that receive compile-time constants are evaluated; anything else is left to run time. The clause is not removed or weakened: it still runs in the callee for callers the compiler cannot see (unsafe, extern, other libraries).

### Fixed
- `E7008` no longer rejects `throw MyError("message")` inside an `atomic` region: a string literal argument is static read-only data, and a constructor only initializes the value it builds, so neither can write memory a rollback must restore.

## [0.7.12] - 2026-11-24

### Added
- `writes(a, b.field)` on a function lists the memory it may change besides its own locals; the body and every callee are audited (`E7013`, and `E7014` for a write the compiler cannot trace). Getters and setters count as calls. The clause and a marker for library functions that write globals travel in the `.djlib`.
- `requires uow` on a function: it can only be called inside an `atomic` or `cooperative` region or from a function marked the same way (`E7015`).
- `uow Name { ... }` declarations (participants, `require`, `ensure`, `writes`, `access`, `ordering`, `isolation`) and `uow(Name) strategy cooperative` on a method, which runs its body as an atomic region over the uow's writes with the uow's contracts (`E7016`, `E7017`, `E7018`). `access` and `ordering` are verified without generating code: a written participant must be `exclusive`, and two declarations may not order keys in conflict (`E7019`). See `examples/bank_uow.djinn`.
- The language server colors `uow`, `writes`, `requires uow`, `strategy`, `access`, `ordering` and `isolation` as keywords where they act as one, with hover and completion.
- `djinnc new [name] [--target=web|windows|executable|library]` creates a project (`djinn.proj`, a starter source, `index.html` for web); without `--target` it asks with a spectre selection. `djinnc init` writes a `djinn.proj` for the current folder step by step, and `djinnc doctor [dir] [--target=...]` checks the toolchain, `djinn.proj` and the libraries the target needs. They run in `djinn-scaffold` (`tools/scaffold`, installed next to `djinnc`).
- The language server understands record structs (`struct Name(T a, U b);`): the parameters are listed as fields of the struct.
- The VS Code extension runs a lone file without a `djinn.proj` when it has `main()` and imports only `std`; otherwise it says that a project is needed.

## [0.7.11] - 2026-11-23

### Added
- Contracts: `require` and `ensure` clauses on functions, with `old(...)` in `ensure` to read a value as it was on entry. Each library has a contract mode, `check`, `observe` or `ignore`, recorded in its `.djlib` manifest; the library's code, and the generics a consumer recompiles, follow it, and a consumer in `check` is told when an imported library only observes or ignores. `ignore` never becomes an assumption for the optimizer.
- `invariant(...)` on a struct, checked when its methods return. A write to the struct from outside its own methods is `E7002`.
- Effects inference: every function is classified as `writes`, `io`, `suspends` or `unknown`, and the table travels in the library manifest. `[Pure]` (`E7003`) and `[Effects]` (`E7004`) are verified against it, and a contract clause with an effect is `E7009`.
- `--obligations` and `--obligations=json` list the tracked guarantees and the inferred effects.
- Atomic regions: `atomic(ops) { } after_commit { }` undoes by move, cannot suspend (`E7005`), follows the pivot rule (`E7006`) and checks the write set (`E7008`); `cooperative { }` marks a region that may suspend. See `examples/bank_transfer.djinn`.
- `[NativeError]` on an `extern` function turns its failure protocol into a Djinn error; it works across libraries.
- The language server, the web target and the VS Code grammar understand contracts, invariants and atomic regions. The language server offers hover documentation and completion for `require`, `ensure`, `invariant`, `old`, `atomic`, `cooperative` and `after_commit`, keeps the outline of a struct with an invariant, and colors the contextual words (`invariant`, `atomic`, `cooperative`, `after_commit`, `old`) as keywords only where they act as one.

### Fixed
- String literals with the same contents share one private global instead of one `.str` per use (the `djinnc` binary carried about 450 repeated strings, 330 KB, among them every function and file name used by stack traces).

## [0.7.10] - 2026-11-22

### Added
- Stacked `switch` labels: a `case` or `default` label with no statements shares the body of the arm after it, `case 1: case 2: case 3: return 10;`. A label with a body still does not fall through. Native, `--target web` (plain JavaScript fallthrough) and `constexpr` evaluation agree. The `comparison-chain` hint's "Convert to switch" fix produces this form.
- `switch` accepts a `str` or `string` value: `switch (name) { case "red": ... default: ... }`. Labels have the value's type and are compared in order with `operator ==`; a `constexpr` switch on text compares the contents. Other value types still report `E3046`.
- `Files.read_all_many` and `Files.write_bytes_many` (compiler support) transfer a list of files at once through `__djinn_files_batch` with libc. `Files.read_all_many_uring` and `Files.write_bytes_many_uring` ask for one private io_uring on Linux instead (large batches, high latency storage; chunked reads, short transfers resubmitted); other platforms and kernels without it use libc. `djinnc` loads its inputs and the core library with the libc form.

- `djinn.proj` accepts the optimization options in its `compiler:` section, so scripts and real runs build the same way: `optimization: "O2"` (O0, O1, O2, O3, Os, Oz), `cpu: "skylake"`, `features: "+avx2"`, `range-opt: false` and `harden: "standard"`. The command line wins over the project (`-O`, `--cpu`, `--features`, `--no-range-opt`, `--harden=<level>`). An unknown level or `harden` value is an error.
- Hardening is on by default: ahead-of-time code on ELF targets gets `sspstrong` stack protectors, and the link adds `-z relro -z now -z noexecstack` (Linux, Android, `--lld`); the runtime built by `tools/build_runtime.sh` (or compiled by `djinnc` from source) uses `-fstack-protector-strong -fstack-clash-protection -D_FORTIFY_SOURCE=3`. The level is configurable (`--harden=off|basic|standard|strict`, `harden:` in `djinn.proj`, `DJINN_HARDEN` for the build script); `on` is `standard`, `strict` adds a canary in every function and zero-initialized locals in the C runtime. See "Hardening" in the compiler-flags docs page for the rest.

- Full hardening: `-pie` and CET (`-fcf-protection=full`) or BTI/PAC (`-mbranch-protection=standard`) on Linux and Android; `strict` adds Control Flow Guard on Windows and ShadowCallStack on Android arm64. Written against `clang`'s flags; verified on Windows x64 only.
- `--sanitize=address|undefined|thread` and `sanitize:` in `djinn.proj`: the Djinn code goes through the `asan`/`tsan` passes and the link and runtime sources use `-fsanitize`. `DJINN_SANITIZE` does the same in `tools/build_runtime.sh`. Not on Windows (`address`, `thread`), WebAssembly, Android or `--lld`.
- `--gc-sections` / `gc-sections: true` removes unused code and data at link time; the runtime is built with function and data sections. WebAssembly links with `-O2`, the web runtime builds with real warnings instead of `-w`, and `DJINN_WASM_OPT` runs `wasm-opt -O2` when it is installed.
- A library records its IEEE 754 revision in its manifest. Importing a library built with `ieee754 none` into a conforming project warns that a NaN or an infinity passed to it is undefined behavior; two different conforming revisions only log an information line, and a `none` project using a conforming library is silent. `std/djinn.proj` pins `ieee754: "2019"` (`tools/build_std.sh` passes the same values).

### Changed
- The runtime's coroutine frame cache is not compiled in under AddressSanitizer or with `-DDJINN_NO_FRAME_CACHE`: every frame goes straight to `malloc`/`free` with its exact size, so a use after free, a double free, a resume of a destroyed coroutine and a small overflow are reported by the sanitizer (`runtime/scheduler.c`). Normal builds are unchanged.

- `tools/build_runtime.sh` compiles the runtime with `-ffunction-sections -fdata-sections` (every runtime object), and our own C code (not `yyjson`) with `-fno-strict-aliasing -fwrapv`: no strict-aliasing assumptions over memory Djinn code wrote with other types, and signed overflow wraps instead of being undefined. `djinnc` links as before.

### Documentation
- New docs page "Optimization & Build Flags" (`docs/content/docs/advanced/compiler-flags.mdx`): what `-O0`…`-Oz` run, what range analysis and async elision remove, the float and `--cpu native` caveats, the flags the link step passes on each target, how the runtime library is built, and a table of things that can surprise.

### Fixed
- `async void main` that suspends (an `await` on a real task such as `Task.delay`) failed to link with `undefined symbol: __djinn_coro_destroy`: the entry point declared the function before the coroutine wrappers were defined, so LLVM renamed the definition. The wrappers now reuse the existing declaration (`AsyncVoidMainWithSuspension`).

## [0.7.0-preview.2] - 2026-11-21

### Added
- Enum variants without a payload are written without parentheses: `enum FileKind { RegularFile, Directory }`, `return FileKind::Directory;`.
- `Enum::parseValue(i64)` returns the variant that has that value, or `Unknown` (the enum must declare it, `E3034`); also on `--target web`. `std::filesystem::FsError` carries its codes and `fs_error_from_code` is `FsError::parseValue(code)`.
- Warning `E6008`: `return x == A || x == B || ...` (5+ alternatives over the same `str`/`string`/integer/enum value and constants, or `f_ignore_case(x, "a") || ...`) can be a `switch`. `djinn-lsp` reports it as the `comparison-chain` hint with a "Convert to switch" fix (the ignore-case form switches on `x.toLower()`; `comparison_chain_test.py`).
- `struct mut Name { ... }` makes every field mutable. A struct whose fields are all declared `mut` reports warning `E6007` and suggests `struct mut`. `djinn-lsp` reads `struct mut Name` (`struct_mut_test.py`).
- A `constexpr` struct or array with `str`/`string` literals, nested arrays and structs is emitted as constant static data in the binary. A text field that is not a literal is an error.
- `==` and `!=` compare `str` on the web target too (`runtime/js/std` declares the operator, compiled to `===`).
- Arrays in `html!` (`libs/ui_macros`): a component property can be written as an array literal, `<Select options=["Small", "Medium"] index={size}/>` (or `options={sizes}` with `str[] sizes = [...]`). The array is built once when the component is mounted, so a list of choices is no longer one `"A|B|C"` text split on every read. `Select`, `Menu`, `Navigator`, `Drawer`, `TabBar`, `Stack`, `Stepper`, `RadioGroup`, `Breadcrumb` and `Outlet` (`groups`) take `str[]`; `Choices.count` and `Choices.nth` have `str[]` overloads (the `str` forms stay for `"A|B"` helpers). A native element's attribute cannot be an array. `djinn-lsp` highlights the array as Djinn code (`embedded_test.py`).
- LLVM memory attributes for allocation functions, bound by attributes instead of names: `[AllocFn("family")]`, `[ReallocFn("family")]`, `[FreeFn("family")]` and `[AllocZeroed]` on a function, `[AllocSize]`, `[AllocPtr]` and `[AllocAlign]` on its parameters. They emit `allockind`, `allocsize`, `allocptr`, `allocalign`, `memory(...)`, `noalias`, `nounwind` and `alloc-family`, so LLVM can pair allocations with frees. `std/sys/libc.djinn` and `runtime/core/libc.djinn` carry them; the attributes also apply to a redeclaration of a function declared earlier. IR tests in `AllocatorIrTests`.
- `css!{ ... }` (`libs/ui_macros`): a stylesheet written as CSS, checked while compiling (blocks, `property: value`, known property names; custom properties and vendor prefixes always pass) and expanded to the `str` of its text, so it works anywhere a string did (`Styles.add(css!{...})`, a function returning the sheet, a file written at build time). `Styles.once(css)` adds a sheet a single time, for a component that installs its own from `render()`. `djinn-lsp` highlights it as CSS (selectors, at-rules, properties, values, colors, custom properties) and reports `css-unknown-property`, `css-expected-declaration`, `css-missing-value` and `css-rule-without-selector`; `libs/ui_macros/djinn.editor` binds `css`. `abstract` is a keyword for `djinn-lsp` and the VS Code grammar, and `extern "JS"`/`extern "C"` structs are symbols there. `djinn-lsp/tests/embedded_test.py`, `extern_test.py`.
- A free `abstract` function needs no body: `[Js("template")] abstract T f(...);` (web) and `[Symbol("name")] abstract T f(...);` (native), with the same `E3069` / `E3070` rules as an `abstract` method, so a binding no longer needs a dummy body that returns a made-up value.
- Interop bindings in `extern`: `extern "JS" { struct Input { [Js("$key.code")] public static i32 key(); } }` and `extern "C" { struct S { [Symbol("name")] ... } }` declare opaque, body-less structs provided by the platform (`E3068` instantiating one, `E3069` calling it on a target without a provider, `E3070` missing `[Js]`/`[Symbol]`, `E2014` bodies/fields/constructors inside). `abstract` (struct or method modifier) marks other body-less declarations (`[intrinsic]`, `[no_mangle]`); a body-less method outside `abstract` and `extern` is `E2011`. `libs/ui/js/kit.djinn` uses `extern "JS"`.
- JavaScript islands are the web default (phase 5): `[Application]` without `render:` is `render: server`, and a server or static app whose public directory has an `app.js` loads it for its islands (no flag needed). `examples/ui-web` is rewritten for it: pages from the server, a `Counter` island that starts at the 5 in its `data-props`, a todo list that starts when the browser is idle and a theme button that starts on interaction; no `.wasm` is built or shipped (`tests/djinnc/ui_web.sh` checks it and runs the site's pages on the fake DOM). `kit` components such as `Field` are not available to the JavaScript program yet (`<input bind:value>` is).
- Runtime cache: `static-cache: <seconds>` in the `compiler:` section of `djinn.proj` (constant `Build.StaticCache`, a year when absent) and `--cache <seconds>` on the native server (which wins) set how long a browser keeps the runtime; `0` is no-store, and a debug build (`-g`) never lets it be kept.
- Load strategies (phase 4): `[Client(load: visible | load | idle | interaction)]` says when the page's JavaScript takes an island over. `visible` (the default, not written in the HTML) waits until the island is near the viewport (`IntersectionObserver`, `load` where the browser has none), `load` is at once, `idle` is `requestIdleCallback`, `interaction` is the first pointer, touch, focus or key event on the island. The server writes `data-load` for the other three. `tests/web/js/load.mjs`.
- The native server loads the JavaScript islands: `--program <file>` (a file of `--public`, the program built with `--target web`) makes a page that holds islands write `<link rel="modulepreload">` for the runtime the program imports and a `<script type="module">`, in place of the WebAssembly host's tag. A program of at most 2048 bytes is written into the page (one request fewer); a page without islands gets no `<script>`. The runtime (`djinn.<hash>.js`, named after its content) is sent with `Cache-Control: immutable`. `Html.set_client_js`.
- Islands-only JavaScript (phase 3): the program of an `[Application(render: server|static)]` web build is its islands. Each `[Client]` gets a `[Island("Name")]` mount function that is a root of the program, registered in `$islands`; `$mountIslands` adopts each `<dj-island>` on its own. The page's code and `[Server]` code are not generated, and a page without islands is left as the server wrote it. The runtime is tree-shaken: only the chunks the program reaches are written (a counter page went from about 49.5K of JavaScript to about 16.5K). The runtime file name still hashes its content, so it now differs per program. An island is built from zero values plus its `data-props`, so a missing or wrong-typed prop warns and re-renders that island.
- Debug builds (`-g`) send indented HTML, one block per line; release builds send it minified (no whitespace between elements, minified stylesheet). Inline elements and `pre`/`textarea`/`script`/`style` are never reflowed, and adoption ignores the line breaks between blocks.
- Adoption in the JavaScript host (phase 2): a page the server rendered is no longer rendered again. `Node.element` and `Node.text` are `$el` and `$txt` in `ui.js`; while the app mounts they return the server's nodes in document order and the code that builds the tree links them, so no element is created and listeners and signals go onto the server's nodes. A `[Server]` / `[Static]` part keeps its `<dj-server>` HTML and its code is not in the generated JavaScript. A mismatch warns and renders the island again from its props (only that island), or the page when it is outside the islands. `tests/web/js/adopt.mjs`.
- The web target writes two files: the program (`app.js`, an ES module) and the runtime it imports (`djinn.<hash>.js`, named after its content): system code apart from user code, so the interface can be cached and a new program build does not invalidate it. The program takes from the runtime only the names it uses. `tests/web/js/exec.mjs` runs both under Node.js.
- Island props (phase 1 of the JavaScript islands model): a `[Client]` island's fields are its props. The server writes them in `<dj-island data-component="X" data-props="{...}">` as JSON (escaped for the attribute) and the JavaScript build reads them back, so the island starts from the server's values and not from its declaration; a value that is missing or of another type warns and keeps the declaration's. A prop is a `bool`, `i32`, `u32`, `str` or a `slice` of those; any other field type is a compile error at the field. `ui::IslandProps`, `View.island_props`, `tests/web/js/props.mjs`. The WebAssembly add-on still builds an island from its declaration.
- Libraries declare the language of their macros for the editor (#150): a `djinn.editor` file (`macro html = html`, `language sql { keywords: ... }`) makes `djinn-lsp` highlight and lint the body of `html! { ... }` as markup (tags, components, attributes, `{expr}` back in Djinn, tags inside `{if ...}` groups) or as a rule language. New semantic token types `tag`, `operator` and `string`; lint rules have ids (diagnostic `code`) and `lint-disable:` turns them off; `libs/ui_macros/djinn.editor` binds `html`. `djinn-lsp/tests/embedded_test.py`.
- `str`/`string` methods in `std::text`: `trimPrefix`, `trimSuffix`, `padLeft`, `padRight` (by UTF-8 length, with a `char` fill), `lines` (LF and CRLF) and `splitWhitespace`. Conformance test `text_search_trim_and_compare`.

### Changed
- `--target web` pages load the program with `<script type="module" src="app.js">` (it imports its runtime) instead of a classic `<script defer>`.

## [0.7.0-preview.1] - 2026-11-17

Preview of the UI work: the JavaScript web target and the same `libs/ui` source rendered natively and on the web. A preview release is marked as such on GitHub.

### Added
- The web target compiles to JavaScript: `--target web` writes one `.js` file instead of an object. The emitter (`djinnc/src/codegen/js`) walks the type-checked tree and writes only what `main` reaches: plain JS functions, struct values as object literals, JS strings, arrays and closures, checked / wrapped / saturating integer arithmetic as natively. `[Js("template")]` makes every call of a function the template (`$this`, `$0`, `$*`), which is how the bindings reach the browser with no wrapper: `std` is `runtime/js/std` and `libs/ui/js` is `ui` on the web (`ui.js`: push-pull signals, memos, effects, direct DOM building, keyed lists, two-way binding, router, theme). `examples/web-app` and `tests/djinnc/web.sh` (the same programs natively and under Node.js, the app on a fake DOM).
- `examples/showcase`: one front end built as a native Windows app and as a web page; `tests/djinnc/showcase.sh` checks that every route builds the same tree on both. The kit components that only build markup are shared with the web as they are (`libs/ui/js/shared.txt`).
- The WebAssembly target, now `--target wasm` (`wasm32-unknown-unknown`), an add-on next to the JavaScript web target: it builds a freestanding WebAssembly module, linked by `wasm-ld` with the web runtime (`runtime/web`: allocator, the libc Djinn declares, printf, math, JSON, logger and an event loop that never blocks) and loaded by `djinn.js` in a browser or in Node.js. `extern "mod" { ... }` imports from a WebAssembly module and `[Export("name")]` exports a function. `tests/djinnc/wasm.sh` runs programs natively and under Node.js and compares their output.
- Procedural macros while cross-compiling: they run on the host, `<lib-dir>/<triple>/` holds the target's libraries, and a library built for the host only lends its macros.
- `libs/ui` on the web: the real DOM, updated in batches from the retained tree, with delegated events, bound fields, router and address bar, timers and animations on frames. Client rendering, hydration of the server's HTML (no node created) and `[Client]` islands of server pages. `[Server]` / `[Static]` parts render inside `<dj-server>`.
- `App.run` natively: `--out <dir>` writes a static site following the internal links, `--serve <port>` is a development server. `examples/ui-web` builds as both the server and the client; `tests/djinnc/ui_web.sh` checks it all under Node.js.

### Changed
- `--target web` means JavaScript; WebAssembly is `--target wasm`. `Target.is_web()` is the web platform (both), `is_js()` and `is_wasm()` the two targets.
- `libs/ui`: the theme stylesheet moved to `ThemeSheet` (`style/theme_sheet.djinn`), shared by the native build and the web bindings; `Theme.css()` still returns it. `Dialog`, `Transition` and `Field` moved to `kit/kit_dom.djinn`, `Popup` to `kit/popup.djinn`, `Link` to `router/link.djinn` and `Key` / `Mod` to `input/keys.djinn`, so the files the web shares hold only markup.
- `libs/vulkan` delay-loads `vulkan-1.dll`: a program that uses the UI starts on a machine without the Vulkan loader and draws with the software rasterizer (Vulkan stays the default; `DJINN_UI_CPU=1` still opts out). A `-Wl,<flag>` entry in a `djinn.proj` reaches the linker with and without `--lld`.

### Fixed
- The native UI renderer draws what the browser draws for the showcase: list items get their marker (`display: list-item`, `list-style-type` disc / circle / square / decimal, `ol start`), a blank at the start of a text run is a space again (`{i} squared is {x}` drew `0squared is  0`), every font weight reaches the font provider (the Windows host picks Segoe UI Light / Regular / Semibold / Bold / Black as Chrome does, 500 and 600 were drawn regular or bold), `ch` is the advance of "0" in the font, and scroll bars take the room of a browser's (`scrollbar-width`, `scrollbar-color`, the page bar).
- The socket operations of the runtime (`accept`, `connect`, `send`, `recv`) did not mark their coroutine waiting, so the event loop resumed it before the I/O finished: an accept failed at once.
- A UI node removed while a fade ran on it got the fade's last attribute after its id was reused.
- `nint.MAX_VALUE`, `MIN_VALUE` and `BITS` follow the target instead of assuming 64 bits.
- `VulkanRenderer.create` freed nothing when it failed halfway, and `release` left the pipeline, layouts, pools, sampler, atlas, buffers and sync objects behind: both now destroy every object that was created.

## [0.6.2] - 2026-11-16

### Changed
- `djinnc <dir>` also accepts the path of a `djinn.proj`, normalizes `\` and `/` in the project path, and, with no `src` folder, compiles the `.djinn` files next to the manifest (the `std` library).

## [0.6.1] - 2026-11-16

### Added
- `(i16s)x`: a saturating integer cast clamps to the range of the target (the `w` suffix already truncated), at run time and in constant evaluation.
- `--windowed` (and `windowed: true` in `djinn.proj`): links a Windows GUI program with no console window. `-l<name>` and `-L<dir>` on the command line, with the same mapping as the manifest.
- `std::libc`: `atoi`, `atoll`, `strtoll`, `strtoull`. `Math` has `f32` versions of the error and gamma functions.
- `[Abi(C)]` marks a function as callable from C (`Stdcall`, `Fastcall`, `SysV` and `Win64` select other conventions): its signature is checked (E3067) and `&function` can be given to the system as a callback.
- `Point[n]` allocates `n` structs on the stack (like `i8[n]`) and gives a `Point*`.
- A library records the system libraries its manifest names (`'-luser32'`) in the `.djlib`; a program that imports it links them once and is told when an import library cannot be found (it looks next to the library, in `../native`, in the `-L` directories and in `LIB`). `ui`, `win32` and `vulkan` declare theirs, so `--link-arg` is no longer needed.

### Changed
- Pointer arithmetic (`p + n`, `p - n`, `p++`) steps by the size of the element, as in C. A `ptr` (void pointer) still steps by bytes.
- `__djinn_free(null)` is accepted and does nothing.

### Fixed
- `Task.delay` could finish a few milliseconds early on Windows (the timer clock ticked every 15 ms): it now uses the performance counter and never fires before its deadline.
- Linking without `--lld` on Windows failed with `undefined symbol: printf`: the clang link now adds `legacy_stdio_definitions`.

## [0.6.0] - 2026-11-15

### Added
- Closures: `fn(A, B) -> R` types, `(a, b) => expr` and `(i32 a) => { ... }` lambdas with captures (copied or moved, read-only inside), calls through locals, fields and expressions, function names as `fn` values, and `.djlib` support. New errors E3064 (assigning a captured variable), E3065 (moving a captured value) and E3066 (untyped lambda parameter without an expected type).
- Macros: `name!{...}` and `name![...]` delimiters, statement and declaration macros, `block`, `statement`, `tokens` and variadic (`expression... xs` with `$for`) fragments, bound `type` parameters, hygienic template locals, generic arguments with commas, trailing commas, `ns::name!(...)` calls, and warning W6006 when a function shares the name of a visible `name(...)` macro.

- Procedural macros: `proc macro name => handler;` and `proc attribute Name => handler;` with the `std::meta` token API (`Token`, `TokenStream`); a program that imports the library runs them while it is parsed.
- `libs/ui` and `libs/ui_macros`: the UI library (reactive core with signals, memos and effects, retained tree, `html!` markup with components, `if`/`for` regions and keyed lists, render modes declared with `[Application(render: ...)]`, `[Server]`, `[Client]` and `[Static]`, an HTML writer that escapes and sanitizes every value, and a test host that logs tree operations), with `examples/ui-showcase` and `tests/djinnc/ui.sh`.
- UI CSS engine (`libs/ui/src/style`): tokenizer, nesting, `@layer`, `@media`, `@property`, selectors with `:is()`/`:where()`/`:not()` and states, cascade with layers and `!important`, custom properties, `calc()`, `oklch()`/`color-mix()` colors; and a default light/dark theme (`Theme.set`, `--ui-*` variables) applied out of the box. `App.run` writes a full themed page.
- UI layout engine (`libs/ui/src/layout`): block and inline flow, flexbox (grow, shrink, wrap, gaps, alignment, auto margins, automatic minimum), grid (`fr`, `minmax()`, `repeat(auto-fit, ...)`, spans, auto-placement, track sizing), absolute, fixed and relative positioning. `Layout.compute(root, width, height)` caches per box and input, so a change lays out again only the boxes around it.
- UI screen scale: `Styles.set_device_scale` multiplies px, pt and the root font size (media queries stay in CSS pixels); the win32 host reads the system DPI (`DJINN_UI_SCALE=150` forces a percentage) and sizes the window and Vulkan surface by it.
- ui: `Animation.fade_out` and the `Transition` kit component: content fades out and then disappears when its signal turns false, and fades in when it turns true (immediately with reduced motion).
- ui: `transform` (scale, translate) animated with an interruptible spring: `transition: transform <time>`, drawn without relayout; buttons scale on press, the switch thumb slides, dialogs and popups pop in from 96%.
- ui: smooth (eased) scrolling for the wheel, keys and focus in the native host; pages wider than the window scroll sideways; the extra mouse buttons navigate back and forward; Escape closes a `Dialog`; `Timers.every` for looping animations, with a Motion page in the native example.
- ui: fixed a memory leak in the style engine: every declaration applied by a restyle kept its token array (and the text a `var()` produced), about 90 KB per frame of an animated page.
- ui: CSS `transition` for background-color, border-color, color and opacity (interruptible, no relayout) and motion by default: the theme eases hover, press and selection colors over `--ui-motion`, and dialogs and popups fade in and out (`data-open`), tab panels fade in; all skipped with reduced motion.
- ui: `Field` takes an optional `value={signal<str>}` and binds it both ways (typing sets the signal, setting it rewrites the field).
- UI fixes: a click reaches elements inside `{for}` regions (navigator links did nothing), positioned elements with a positive `z-index` (drop-downs, menus, tooltips) are drawn above the page and hit first, and `ClipboardBackend` is the one interface every platform clipboard implements (`Clipboard.use<T>`; win32 implements it). `DJINN_UI_H` sets the headless shot height.
- UI paint, text and native host: display list and software rasterizer (`libs/ui/src/paint`), glyph atlas with GDI fonts (`libs/ui/src/text`), `libs/win32` (window, message pump, mouse and key events to DOM events), `libs/vulkan` (Vulkan renderer, the default; the software rasterizer only when no Vulkan device exists or `DJINN_UI_CPU=1`) and `libs/spirv` (`spirv!{...}` compile-time SPIR-V assembler macro used for the shaders). `examples/ui-native` is the client-mode showcase and `examples/ui-bench` the speed, memory and CPU benchmark.
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
