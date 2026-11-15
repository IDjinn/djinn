# Djinn UI (`libs/ui`, `libs/ui_macros`)

A cross-platform UI library: one component code base, fine-grained reactivity (render runs once, no virtual DOM),
JSX-like markup through the `html!` procedural macro, and render modes declared in code. It is an ordinary optional
library: a program that does not list it pays nothing.

Status: phases 1 to 3 of the roadmap (reactive core, retained tree, `html!`, components, control flow, render modes,
HTML writer, test host, CSS engine and the default theme). Layout, text, the Vulkan renderer and the window host
come next; the web (wasm) host after them.

## Using it

```
compiler:
  libs: ['std', 'ui_macros', 'ui']
```

`ui_macros` holds `html!`, `[Application]`, `[Server]`, `[Client]` and `[Static]`. It is a library of its own because a
library cannot run its own procedural macros, and `ui` itself uses `html!`. Both live in `namespace ui`, so `import ui;`
brings everything.

```djinn
import ui;

struct Counter {
    i32 start;

    public unsafe Node render() {
        signal<i32> count = state(this.start);
        return html!{
            <div class="p-4 flex gap-2">
                <h2>Counter: {count}</h2>
                <button on_click={() => count.set(count.get() + 1)}>+</button>
                {if (count.get() > 9) { <b>big</b> } else { <i>small</i> }}
            </div>
        };
    }
}

[Application(render: server)]
struct App {
    public unsafe Node render() {
        return html!{ <main><Counter start={0}/></main> };
    }
}
```

`examples/ui-showcase` uses every feature; `tests/djinnc/ui.sh` builds it against the `.djlib` files and checks its
output and its interaction tests.

## Reactivity (`src/reactive`)

- `signal<T>` is a `u32` handle (copied and captured for free); `get()` tracks, `peek()` does not, `set()` compares the
  bytes and wakes only what read it. `T` is a trivial type (numbers, `bool`, `str`, slices, plain structs).
- `memo<T>` (`derived<T>(fn)`) recomputes when what it read changed and propagates only when its result changed.
- `effect(fn)`, `Reactive.batch(fn)`, `Reactive.untrack(fn)`, `Reactive.root(fn)` / `Reactive.dispose(root)`,
  `Reactive.on_cleanup(fn)`.
- Push-pull propagation (DIRTY/CHECK states), glitch-free: a diamond runs its effect once per write. A computation
  that read nothing is released right after its first run.

## Markup (`html!`)

| Written | Becomes |
|---|---|
| `<div class="a">` | `Node.element("div").attr("class", "a")` |
| `class={expr}` | one effect setting that attribute |
| `on_click={f}`, `onClick`, `on:click` | `.on("click", f)` (a listener, never an attribute) |
| `{expr}` | one effect bound to its own text node; a `Node` value becomes a region |
| `<Button label="x" n={1}>children</Button>` | `View.mount<Button>({ .label = "x", .n = 1, .children = ... })` |
| `{if (c) { ... } else if (d) { ... } else { ... }}` | `View.show`: only the active branch is mounted |
| `{for (T x in xs) key(x.id) { ... }}` | `View.each`: keyed reconciliation (fewest moves, LIS) |
| `{for (T x in xs) { ... }}` | `View.each_value`: items matched by their bytes |
| `{for (i32 i in a..b) { ... }}` | `View.range` |
| `<li for={T x in xs} key={x.id} if={x.done}>` | the same, for a single element |

Lowercase tags are native elements, capitalized tags are components (structs with `Node render()`; props are
fields, `Node children` receives the children). Text keeps the spaces written next to `{expr}` and drops them at tag
boundaries (`{" "}` forces one). A component is moved to the heap when mounted and freed with its owner.

## Render modes

Declared in code, the most specific wins:

| Where | Declaration |
|---|---|
| app | `[Application(render: client \| hydrate \| server \| static)]` |
| component | `[Server]`, `[Client]`, `[Static]` |

- `client`: the client builds everything. `hydrate`: the server sends HTML with markers (`data-dj`, `<!--[-->`) and
  the client adopts it.
- `server`: rendered only on the server, like React Server Components. Computations run once without subscribing,
  no listener is kept, and everything is released before the response (`Reactive.live()` and `Dom.live()` are back
  to where they were). No client code except `[Client]` islands.
- `static`: `server` done once. `[Static]` on a component renders it the first time it is shown and shares the same
  HTML with every later request (`StaticPages`); writing it to files at build time is the `ui build` step (phase 14).
- `[Server]` keeps the struct in native builds and replaces it in the web build with a placeholder
  (`View.server_island`), so its code never reaches the client. `[Client]` wraps the render in
  `<dj-island data-component="Name">`.

## Styles (`src/style`)

The CSS engine is what the native hosts (Windows first) use to apply real CSS without a browser: the Tailwind CLI
writes the `.css` at build time on any OS, `Styles.add(css)` loads it, and `Styles.of(node)` gives the computed style
the layout and paint stages read. On the web the browser applies the same CSS itself (`Html.document` embeds it).

