# Djinn UI (`libs/ui`, `libs/ui_macros`)

A cross-platform UI library: one component code base, fine-grained reactivity (render runs once, no virtual DOM),
JSX-like markup through the `html!` procedural macro, and render modes declared in code. It is an ordinary optional
library: a program that does not list it pays nothing.

Status: phases 1 to 4 of the roadmap (reactive core, retained tree, `html!`, components, control flow, render modes,
HTML writer, test host, CSS engine, the default theme and the layout engine). Text shaping, the Vulkan renderer and
the window host come next; the web (wasm) host after them.

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
- Rules: style rules, nesting (`&`, nested `@media` and `@supports`), `@layer` (statement and block, document-wide
  order), `@property` (initial values), `@media` (`prefers-color-scheme`, `min-width`/`max-width`,
  `width >= 48rem` ranges, `hover`, `pointer`, `prefers-reduced-motion`, `prefers-contrast`, `forced-colors`, `,`
  and `and`). Widths in `em`/`rem` follow the OS text scale.
- `@supports` is evaluated for real (`(property: value)`, `not`, `and`, `or`, `selector()`): a declaration is
  supported when the engine applies the property and can read the value. A sheet's fallbacks therefore apply here
  exactly as in a browser without the feature, and `@container` blocks are skipped until container queries land.
- Selectors: type, `*`, class, id, every attribute operator (with `i`), `:hover` `:focus` `:active`
  `:focus-visible` `:focus-within` `:disabled` `:enabled` `:checked` `:first-child` `:last-child` `:only-child`
  `:root` `:empty` `:any-link`, `:is()` `:where()` `:not()`, the four combinators; fragments are transparent.
  Interaction state comes from the host (`Dom.set_state(node, NodeState.HOVER, true)`).
- Cascade: `!important`, origin (browser defaults, theme, author), layers (reversed for `!important`),
  specificity, order; inheritance; custom properties with `var()` and fallbacks; `inherit`/`initial`/`unset`.
- Values: `px rem em % pt ch`, the viewport units (`vw vh vi vb vmin vmax` and their `d`/`s`/`l` forms, which are
  the same in a native window), `calc()` `min()` `max()` `clamp()`; colors in hex, names, `rgb()`, `hsl()`,
  `oklch()`, `oklab()`, `color-mix()` (premultiplied, OKLab or sRGB), `currentColor`, `light-dark()` and the
  system colors (`Canvas`, `CanvasText`, `Highlight`, ...), both resolved against the element's `color-scheme`.
- Properties: display, position, top/right/bottom/left and inset, visibility, overflow, box-sizing, z-index, order,
  aspect-ratio, color, color-scheme (`light dark` follows the system), background(-color), opacity,
  font-size/weight/style/family, line-height (a unitless value is inherited as the number), letter-spacing,
  text-align, text-decoration, overflow-wrap, cursor, padding and margin, border (and sides, width, style, color),
  border-radius, outline and outline-offset, width/height and their min/max, flex (direction, wrap, grow, shrink,
  basis), gap, justify-content, align-items, align-self, align-content, justify-items, justify-self and the
  `place-*` shorthands, grid-template-columns/rows, grid-auto-columns/rows/flow, grid-column, grid-row, grid-area.
- Logical properties map to the physical ones (`inline-size`, `min-block-size`, `margin-inline-start`,
  `padding-block`, `inset-inline`, `border-inline`, ...): only horizontal left-to-right writing is laid out for now.
- The environment a host reports: `Styles.set_viewport`, `set_prefers_dark`, `set_text_scale` (the OS text size:
  the root font size and every rem follow it), `set_coarse_pointer`, `set_reduced_motion`, `set_more_contrast`,
  `set_forced_colors`.
- Computed styles are cached per node. A change in the tree restyles only what it can reach: the node, its
  subtree and its siblings (`Dom.changed`, `Dom.restyle_stamp`); sheets and the environment restyle everything
  (`Dom.epoch()`). Rule buckets by key are the next optimization.

### Default theme

