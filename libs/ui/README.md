# Djinn UI (`libs/ui`, `libs/ui_macros`)

A cross-platform UI library: one component code base, fine-grained reactivity (render runs once, no virtual DOM),
JSX-like markup through the `html!` procedural macro, and render modes declared in code. It is an ordinary optional
library: a program that does not list it pays nothing.

Status: phases 1 to 7 of the roadmap (reactive core, retained tree, `html!`, components, control flow, render modes,
HTML writer, test host, CSS engine, the default theme, the layout engine, text, the software rasterizer, the Vulkan
renderer and the Windows host in `libs/win32`) and phase 11, the web: `--target web` compiles the same components
to JavaScript that builds the real DOM directly (see [On the web](#on-the-web-javascript)); the WebAssembly host
(client rendering, hydration, islands, static sites) stays as an add-on behind `--target wasm`. Vulkan is the default renderer on the desktop;
`vulkan-1.dll` is delay-loaded, so a machine without it (or `DJINN_UI_CPU=1`) draws with the software rasterizer.
Linux, macOS, Android and iOS hosts come later.

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

## Styles as a macro (`css!`)

`css!{ ... }` is a stylesheet written as CSS. It is read while compiling (rules, nesting, at-rules; every other
statement must be `property: value` with a known property, custom properties `--x` and vendor prefixes always pass) and
expands to the `str` of its text, so it goes wherever a string did. The editor highlights and checks it like `html!`
(`djinn.editor` of `ui_macros`). Strings use double quotes; an unknown property, a missing `:` or value, or a rule
without a selector is a compile error at that spot.

```djinn
struct Card {
    str title;

    public unsafe Node render() {
        Styles.once(css!{
            .card { padding: 8px 1.5rem; border-radius: 8px; &:hover { background-color: #f1f5f9; } }
            @media (min-width: 600px) { .card { padding: 16px; } }
        });
        return html!{ <section class="card">{this.title}</section> };
    }
}
```

- A component keeps its sheet next to its `render()` with `Styles.once` (the same text is added a single time however
  often the component mounts); an app-wide sheet is `Styles.add(css!{...})` at startup.
- It is still a string: `Styles.add("...")`, a `.css` file read at build time or the output of a tool (Tailwind CLI)
  work as before, and `css!` can be returned from a function (`static str css() { return css!{...}; }`).
- Limit: the lexer reads the body as Djinn tokens, so `'single quotes'` and `//` are not CSS here, and a class or
  identifier named `macro` is read as a macro declaration.

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
  HTML with every later request (`StaticPages`); `--out <dir>` writes a whole static site (see below).
- `[Server]` renders natively inside `<dj-server data-component="Name">` and is replaced in the web build by a
  placeholder (`View.server_island`) that adopts that element, so its code never reaches the client. `[Client]`
  wraps the render in `<dj-island data-component="Name">`. Both elements have `display: contents`.

## On the web (JavaScript)

The web model is islands: the native program writes each page as complete HTML, a `[Client]` struct becomes a
`<dj-island data-component="Name" data-props='{...}'>` the page's JavaScript takes over, and nothing else is sent: no
WebAssembly, no whole-page hydration. `[Application]` without `render:` is `render: server`, which is this model;
`examples/ui-web` is a small site made that way (a counter island that starts at the 5 the server sent, a todo list, a
theme button) and ships no `.wasm`. What is left to the WebAssembly add-on: `render: client` and `render: hydrate`
pages built with `--target wasm`, where the browser runs the whole app, and the `kit` components (`Field`, overlays,
virtual lists), which use the native `Dom` and are not available in the JavaScript program yet (use `<input
bind:value={...}>`).

`--target web` compiles the app to JavaScript, like Svelte or Solid compile their components: no WebAssembly and no
virtual DOM. `html!` lowers the markup to builder calls as usual, and on the web each of them is a `[Js]` template of
the bindings in `libs/ui/js` (`ui.djinn`), so the generated code calls the DOM and the reactive core (`ui.js`)
directly:

```djinn
signal<i32> count = state(0);
return html!{ <button on_click={() => count.set(count.get() + 1)}>{count}</button> };
```

becomes

```js
const count = $signal(0);
return $insertSignal($on(document.createElement("button"), "click", () => { $set(count, $i32($read(count) + 1)); }), () => count);
```

```
djinnc libs/ui_macros -o build/libs/ui_macros.djlib --std-dir std            # the macros run on the host
djinnc examples/web-app --target web -o build/app --lib-dir build/libs       # writes build/app.js
```

- Reactivity is push-pull (`$Signal`, `$Computation`): a write wakes only what read it, a memo propagates only when
  its value changed, a diamond runs its effect once, and the computations a render creates belong to it and are
  disposed with it. A component renders once, untracked (`View.mount`).
- Each `{expr}` is one text node updated in place (`insert` is chosen by the type of the expression at compile time:
  text, a signal, a memo or a `Node`); a region (`if`, `for`, a `Node` expression) is the nodes before an empty text
  node that marks its end.
- `for ... key(...)` keeps one owner per key and moves nodes only when they are out of place; a new value under the
  same key rebuilds that row only. `bind:value={signal}` / `bind:checked={signal}` bind a field both ways.
- The components are the same source on both sides: `libs/ui/js/shared.txt` lists the files of `src` that only
  build markup (the kit: `Button`, `Switch`, `Checkbox`, `Tab`, `TabPanel`, `Select`, `Menu`, `Tooltip`, `List`,
  `Item`, `Table`, `Row`, `Navigator`, `Link`; `Key`; the theme sheet) and the web compiles them as they are. Only
  the services under them are bound (`Router`, `Input`, `Choices`, `Styles.add`, `Theme`), plus `Outlet`, `Dialog`,
  `Field` and `Transition`, which talk to the tree directly natively and are written for the browser with the same
  markup. `examples/showcase` builds the same tree on both (`tests/djinnc/showcase.sh`).
- `Router` follows the native rules (`:name` segments, a trailing `*`), drives the address bar (`pushState`, back and
  forward) and cancels the browser's default when a click navigates; `Theme.toggle()` sets `data-theme`.
- Motion follows the native animation system: `data-open` presents or dismisses (fade, then `data-gone`), an active
  tab panel fades in, a new page fades and slides in while the old one fades out. The theme stylesheet (`ThemeSheet`, `style/theme_sheet.djinn`, shared with the native build) goes into
  `<head>` once.
- The app mounts into `#app` or `<body>`. A page the server rendered (`hydrate`, `server`, `static`) is adopted, not
  built again: while the app renders, `$el` and `$txt` (what `Node.element` and `Node.text` are on the web) hand out the
  nodes the server wrote, in document order, and the code that builds the tree links them as it always does, so no element
  is created and the listeners and signals are wired onto the server's nodes. A `[Server]` / `[Static]` part keeps its
  `<dj-server>` element with everything inside it, and its code is not in the program. When the client builds another tree
  than the server wrote, the mismatch is reported (`console.warn`): an island is rendered again from its props (only that
  island, in its own element), and a mismatch outside the islands renders the page again. The comments an island carries
  for the WebAssembly host are dropped, and a page without server HTML is built in the browser as before.
- The program and the runtime are two files. The runtime (`djinn.<hash>.js`: the std bindings and the `.js` files of the
  libraries, `ui.js` for this one) is system code, the same for every program built with the same libraries, named after
  its content so a page can cache it for good; the program (`app.js`, the user's code and what it reaches) is an ES module
  that imports it and takes from it only the names it uses: `<script type="module" src="app.js">`.

- Island props: the fields of a `[Client]` struct are its props. Natively the server writes them in the island's
  `data-props` as a JSON object (`<dj-island data-component="Counter" data-props="{&quot;start&quot;:5}">`, the JSON
  escaped for the attribute); on the web the island reads them from its own element and starts from those values, not
  from the declaration's. A prop is a `bool`, `i32`, `u32`, `str` or a `slice` of those, any other field type is a
  compile error at the field, and a value that is missing or of another type is reported (`console.warn`) and the
  declaration's value stays. An island claims the next `<dj-island>` of its name in document order, adopts its content,
  and, if the server's HTML is not what its props render, is built again from the props. The WebAssembly add-on builds
  an island from its declaration.

- Loading islands: `[Client(load: ...)]` chooses when the page's JavaScript takes an island over. `visible` (the default) waits until the island is near the viewport, `load` is at once, `idle` waits for an idle browser and `interaction` for the first pointer, touch, focus or key event on it; until then the island is the server's HTML, which already works as a page. The native server (`--program app.js --public <dir>`) writes a `modulepreload` of the runtime and the program's `<script type="module">`; a program of at most 2048 bytes travels inside the page, and a page without islands has no `<script>` at all. The runtime's name is its content hash, so it is served with `Cache-Control: immutable` for `static-cache` seconds (`djinn.proj`, a year by default; `--cache` on the server overrides it; a debug build never caches it). Not done: one module per island (the program is a single file and the runtime is most of the bytes), and the program itself is not minified.

`examples/web-app` uses all of it and `tests/djinnc/web.sh` drives it on a fake DOM under Node.js.

## On the web (WebAssembly, add-on)

The WebAssembly build (`--target wasm`) is kept as an add-on and will move out of the main path. One program, two
builds. Natively it is the server; with `--target wasm` it is the client:

```
djinnc libs/ui_macros -o build/libs/ui_macros.djlib --std-dir std            # macros run on the host
djinnc libs/ui -o build/libs/ui.djlib --std-dir std                           # the server side
djinnc libs/ui -o build/libs/wasm32-unknown-unknown/ui.djlib --std-dir std --target wasm
djinnc tests/web/ui/hydrate -o build/site/server --std-dir std
djinnc tests/web/ui/hydrate -o build/site/public/app.wasm --std-dir std --target wasm   # also copies djinn.js
```

The native program prints the page (no arguments), writes a static site (`--out <dir>`: "/" and every page its
internal links reach, plus `Router.declare(path)`; `<dir>` is relative) or serves it (`--serve <port>`, with files
such as `djinn.js` and the `.wasm` from `--public <dir>`; a development server, one request at a time). A page the
client takes over loads `<script type="module" src="/djinn.js" data-wasm="/app.wasm">`; `Html.set_client` changes the
paths. (A server or static app whose public directory holds an `app.js`, or that is given `--program`, loads the
JavaScript islands instead.)

In the browser the app runs in the page by mode: `client` builds the DOM, `hydrate` adopts the server's HTML without
creating a node (it builds its tree without touching the page, then claims each server node in document order), and
`server` / `static` pages adopt only their `[Client]` islands. After that it is all fine-grained updates:

- `Dom` reports every change to `DomHost` (empty natively). The web host turns them into operations in a buffer of
  32-bit words and `djinn.js` applies the batch in one call after each entry into the program (an event, a timer, a
  frame). A region (`if`, `for`) is a pair of comments, `<!--[-->` ... `<!--]-->`, as the server writes it.
- Events are delegated from the document to the nearest node the program made, and bubble through `Dom.dispatch`.
  A click that navigates cancels the browser's default. Fields send their value back (`input`, `change`), keys go
  through `Input.deliver` (the listeners and `Hotkeys`; the browser keeps editing, Tab and scrolling), focus follows
  the page.
- The router starts at the page's path, pushes the address bar on `navigate` and follows back and forward.
  `Timers`, `Animation` and the `Outlet` transitions run on animation frames; CSS transitions are the browser's.
- The CSS the native engine uses is sent as one `<style data-djinn>` (the server's is kept when hydrating); layout,
  text and painting are the browser's, so none of that code runs on the web.
- The rules of the HTML writer apply to the DOM too: invalid tags and attribute names, `on...` and `srcdoc` never
  reach the page, and dangerous URLs become `about:invalid#blocked`.

`tests/djinnc/ui_web.sh` builds all of it and runs `tests/web/ui` under Node.js on a small DOM
(`tests/web/fake_dom.js`): client rendering, hydration, islands, the static site and `examples/ui-web` end to end.
Not yet on this add-on: island props (see below, they exist on the JavaScript target), a mismatch between
the page and the program is reported but not repaired, and `Serve` handles one request at a time.

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
- Text fields: a host calls `Input.typed(code_point)` for every character the keyboard produces (Windows: `WM_CHAR`).
  The focused `input` / `textarea` (not disabled or readonly, not a checkbox, radio, button, ...) inserts it into its
  `value` attribute at the caret, replacing the selection, and fires `input`. `Edit` (`libs/ui/src/input/edit.djinn`)
  keeps a caret and a selection (byte offsets on character boundaries): Left / Right / Home / End move it (Shift
  extends the selection), Backspace and Delete remove, Ctrl+A selects all, Ctrl+C / X / V use the clipboard (a newline
  in pasted text becomes a space; fields are single line). A host places the caret from a pointer press with
  `Edit.click(id, x, extend)` and extends it while dragging with `Edit.drag(id, x)`. The painter draws the value
  (bullets for `type="password"`), the selection, the `placeholder` when empty, and the caret while focused.
- Clipboard: `Clipboard.install(provider)` connects the system clipboard (`win32` does it in `WinClipboard.install`,
  UTF-16 text converted to UTF-8). Without a provider the text lives in the process only.

## Kit

`libs/ui/src/kit/kit.djinn` holds ready-made components, styled by the default theme (same look on every platform):
`Button` (`variant` "primary" / "danger"), `Switch` and `Checkbox` (bound to a `signal<bool>`), `Tab` + `TabPanel` (a
`signal<i32>` holds the selected index), `Dialog` (a `signal<bool>` shows it) and `Field` (binds a `signal<str>` both ways with `value={sig}`; label, hint, placeholder,
`type`). They are plain structs with props as fields, used from `html!{}` like any component, and their state is
exposed through `aria-checked`, `aria-selected`, `data-active` and `data-open`, which the theme styles. Not yet: a
select / menu, tooltip, tables, and two-way binding of a field's value to a signal.

## More kit components

`Select` (`label`, `options=["One", "Two", "Three"]`, `index` signal), `Menu` (`label`, `items=["Open", "Save"]`, `on_pick(i32)`, `keep_label` to keep the label instead of showing the last pick),
`Tooltip` (`text`, children; shows on hover or focus), `List` / `Item`, `Table` / `Row` (`header`; cells share the
width) and `Navigator` (`routes=["/=Home", "/settings=Settings"]`, marks the current page with `aria-current`). The popups
close when you choose and on Escape; `List` and `Table` scroll past 16rem (the `.scroll` class). `Pointer`
(`libs/ui/src/input/hit.djinn`) keeps `:hover` and `:active` on the tree: the host calls `Pointer.move(id)`,
`press(id)` and `release()` as the mouse does, which is also what the tooltip and the hover colors use.

## shadcn components

`libs/ui/src/kit/shadcn.djinn` ports the rest of the shadcn/ui set to the Djinn theme (same source on every native host and on the web target): `Card` with `CardHeader`, `CardTitle`, `CardDescription`,
`CardContent`, `CardFooter`; `Badge` (`variant` "", "secondary", "destructive", "outline"); `Alert` (`title`, `description`, `variant` "" / "destructive"); `Separator`
(`vertical`); `Skeleton` (`wide`, `pulse` for the looping fade, which keeps the window redrawing); `Progress` (`value` 0-100, drawn in steps of 5); `Avatar` (`initials`); `Label`; `Kbd`; `Toggle` (`pressed` signal, `variant` "outline");
`RadioGroup` (`options=["S", "M", "L"]`, `index` signal); `AccordionItem` (`title`, `open`) and `Breadcrumb` (`items=["Home", "Docs", "Page"]`). Also `Collapsible`, `Popover` (button + floating panel), `AlertDialog` (`confirm`, `on_confirm`), `Sheet` (`side` "right" / "left" / "top" / "bottom"), `Pagination` (`pages`, `page` signal), `Slider` (0-100 in steps of 5: click the track, or Left / Right / Home / End) and `Textarea` (binds a `signal<str>` like `Field`; natively it edits as one line for now). They are styled by the tokens (`--ui-*`), so an app restyles them like the rest.

## Router and animation

`Router` (`libs/ui/src/router/router.djinn`) keeps a history of paths: `Router.start(path)`, `navigate`, `back`,
`forward`, `peek()` and the reactive `path()`, plus `Router.matches("/users/:id", path)` (`:name` segments, a trailing
`*`, query and fragment ignored) and `Router.param(pattern, path, "id")`. `Outlet` rebuilds its page from
`view(path)` after every navigation and `Link` navigates without leaving the app (Enter or a click).

`Animation` (`libs/ui/src/anim/animation.djinn`) is a small tween clock: `Animation.fade_in(id, ms)` /
`fade(id, from, to, ms)` animate the opacity of an element (cubic ease-out, no relayout); the host calls
`Animation.advance(ms)` each loop iteration and draws while it returns true (the Windows host does). With
`prefers-reduced-motion` they are skipped. The `Outlet` fades each new page in over 280 ms while it slides in 28 px from the side it came from (right going forward, left going back) with a spring, and the page it replaces fades out underneath it. Motion is on by default: the theme gives buttons, links, inputs, switches, checkboxes and rows a CSS
`transition` of `--ui-motion` (160 ms) on background-color, border-color and color, so hover, press and selection ease
instead of jumping (`transition: <props> <time>` is supported for those colors and opacity; the time is what counts).
Dialogs and popups (`data-open`) fade in and fade out, then hide (`data-gone`); a tab panel fades in. All of it
is skipped under reduced motion. `Animation.fade_out(id, ms)` fades an element out and then sets `data-gone="true"` (the theme hides it with
display: none); `Transition` (a `signal<bool>` shows it) wraps content with that. `transform` is supported (`scale(n)`, `translate(x, y)`, `translateX/Y`, `rotate(angle)`, around `transform-origin`, the center by default) and moves with a damped spring
(about 5% overshoot, interruptible) over its own time: `transition: transform 360ms` (the theme's `--ui-spring`). It is applied to
the geometry the element drew, so it never relayouts (hit testing follows the scale, rotation and translation). The theme uses it for
the press feedback on buttons (scale .97) and the sliding switch thumb; dialogs and popups also pop in from 96% with a spring.
`VirtualList` (`count`, `item_height`, `height` in CSS px, `row` builds the row for an index) mounts only the rows in view plus three of overscan above and below, so a list of 100 000 rows costs a dozen nodes; rows are positioned with the `style` attribute, which the style engine now reads ("name: value; ..." declarations that win over the sheets; no custom properties). A container tells its listeners when it scrolls (the `scroll` event).

Scroll thumbs can be dragged with the pointer (a thumb gets a little margin to grab and darkens while held).

`@keyframes` and `animation` (`name duration [linear] [infinite | n] [alternate] [forwards]`) animate `opacity` and `transform`
without relayout; a property a keyframe omits keeps the element's own value, and `prefers-reduced-motion` skips them.

Not yet: skew, shared-element page transitions, keyframes for other properties, hit testing through a running animation.

Scrolling glides like the system's: in the native host the wheel, the arrow / Page / Home / End keys and focus changes move a
goal and the offset eases to it (`Scroll.set_smooth(true)`, advanced by `Animation.advance`); it lands at once without that and
under reduced motion. A page wider than the window scrolls sideways by default (horizontal wheel, Shift + wheel, Left / Right).
In the Windows host the extra mouse buttons go back / forward through the router, and Escape closes a `Dialog`.
`Timers.every(ms, handler)` / `Timers.every_mounted` run a handler on the host clock (a handler that sets a signal drives
looping transitions; see the Motion page of `examples/ui-native`). Not yet: rubber-band overscroll, an inline `style` attribute.

## Navigation

One set of components for every target (`libs/ui/src/kit/navigation.djinn`, shared with the web build): they look and move the same
natively and on the web, and only their arrangement follows the screen. Routes are written as in `Navigator`: `"/=Home|/settings=Settings"`.

- `Stack { titles }`: a header with a Back button (visible only when there is a page to go back to) and the title of the route, over its
  content (put an `Outlet` inside). Pages slide in from the side the navigation went.
- `Drawer { title, routes, open, collapsed }`: a menu of routes. From 56.25rem wide it is a column that collapses to a rail of initials
  (`collapsed`); below that it hides behind a menu button and slides over the content with a scrim (`open`).
- `TabBar { routes }`: the tabs of an app, one per route: along the bottom edge below 43.75rem (the bottom navigator), along the top above.
- `Stepper { steps, finish, step, can_next, on_finish }` with `Step { index, step }` inside: a wizard. `can_next` holds the user on a
  step until it is valid; steps slide in from the side the wizard moved.

Keys follow the platform (`navigation_keys.djinn`, `Hotkeys`, `Device.apple()`): Alt+Left / Alt+Right go back and forward (Command+[ and
Command+] on macOS and iOS), the Back and Forward keys of a remote control work everywhere, Ctrl+B / Command+B toggles the menu, Left / Right /
Home / End walk the tabs and Up / Down / Home / End the menu entries, PageDown / PageUp move the wizard (ignored while typing). Ctrl+Tab cycles
the tabs where the platform lets the page have it (browsers keep it). Tab and Shift+Tab walk the controls. With **no pointer** (`pointer: none`,
`Styles.set_no_pointer(true)`; a TV or a kiosk) the arrow keys move focus to the nearest control in that direction (`Focus.move_direction`).
Bindings belong to the component that made them and go away with it.

**Prefetch.** A `Link` that is hovered or focused (`prefetch="eager"`: as soon as it is shown, `prefetch="off"`: never) asks for its page: the
outermost `Outlet`'s view builds it off screen and the finished page waits in a cache of 8 pages, shown at once when the user arrives
(`Prefetch.request`, `has`, `clear`). `Prefetch.enable(false)` turns it all off, `Prefetch.skip("/pattern")` opts a route out, and
`Prefetch.on_request(fn)` lets an app warm its data. The view must be free of side effects other than building the page; an `Outlet` inside a
prefetched page is rebuilt for its path on arrival.

**Responsive theme.** Breakpoints are in `rem`, so they follow the user's font size and the OS text scale. Media features: `min/max-width`,
`min/max-height`, `orientation`, `hover`, `pointer: coarse | fine | none`, `prefers-*`, `forced-colors`. Profiles: the default (phone and desktop),
larger targets from 120rem, and `pointer: none` (a TV: larger text, spacing and targets, a safe margin, a stronger focus ring).
`data-form="tv|phone|panel"` on the root forces a profile when the size alone says the wrong thing (a small IoT panel, a TV that reports a desktop
size). Hairlines (1-2 px borders, outlines) stay absolute on purpose.

**Only what changes moves.** `<Outlet groups=["/navigation/*", "/routing/*"]>`: routes of one group share a page, so moving inside a group
(a tab, a menu entry) keeps the page, its state and its animation, and only the inner `Outlet` changes. Without `groups` every path is its own page.

**Motion and shape.** Durations are calm: 320 ms to appear, 220 ms to leave, 440 ms for a page (`--ui-motion`, `--ui-spring`, `--ui-slide`).
`transform` moves with a spring unless a transition names an easing (`transition: transform var(--ui-slide) ease-out`, as the drawer does, so
it never overshoots). `corner-shape: squircle` draws continuous, Apple-style corners (the theme sets it through `--ui-corner`; pills and circles
stay round, and `corner-shape: round` opts an element out), the same natively and in Chrome.

### Known gap: state shared between components
There is no context, provider or store yet. A `signal<T>` is a global handle, so state is shared by passing the signal to the components that
need it (or keeping it in a static, as `Router` does), but there is no scope for a subtree (`provide` / `inject`), no store with selectors or
derived state, and no persistence. Navigation does not depend on it. This is planned (see the task list); it should be designed before apps grow.

## Hotkeys

`Hotkeys.on("Mod+Shift+P", scope, handler)` binds a shortcut and returns its id (0 when the combo is not valid or is
already taken in an overlapping scope; `Hotkeys.conflicts(combo, scope)` asks first); `Hotkeys.off(id)` removes it.
Combos are modifiers joined by `+` and a key (`Ctrl`, `Shift`, `Alt`, `Meta` / `Cmd`, and `Mod`, which is Ctrl or, after
`Hotkeys.use_command(true)`, Command; keys are letters, digits, `F1`..`F12`, `Enter`, `Escape`, `Space`, `Tab`,
`Backspace`, `Delete`, `Home`, `End`, arrows, `,` `.` `/` `-` `=`). Spaces make a sequence, `"g i"`: each key within one
second of the last. A binding with a scope fires only while `Hotkeys.push_scope(name)` has that scope on top (`pop_scope`
leaves it); the empty scope is global. `Input.press` offers every press to the bindings after the `keydown` listeners
and before the default actions; a match runs the handler (as one reactive batch) and consumes the press. Shortcuts
without Ctrl, Alt or Meta are ignored while a text field has focus, and Ctrl+A / C / X / V stay with the field.

## Scrolling

An element with `overflow: auto` or `scroll` scrolls its content when it does not fit; the window scrolls when the
document is taller than it. Offsets live in `Scroll` (`libs/ui/src/input/scroll.djinn`): `Scroll.top(id)` /
`left(id)`, `set`, `by`, `max_y` / `max_x`, `into_view(id)` (the minimum movement that shows an element), `wheel(x, y,
dy)` (the innermost container under the point that can still move takes the delta, then the ones around it, then the
page) and `key(focused, key)` for PageUp / PageDown / Home / End / Up / Down. The painter draws the content shifted
(no relayout), clips it and draws the thumbs; `Hit.at(x, y)` finds the element under a point following every
offset. Tab scrolls the newly focused element into view. The Windows host feeds the mouse wheel.

Scroll bars take room the way a browser's classic bars do, so a page lays out the same natively and on the web: a
container with `overflow: scroll`, or `auto` whose content is taller than the box, keeps a strip at the right of its
padding box (15 px, 10 with `scrollbar-width: thin`, none with `none`), and a document taller than the window is laid
out again without the strip of the page bar. `scrollbar-color` colors the thumb and the track. The theme asks for thin
bars everywhere with the control border color as the thumb. Thumbs (the page's too) can be dragged and a click on the
track pages.

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