- Syntax: CSS Syntax 3 tokenizer with escapes (`.md\:flex`, `.w-1\/2`), comments, strings, numbers.
- Rules: style rules, nesting (`&`, nested `@media`), `@layer` (statement and block, document-wide order),
  `@media` (`prefers-color-scheme`, `min-width`/`max-width`, `width >= 48rem` ranges, `hover`,
  `prefers-reduced-motion`, `,` and `and`), `@supports` (assumed true), `@property` (initial values).
- Selectors: type, `*`, class, id, every attribute operator (with `i`), `:hover` `:focus` `:active`
  `:focus-visible` `:focus-within` `:disabled` `:enabled` `:checked` `:first-child` `:last-child` `:only-child`
  `:root` `:empty`, `:is()` `:where()` `:not()`, the four combinators; fragments are transparent. Interaction
  state comes from the host (`Dom.set_state(node, NodeState.HOVER, true)`).
- Cascade: `!important`, origin (browser defaults, theme, author), layers (reversed for `!important`),
  specificity, order; inheritance; custom properties with `var()` and fallbacks; `inherit`/`initial`/`unset`.
- Values: `px rem em % vw vh pt ch`, `calc()` `min()` `max()` `clamp()`; colors in hex, names, `rgb()`, `hsl()`,
  `oklch()`, `oklab()`, `color-mix()` (premultiplied, OKLab or sRGB), `currentColor`.
- Properties: display, position, visibility, overflow, box-sizing, z-index, color, background(-color), opacity,
  font-size/weight/style/family, line-height, letter-spacing, text-align, text-decoration, cursor, color-scheme,
  padding and margin (and sides, inline/block), border (and sides, width, style, color), border-radius,
  width/height and their min/max, flex (direction, wrap, grow, shrink, basis), justify-content, align-items,
  align-self, gap.
- Computed styles are cached per node and recomputed after any change to the tree, the sheets or the
  environment (`Dom.epoch()`); per-subtree invalidation and rule buckets by key are the next optimizations.

### Default theme

The UI is styled out of the box, identically on every platform, in light and dark: `--ui-*` custom properties on
`:root` (background, surfaces, text, muted, border, accent, danger, success, focus, radius, fonts), styles for
`button` (with `.primary`/`data-variant="primary"`, `.danger`, hover, active, focus and disabled states), `input`,
`textarea`, `select`, headings, links, `code`, `hr`, `small`, `.card`, `.badge` and `.muted`.

- `Theme.set(ThemeMode.LIGHT | DARK | SYSTEM)` sets `data-theme` on the document; with `SYSTEM` the OS preference
  decides (`Styles.set_prefers_dark`, reported by the host). `Theme.is_dark()` tells which one is showing.
- An app restyles it by overriding the variables (`:root { --ui-accent: ... }`) in its own sheet, or drops it
  with `Styles.without_theme()`.
- `rem` stays 16px (the theme sets 14px on the app root, as on `body` in a browser), so Tailwind sizes match.
- `App.run` / `App.render_document` write a full page: doctype, `data-theme`, `color-scheme`, the theme and app
  sheets in `<style>` (every `</` in a sheet is broken, so no sheet can close the tag) and the content.

## Output safety

The HTML writer (`view/html.djinn`, `view/html_safety.djinn`) treats every value as untrusted:

- text escapes `& < >`, attribute values also `" ' \``; malformed UTF-8 (overlong forms, UTF-16 surrogates, past
  U+10FFFF, truncated), NUL and C0/C1 control characters become U+FFFD (validation is `std::text::Utf8`);
- `on*` attributes (any case) and `srcdoc` are never written: listeners stay in the tree;
- URL attributes (`href`, `src`, `action`, `formaction`, `xlink:href`, ...) with a `javascript:`, `vbscript:` or
  non-raster `data:` scheme become `about:invalid#blocked`, with the scheme read the way browsers do (case, spaces,
  control characters and NULs ignored);
- invalid tag names render as `<dj-invalid>`, invalid attribute names are dropped.

`src/tests/safety_test.djinn` covers these cases.

## Layout

```
libs/ui_macros/src   html.djinn (macro entry points), html_macro.djinn (markup parser), attributes.djinn, markup.djinn
libs/ui/src
  reactive/          id_list, reactive (graph), signal (signal, memo, state, derived, effect)
  style/             css_lexer, css_values (units, calc, colors), selectors, stylesheet (parser), style (computed
                     style, properties), styles (cascade, cache, environment), theme, growable
  view/              dom (retained tree + HostTest log), node (builder), view (show/each/range/mount/islands),
                     html (writer), html_safety, text_buffer
  app/               app (RenderMode, App.mount/render_to_string/run), static_pages
  tests/             reactive, view, html, safety and style tests (djinnc test libs/ui)
```

HostTest: `Dom.record()` starts logging every tree operation (`insert`, `move`, `remove`, `set_text`, `set_attr`),
`Dom.operation_count()` / `Dom.operations()` read it, `Dom.dispatch(node, "click")` fires listeners as one batch,
`Dom.find(root, "id")` looks a node up.