The UI is styled out of the box, identically on every platform, in light and dark, and responsive without the app
asking for it. The theme (`style/theme.djinn`) follows the
[modern web guidance](https://github.com/GoogleChrome/modern-web-guidance) of the Chrome team:

- **Tokens.** `--ui-*` custom properties on `:root`. Each color is written once per scheme (`--ui-bg-light`,
  `--ui-bg-dark`) and joined with `light-dark()`, which follows `color-scheme`; browsers without it get the same
  tokens from `prefers-color-scheme` and `data-theme` under `@supports not`. An app restyles the theme by
  overriding the tokens (`:root { --ui-accent: ... }`) or drops it with `Styles.without_theme()`.
- **Schemes.** `Theme.set(ThemeMode.LIGHT | DARK | SYSTEM)` sets `data-theme` on the document; with `SYSTEM` the OS
  preference decides. `data-theme` on any element forces a scheme for that subtree. `Theme.is_dark()` tells which
  one the document shows.
- **Cascade.** Everything is in the layers `ui-base`, `ui-components` and `ui-layout`, with `:where()` selectors, so
  any rule of the app (or of Tailwind) wins without a specificity fight. No rule on `*`; states exclude what they
  do not apply to (`button:hover:not(:disabled)`) instead of being overridden.
- **Text size.** The root font size is left to the user: sizes are `rem`/`em`, line heights are unitless, and the
  page carries `<meta name="text-scale" content="scale">`, so the OS and browser text settings scale the whole
  interface (`Styles.set_text_scale` on native hosts). Headings and gutters are fluid: `clamp()` of a rem part and
  a viewport part, the maximum never more than 2.5 times the minimum.
- **Targets and focus.** Controls have a minimum size of 2.5rem, 2.75rem on touch screens (`pointer: coarse`), and
  no fixed height, so a long label wraps and the control grows. The focus ring is an `outline` with an offset on
  `:focus-visible`. Links stay underlined (color alone never marks one).
- **Contrast.** Text and control borders meet WCAG contrast in both schemes; `prefers-contrast: more` strengthens
  borders and muted text; with forced colors (Windows High Contrast) the tokens become the system palette.
- **Elements.** `button` (with `.primary` / `data-variant="primary"`, `.danger`), `input`, `textarea`, `select`,
  headings, paragraphs (capped at 70ch), lists, links, `code`, `pre`, `hr`, `small`, media, `.card`, `.badge`,
  `.muted`.
- **Responsive layout classes**, which reflow by the space they are given, with no viewport breakpoint:

  | Class | Layout |
  |---|---|
  | `.page` | a centered column up to `--ui-page` (72rem) wide with fluid gutters |
  | `.stack` | children one under the other, `--ui-gap` apart |
  | `.cluster` | children side by side, wrapping to new lines |
  | `.tiles` | as many equal columns as fit, each at least `--ui-tile` (16rem); one column on a phone |
  | `.split` | a sidebar (first child) beside the content (last child); they stack when the content gets narrow |

- `App.run` / `App.render_document` write a full page: doctype, `data-theme`, the `color-scheme` and `text-scale`
  metas, the theme and app sheets in `<style>` (every `</` in a sheet is broken, so no sheet can close the tag)
  and the content.

Container queries are the one recommendation not followed yet: the native engine does not have them, so the theme
uses only intrinsic layouts, which behave the same in the browser and natively.

## Layout (`src/layout`)

`Layout.compute(root, width, height)` lays the tree out in a viewport; `Layout.rect(node)` gives the absolute
border box of a node, `Layout.box(node)` its margins, border, padding and content extent. It is what the native
renderer will paint from; on the web the browser lays out the same CSS.

- **Flow.** Blocks stack and fill the width (auto margins center them); adjoining sibling margins collapse; runs
  of inline-level boxes (text, `inline`, `inline-block`, `inline-flex`) break into lines aligned by `text-align`.
  `box-sizing`, percentages, min/max sizes and `aspect-ratio` apply everywhere.
- **Flexbox.** Flex base sizes from `flex-basis`, the main size or the content; wrapping into lines; grow and
  shrink with min/max clamping, including the automatic minimum (an item does not shrink below its content unless
  `min-width: 0` or it scrolls); `gap`, `order`, reversed directions, auto margins, `justify-content`,
  `align-items` / `align-self` and `align-content`.
- **Grid.** Tracks in px, %, `fr`, `auto`, `min-content`, `max-content`, `minmax()`, `fit-content()` and `repeat()`
  with `auto-fill` / `auto-fit` (including `minmax(min(100%, 16rem), 1fr)`); implicit tracks from `grid-auto-*`;
  placement by line numbers and spans, then auto-placement in row or column flow, sparse or dense; track sizing
  from the items' content, `fr` distribution and stretched `auto` tracks; alignment of the tracks and of each item
  in its area.
- **Positioning.** `absolute` against the padding box of the nearest positioned ancestor, `fixed` against the
  viewport, `relative` offsets; `display: none`, `display: contents` and fragments.
- **Incremental.** Every box caches its results per input (a parent measures a child several times while sizing
  it). A change stamps the path to the root, so the next `Layout.compute` lays out again only the boxes around it
  and the ones whose style it can reach; an unchanged tree costs nothing (`Layout.runs()` counts the work).
- **Text.** Until the text stage brings font shaping, text is measured with placeholder metrics (every character
  half the font size wide, wrapping at spaces, `overflow-wrap`); a host can plug its own with
  `Layout.set_text_measure`.

Not covered yet: text flowing across inline boxes (an inline box wraps inside itself), baseline alignment, margin
collapsing between a parent and its first or last child, floats, tables, named grid lines and areas, subgrid,
`position: sticky` offsets, vertical and right-to-left writing, and container queries.

## Focus and keyboard (`src/input`)

Host independent: a host calls `Focus.set(Focus.owner(hit), false)` when the pointer presses and `Input.press(key, mods)`
for each key (key codes are the Windows virtual-key values, `Key.*`; modifiers are `Mod.SHIFT | CTRL | ALT`).

- Focusable: `button`, `select`, `textarea`, `input` (not hidden), `a[href]` and anything with `tabindex`; never a
  `disabled` control or a box under `display: none`. `tabindex="-1"` takes focus by pointer or `Focus.set` but Tab
  skips it. Tab order is tree order and wraps.
- `Focus.set(node, by_keyboard)` sets `:focus` and `:focus-visible` (a pointer press on a button shows no ring; Tab
  does; text fields always do) and fires `blur` / `focus`. A focused element that leaves the tree loses focus.
- `Input.press` fires `keydown` at the focused element (or the document), bubbling; a listener reads `Input.key()`,
  `Input.shift()`, ... and may call `Input.prevent()`. Defaults: Tab / Shift+Tab move focus, Enter and Space click a
  focused button, Enter follows a focused link, Escape blurs.

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

## Source layout

```
libs/ui_macros/src   html.djinn (macro entry points), html_macro.djinn (markup parser), attributes.djinn, markup.djinn
libs/ui/src
  reactive/          id_list, reactive (graph), signal (signal, memo, state, derived, effect)
  style/             css_lexer, css_values (units, calc, colors), grid_values (track lists, placements), selectors,
                     stylesheet (parser), style (computed style, properties), styles (cascade, cache, environment),
                     theme, growable
  layout/            layout (boxes, cache, flow, positioning, text metrics), flex, grid
  view/              dom (retained tree + HostTest log, change stamps), node (builder),
                     view (show/each/range/mount/islands), html (writer), html_safety, text_buffer
  input/             focus (Tab order, :focus state), input (keydown, key codes, default actions)
  app/               app (RenderMode, App.mount/render_to_string/run), static_pages
  tests/             reactive, view, html, safety, style, theme and layout tests (djinnc test libs/ui)
```

HostTest: `Dom.record()` starts logging every tree operation (`insert`, `move`, `remove`, `set_text`, `set_attr`),
`Dom.operation_count()` / `Dom.operations()` read it, `Dom.dispatch(node, "click")` fires listeners as one batch,
`Dom.find(root, "id")` looks a node up.
