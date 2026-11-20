// libs/ui on the web target: fine-grained reactivity and direct DOM building, the browser being the renderer.
// html! lowers markup to calls that the bindings (ui.djinn) turn into calls of these functions, so a component
// renders once, each dynamic part is one computation bound to the one DOM node it changes, and nothing is diffed.

// Reactivity: push-pull with three states, so a write wakes only what read it, a memo propagates only when its
// value changed and a diamond runs its effect once.
const $CLEAN = 0, $CHECK = 1, $DIRTY = 2;
let $observer = null;
let $owner = null;
let $batching = 0;
let $queue = [];

class $Signal {
  constructor(value) { this.value = value; this.observers = []; }
}

class $Computation {
  constructor(fn, memo) {
    this.fn = fn;
    this.memo = memo;
    this.value = undefined;
    this.state = $DIRTY;
    this.sources = [];
    this.observers = memo ? [] : null;
    this.owned = null;
    this.cleanups = null;
    this.disposed = false;
    if ($owner) ($owner.owned || ($owner.owned = [])).push(this);
  }
}

const $track = (source) => {
  if ($observer && !$observer.disposed && $observer.sources[$observer.sources.length - 1] !== source) {
    $observer.sources.push(source);
    source.observers.push($observer);
  }
};

const $unlink = (node) => {
  for (const source of node.sources) {
    const list = source.observers;
    const at = list.lastIndexOf(node);
    if (at >= 0) { list[at] = list[list.length - 1]; list.pop(); }
  }
  node.sources = [];
};

const $clean = (node) => {
  if (node.owned) { for (const child of node.owned) $dispose(child); node.owned = null; }
  if (node.cleanups) { for (const cleanup of node.cleanups) cleanup(); node.cleanups = null; }
};

const $dispose = (node) => {
  node.disposed = true;
  $clean(node);
  if (node.sources) $unlink(node);
};

const $mark = (node, state) => {
  if (node.state >= state || node.disposed) return;
  const was = node.state;
  node.state = state;
  if (node.memo) { if (was === $CLEAN) for (const observer of node.observers) $mark(observer, $CHECK); }
  else if (was === $CLEAN) $queue.push(node);
};

const $run = (node) => {
  $clean(node);
  $unlink(node);
  const savedObserver = $observer, savedOwner = $owner;
  $observer = node; $owner = node;
  let value;
  try { value = node.fn(); } finally { $observer = savedObserver; $owner = savedOwner; }
  node.state = $CLEAN;
  if (node.memo && value !== node.value) {
    node.value = value;
    for (const observer of node.observers) observer.state = $DIRTY;
  } else {
    node.value = value;
  }
};

const $update = (node) => {
  if (node.state === $CHECK) {
    for (const source of node.sources) {
      if (source instanceof $Computation) $update(source);
      if (node.state === $DIRTY) break;
    }
  }
  if (node.state === $DIRTY) $run(node);
  node.state = $CLEAN;
};

const $flush = () => {
  if ($batching > 0) return;
  $batching++;
  try {
    for (let i = 0; i < $queue.length; i++) {
      const node = $queue[i];
      if (!node.disposed && node.state !== $CLEAN) $update(node);
    }
  } finally { $queue = []; $batching--; }
};

const $signal = (value) => new $Signal(value);
const $read = (signal) => { $track(signal); return signal.value; };
const $peek = (signal) => signal.value;
const $set = (signal, value) => {
  if (signal.value === value) return;
  signal.value = value;
  for (const observer of signal.observers) $mark(observer, $DIRTY);
  $flush();
};
const $notify = (signal) => { for (const observer of signal.observers) $mark(observer, $DIRTY); $flush(); };
const $memo = (fn) => { const node = new $Computation(fn, true); $run(node); return node; };
const $memoRead = (node) => { if (node.state !== $CLEAN) $update(node); $track(node); return node.value; };
const $memoPeek = (node) => { if (node.state !== $CLEAN) $update(node); return node.value; };
const $effect = (fn) => { const node = new $Computation(fn, false); $run(node); return node; };
const $untrack = (fn) => { const saved = $observer; $observer = null; try { return fn(); } finally { $observer = saved; } };
const $pause = () => { const saved = $observer; $observer = null; return saved; };
const $resume = (saved) => { $observer = saved; };
const $batch = (fn) => { $batching++; try { fn(); } finally { $batching--; } $flush(); };
const $onCleanup = (fn) => { if ($owner) ($owner.cleanups || ($owner.cleanups = [])).push(fn); };
const $root = (fn) => {
  const node = new $Computation(null, false);
  node.state = $CLEAN;
  const savedOwner = $owner, savedObserver = $observer;
  $owner = node; $observer = null;
  try { fn(); } finally { $owner = savedOwner; $observer = savedObserver; }
  return node;
};

// Adoption: a page the server rendered is not built again. While $adopt is set, $el and $txt hand out the nodes
// the server wrote, in document order, instead of creating new ones; the code that builds the tree then links them
// as it always does. What the server wrote and what the client builds must be the same tree: when they are not, a
// $Mismatch is thrown, and the island it happened in (or, outside any island, the page) is rendered again.
class $Mismatch extends Error {}
let $adopt = null;
const $flatten = (nodes, into) => {
  for (const node of Array.from(nodes)) {
    if (node.nodeType === 8 || (node.nodeType === 1 && node.localName === "script")) continue;
    // a debug page is indented: the line break between two blocks is not something the app renders
    if (node.nodeType === 3 && node.data.includes("\n") && node.data.trim() === "") continue;
    into.push(node);
    if (node.nodeType === 1) $flatten(node.childNodes, into);
  }
  return into;
};
const $el = (tag) => {
  if ($adopt === null) return document.createElement(tag);
  const node = $adopt.list[$adopt.at];
  if (!node || node.nodeType !== 1 || node.localName !== tag) throw new $Mismatch(`expected <${tag}>`);
  $adopt.at++;
  node.replaceChildren();
  return node;
};
const $txt = (value) => {
  if ($adopt === null || value === "") return document.createTextNode(value);
  const node = $adopt.list[$adopt.at];
  if (!node || node.nodeType !== 3 || !node.data.startsWith(value)) throw new $Mismatch(`expected the text '${value}'`);
  if (node.data.length > value.length) $adopt.list.splice($adopt.at + 1, 0, node.splitText(value.length));
  $adopt.at++;
  return node;
};
const $frag = () => document.createDocumentFragment();
// The element of the server's page for a component: kept as it is when 'keep', with everything inside it.
const $claim = (tag, name, keep) => {
  const node = $adopt.list[$adopt.at];
  if (!node || node.nodeType !== 1 || node.localName !== tag || node.getAttribute("data-component") !== name) {
    throw new $Mismatch(`expected <${tag} data-component="${name}">`);
  }
  const inside = $flatten(node.childNodes, []);
  const after = $adopt.list[$adopt.at + 1 + inside.length] || null;
  $adopt.at++;
  if (keep) $adopt.at += inside.length; else node.replaceChildren();
  return { element: node, after };
};
// A [Server] or [Static] component: the client keeps the HTML the server sent for it.
const $serverIsland = (name) => $adopt === null ? $frag() : $claim("dj-server", name, true).element;

// DOM: a Node of the bindings is a real DOM node; a region (if, for, a dynamic child) is the nodes between its
// creation point and an empty text node that marks its end.
const $child = (parent, child) => { parent.appendChild(child); return parent; };
const $text = (parent, value) => { parent.appendChild($txt(value)); return parent; };
const $attr = (node, name, value) => { node.setAttribute(name, value); $attributeMoved(node, name, value, false); return node; };
// The event a listener is running for: a navigation during a click cancels the browser's own (following the href).
let $event = null;
const $on = (node, type, handler) => {
  node.addEventListener(type, (event) => {
    const saved = $event;
    $event = event;
    try { handler(); } finally { $event = saved; }
  });
  return node;
};
const $onValue = (node, handler) => { node.addEventListener("input", (event) => handler(event.target.value)); return node; };
const $bindValue = (node, signal) => {
  $effect(() => { const value = $read(signal); if (node.value !== value) node.value = value; });
  node.addEventListener("input", (event) => $set(signal, event.target.value));
  return node;
};
const $bindChecked = (node, signal) => {
  $effect(() => { node.checked = $read(signal); });
  node.addEventListener("change", (event) => $set(signal, event.target.checked));
  return node;
};
const $setAttr = (node, name, value) => {
  const existed = node.hasAttribute(name);
  if (value === false || value === null || value === undefined) { node.removeAttribute(name); return; }
  const text = value === true ? "" : $str(value);
  node.setAttribute(name, text);
  $attributeMoved(node, name, text, existed);
};
const $attrFn = (node, name, fn) => { $effect(() => $setAttr(node, name, fn())); return node; };
// bind:value={signal} and bind:checked={signal} bind both ways; any other signal sets the attribute.
const $attrSignal = (node, name, fn) => {
  const signal = fn();
  if (name === "bind:value") return $bindValue(node, signal);
  if (name === "bind:checked") return $bindChecked(node, signal);
  $effect(() => $setAttr(node, name, $read(signal)));
  return node;
};
const $attrMemo = (node, name, fn) => { const memo = fn(); $effect(() => $setAttr(node, name, $memoRead(memo))); return node; };
const $insertText = (parent, fn) => {
  let node = null;
  $effect(() => {
    const value = $str(fn());
    if (node === null) { node = $txt(value); parent.appendChild(node); }
    else if (node.data !== value) node.data = value;
  });
  return parent;
};
const $insertSignal = (parent, fn) => $insertText(parent, () => $read(fn()));
const $insertMemo = (parent, fn) => $insertText(parent, () => $memoRead(fn()));

const $region = () => {
  const fragment = document.createDocumentFragment();
  const end = document.createTextNode("");
  fragment.appendChild(end);
  return { fragment, end, nodes: [] };
};
const $collect = (node) => node === null || node === undefined ? [] : node.nodeType === 11 ? Array.from(node.childNodes) : [node];
const $replace = (region, node) => {
  for (const old of region.nodes) old.remove();
  if (node === null || node === undefined) { region.nodes = []; return; }
  if (typeof node !== "object") node = $txt($str(node));
  region.nodes = $collect(node);
  region.end.parentNode.insertBefore(node, region.end);
};
const $insertNode = (parent, fn) => {
  const region = $region();
  parent.appendChild(region.fragment);
  $effect(() => { const node = fn(); $untrack(() => $replace(region, node)); });
  return parent;
};
const $show = (when, yes, no) => {
  const region = $region();
  const condition = $memo(() => !!when());
  $effect(() => {
    const active = $memoRead(condition);
    $untrack(() => $replace(region, active ? yes() : (no ? no() : document.createDocumentFragment())));
  });
  return region.fragment;
};

// A list: one owner per item, reused while its key and its value stay (a new value under the same key rebuilds that
// row only); the nodes are moved only when out of place.
const $list = (items, keyOf, render) => {
  const region = $region();
  let entries = new Map();
  $onCleanup(() => { for (const entry of entries.values()) $dispose(entry.root); });
  $effect(() => {
    const list = items();
    $untrack(() => {
      const next = new Map();
      const ordered = new Array(list.length);
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const key = keyOf(item, i);
        let entry = entries.get(key);
        if (entry !== undefined && !next.has(key)) {
          entries.delete(key);
          if (entry.item !== item) {
            $dispose(entry.root);
            for (const node of entry.nodes) node.remove();
            entry = undefined;
          }
        } else {
          entry = undefined;
        }
        if (entry === undefined) {
          let nodes;
          const root = $root(() => { nodes = $collect(render(item)); });
          entry = { root, nodes, item };
        }
        next.set(key, entry);
        ordered[i] = entry;
      }
      for (const gone of entries.values()) { $dispose(gone.root); for (const node of gone.nodes) node.remove(); }
      const parent = region.end.parentNode;
      let after = region.end;
      for (let i = ordered.length - 1; i >= 0; i--) {
        const nodes = ordered[i].nodes;
        if (nodes.length === 0) continue;
        if (nodes[nodes.length - 1].nextSibling !== after) {
          for (const node of nodes) parent.insertBefore(node, after);
        }
        after = nodes[0];
      }
      entries = next;
    });
  });
  return region.fragment;
};
const $each = (items, key, render) => $list(items, (item) => key(item), render);
const $eachValue = (items, render) => {
  let seen = null;
  return $list(() => { seen = new Map(); return items(); }, (item) => {
    const count = seen.get(item) || 0;
    seen.set(item, count + 1);
    return count === 0 ? item : item + "\u0000" + count;
  }, render);
};
const $range = (start, end, render) => $list(() => {
  const first = start(), last = end();
  const values = [];
  for (let value = first; value < last; value++) values.push(value);
  return values;
}, (value) => value, render);

const $raw = (html) => { const template = document.createElement("template"); template.innerHTML = html; return template.content; };

// Island props: the server writes the values an island was rendered with in data-props (a JSON object). An island
// opens its own <dj-island> (the one the page adopts next) and reads its fields from it; a value that is missing or of
// another type is reported and the declaration's value stays.
let $propValues = null;
const $open = [];
const $propsOpen = (name) => {
  $propValues = null;
  if ($adopt === null) { $open.push(null); return; }
  const frame = $claim("dj-island", name, false);
  $open.push(frame);
  const text = frame.element.getAttribute("data-props");
  if (text === null || text === undefined) return;
  try {
    const parsed = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) $propValues = parsed;
    else console.warn(`djinn: the props of island ${name} are not an object`);
  } catch (error) {
    console.warn(`djinn: the props of island ${name} are not valid JSON`);
  }
};
// The island: its content is built from the server's nodes inside the server's <dj-island>; when that does not match,
// only this island is built again.
const $island = (name, build) => {
  const frame = $open.pop();
  if (frame === null || frame === undefined) return build();
  const outer = $adopt;
  let content, why = "";
  const root = $root(() => {
    try { content = build(); } catch (error) { if (!(error instanceof $Mismatch)) throw error; content = undefined; why = error.message; }
  });
  if (content === undefined) {
    $dispose(root);
    console.warn(`djinn: island ${name} is not what the server rendered (${why}); it is rendered again`);
    outer.at = frame.after === null ? outer.list.length : outer.list.indexOf(frame.after);
    $adopt = null;
    try { content = build(); } finally { $adopt = outer; }
    frame.element.replaceChildren();
  } else {
    $onCleanup(() => $dispose(root));
  }
  frame.element.appendChild(content);
  return frame.element;
};
const $propRead = (field, fallback, valid) => {
  if ($propValues === null || !Object.prototype.hasOwnProperty.call($propValues, field)) return fallback;
  const value = $propValues[field];
  if (valid(value)) return value;
  console.warn(`djinn: the island prop '${field}' has another type than the declaration's; its value is used`);
  return fallback;
};
const $isBool = (value) => typeof value === "boolean";
const $isI32 = (value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const $isU32 = (value) => Number.isInteger(value) && value >= 0 && value <= 4294967295;
const $isStr = (value) => typeof value === "string";
const $propList = (field, fallback, valid) => $propRead(field, fallback, (value) => Array.isArray(value) && value.every(valid));

// The application: the theme stylesheet goes into <head> (unless the server already sent it), and the app is mounted
// into #app or <body>. A page the server rendered (HYDRATE, SERVER, STATIC) is adopted: its nodes are kept and given
// to the app, which only wires them (see $adopt); a page that is not what the app renders is rendered again.
const $mountApp = (render, mode, theme) => {
  if (!document.querySelector("style[data-djinn]")) {
    const style = document.createElement("style");
    style.setAttribute("data-djinn", "theme");
    style.textContent = theme;
    document.head.prepend(style);
  }
  const target = document.getElementById("app") || document.body;
  const page = mode === 0 ? [] : Array.from(target.childNodes).filter((node) => (node.nodeType === 1 && node.localName !== "script") || (node.nodeType === 3 && node.data.trim() !== ""));
  const mount = () => $root(() => target.appendChild(render()));
  if (page.length === 0) { mount(); return; }
  const list = $flatten(page, []);
  for (const node of page) target.removeChild(node);
  $adopt = { list, at: 0 };
  try {
    $root(() => {
      const node = render();
      if ($adopt.at !== list.length) throw new $Mismatch("the page has more than the app renders");
      target.appendChild(node);
    });
  } catch (error) {
    if (!(error instanceof $Mismatch)) throw error;
    console.warn(`djinn: the page is not what the server rendered (${error.message}); it is rendered again`);
    $adopt = null;
    $open.length = 0;
    mount();
  } finally {
    $adopt = null;
  }
};

// A page only the server renders: the program is its islands. Each <dj-island> of the page is built by the island of
// that name, adopting the server's nodes inside it; an island nobody built a program for is left as the server wrote it.
// When an island is taken over (data-load, from [Client(load: ...)]): 'load' at once; 'visible' (the default) when it
// scrolls near the viewport; 'idle' when the browser has nothing else to do; 'interaction' on the first pointer, touch,
// focus or key event on it (the adoption keeps the server's nodes, so the click that follows finds its listener).
const $whenToMount = (element, strategy, mount) => {
  let done = false;
  const once = () => { if (!done) { done = true; mount(); } };
  if (strategy === "load") {
    once();
  } else if (strategy === "idle") {
    if (typeof requestIdleCallback === "function") requestIdleCallback(once, { timeout: 2000 });
    else setTimeout(once, 200);
  } else if (strategy === "interaction") {
    const events = ["pointerdown", "touchstart", "mouseover", "focusin", "keydown"];
    const start = () => {
      for (const name of events) element.removeEventListener(name, start, true);
      once();
    };
    for (const name of events) element.addEventListener(name, start, true);
  } else if (typeof IntersectionObserver === "function" && (typeof innerHeight !== "number" || (innerHeight > 0 && innerWidth > 0))) {
    // a window without a size (a hidden pane, a background tab) never reports an element as visible: it mounts at once
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { watch.disconnect(); once(); }
    }, { rootMargin: "200px" });
    // <dj-island> is display: contents: it has no box of its own and is never reported, so its children are watched
    const boxes = Array.from(element.children || []);
    if (boxes.length === 0) { once(); return; }
    for (const box of boxes) watch.observe(box);
  } else {
    once();
  }
};

const $mountIslands = (islands) => {
  for (const element of Array.from(document.querySelectorAll("dj-island"))) {
    let inside = false;
    for (let parent = element.parentNode; parent; parent = parent.parentNode) {
      if (parent.localName === "dj-island") inside = true;
    }
    if (inside) continue;
    const name = element.getAttribute("data-component");
    const mount = Object.prototype.hasOwnProperty.call(islands, name) ? islands[name] : null;
    if (mount === null) {
      console.warn(`djinn: the page has an island ${name} and this program has none of that name`);
      continue;
    }
    $whenToMount(element, element.getAttribute("data-load") || "visible", () => {
      $adopt = { list: $flatten([element], []), at: 0 };
      try {
        $root(() => { mount(); });
      } finally {
        $adopt = null;
        $open.length = 0;
      }
    });
  }
};

// Theme: data-theme on <html>; the theme stylesheet follows it with light-dark().
const $theme = {
  set(mode) {
    const root = document.documentElement;
    if (mode === 1) root.setAttribute("data-theme", "light");
    else if (mode === 2) root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
  },
  isDark() {
    const forced = document.documentElement.getAttribute("data-theme");
    if (forced) return forced === "dark";
    return matchMedia("(prefers-color-scheme: dark)").matches;
  },
  toggle() { $theme.set($theme.isDark() ? 1 : 2); },
};

// Router: the path is a signal, links are handled without reloading and the back button works. matches and param
// follow the native rules: '/'-separated segments, ':name' matches any segment, a trailing '*' the rest; the query
// string and the fragment are ignored.
const $path = $signal(location.pathname);
let $direction = 1;
// The position in the history (kept in history.state) tells which way a popstate went and whether there is a page to go back to.
let $index = (history.state && history.state.i) || 0, $max = $index;
addEventListener("popstate", (event) => {
  const at = (event.state && event.state.i) || 0;
  $direction = at < $index ? -1 : 1;
  $index = at; $max = Math.max($max, at);
  $set($path, location.pathname);
});
const $navigate = (path, replace) => {
  if ($event && $event.type === "click") $event.preventDefault();
  if (path === $path.value) return;
  if (replace) history.replaceState({ i: $index }, "", path); else { $index++; $max = $index; history.pushState({ i: $index }, "", path); }
  $direction = 1;
  $set($path, path);
};
// The program reaches these through functions: it cannot read a let of the runtime.
const $canBack = () => $index > 0;
const $canForward = () => $index < $max;
const $getDirection = () => $direction;
const $setDirection = (direction) => { $direction = direction; };
const $segments = (text) => text.replace(/[?#].*$/, "").split("/").filter((part) => part.length > 0);
const $matches = (pattern, path) => {
  const want = $segments(pattern), have = $segments(path);
  for (let i = 0; ; i++) {
    if (i === want.length && i === have.length) return true;
    if (i < want.length && want[i] === "*") return true;
    if (i >= want.length || i >= have.length) return false;
    if (want[i][0] !== ":" && want[i] !== have[i]) return false;
  }
};
const $param = (pattern, path, name) => {
  const want = $segments(pattern), have = $segments(path);
  for (let i = 0; i < want.length && i < have.length; i++) if (want[i] === ":" + name) return have[i];
  return "";
};
const $side = (route, before) => {
  const at = route.indexOf("=");
  if (at < 0) return before ? route : "";
  return before ? route.slice(0, at) : route.slice(at + 1);
};

// Motion, as the native animation system does it: data-open presents or dismisses (fade, then data-gone="true"
// which the theme hides), a tab panel that becomes active fades in, a new page fades and slides in.
const $reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
// Timing, as the native Animation: things appear a little slower than they leave.
const $ENTER = 320, $EXIT = 220, $PAGE = 440;
const $fade = (node, from, to, duration, slide, done) => {
  if (!node.animate || $reduced()) { if (done) done(); return; }
  const frames = slide ? [{ opacity: from, transform: `translateX(${slide}px)` }, { opacity: to, transform: "none" }] : [{ opacity: from }, { opacity: to }];
  const animation = node.animate(frames, { duration, easing: "ease-out" });
  if (done) animation.onfinish = done;
};
const $present = (node, on) => {
  if (!node.hasAttribute("data-gone")) { node.setAttribute("data-gone", on ? "false" : "true"); return; }
  if (on) { node.setAttribute("data-gone", "false"); $fade(node, 0, 1, $ENTER); }
  else $fade(node, 1, 0, $EXIT, 0, () => node.setAttribute("data-gone", "true"));
};
const $attributeMoved = (node, name, value, existed) => {
  if (name === "data-open") $present(node, value === "true");
  else if (existed && name === "data-active" && value === "true") $fade(node, 0, 1, $ENTER, node.hasAttribute("data-slide") ? 24 * $direction : 0);
};
const $transition = (show, children) => {
  const box = $el("div");
  box.setAttribute("class", "transition");
  if (children) box.appendChild(children);
  $effect(() => $present(box, $read(show)));
  return box;
};
// A scrolling list of 'count' rows 'item' px tall in a box 'height' px tall that keeps only the rows in view (and a few
// around them) in the page, each with its own owner: a row keeps its state while it stays and is disposed when it leaves.
const $virtual = (count, item, height, row) => {
  const box = $el("div");
  box.setAttribute("class", "virtual");
  box.setAttribute("role", "list");
  box.style.height = height + "px";
  const space = $el("div");
  space.setAttribute("class", "virtual-space");
  space.style.position = "relative";
  space.style.height = count * item + "px";
  box.appendChild(space);
  const rows = new Map();
  const sync = () => {
    const top = box.scrollTop;
    const first = Math.max(0, Math.floor(top / item) - 3);
    const last = Math.min(count, Math.ceil((top + height) / item) + 3);
    for (const [index, entry] of rows) {
      if (index < first || index >= last) { $dispose(entry.root); entry.node.remove(); rows.delete(index); }
    }
    $untrack(() => {
      for (let index = first; index < last; index++) {
        if (rows.has(index)) continue;
        const node = $el("div");
        node.setAttribute("class", "virtual-row");
        node.setAttribute("role", "listitem");
        node.style.cssText = "position:absolute;left:0;right:0;top:" + index * item + "px;height:" + item + "px";
        const root = $root(() => { node.appendChild(row(index)); });
        space.appendChild(node);
        rows.set(index, { root, node });
      }
    });
  };
  box.addEventListener("scroll", sync, { passive: true });
  $onCleanup(() => { for (const entry of rows.values()) $dispose(entry.root); rows.clear(); });
  sync();
  return box;
};
// Prefetch and prerender: the pages asked for ahead of time wait here (8 at most, the oldest dropped) until the Outlet
// shows them. The view should be free of side effects other than building the page.
const $pf = { off: false, view: null, groups: "", cache: new Map(), skip: [], hook: null, busy: false };
const $prefetchClear = () => { for (const entry of $pf.cache.values()) $dispose(entry.root); $pf.cache.clear(); };
const $prefetchEnable = (on) => { $pf.off = !on; if (!on) $prefetchClear(); };
const $prefetch = (path) => {
  if ($pf.off || !$pf.view || $pf.busy || !path || path === $path.value || $pf.cache.has(path) || $pf.skip.some((pattern) => $matches(pattern, path))) return;
  if ($groupKey($pf.groups, path) === $groupKey($pf.groups, $path.value)) return;
  if ($pf.hook) $pf.hook(path);
  if ($pf.cache.size >= 8) {
    const [oldest, entry] = $pf.cache.entries().next().value;
    $dispose(entry.root);
    $pf.cache.delete(oldest);
  }
  $pf.busy = true;
  const page = $el("div");
  page.setAttribute("class", "route");
  try { const root = $root(() => { page.appendChild($pf.view(path)); }); $pf.cache.set(path, { page, root }); }
  finally { $pf.busy = false; }
};
const $groupKey = (groups, path) => groups.split("|").find((pattern) => pattern.length > 0 && $matches(pattern, path)) ?? path;
const $outlet = (view, groups) => {
  const box = $el("div");
  box.setAttribute("class", "outlet");
  const region = $region();
  box.appendChild(region.fragment);
  if (!$pf.view) { $pf.view = view; $pf.groups = groups || ""; $onCleanup(() => { $prefetchClear(); $pf.view = null; }); }
  let live = null, kept = null;
  $onCleanup(() => { if (live) { $dispose(live); live = null; } });
  $effect(() => {
    // Moving inside a group of routes keeps the page; what is inside it (an Outlet of its own) changes.
    const path = $read($path);
    const key = $groupKey(groups || "", path);
    if (key === kept) return;
    kept = key;
    if (live) { $dispose(live); live = null; }
    for (const old of region.nodes) {
      if (old.nodeType !== 1 || old.hasAttribute("data-leaving")) continue;
      old.setAttribute("data-leaving", "true");
      $fade(old, 1, 0, $EXIT, 0, () => old.setAttribute("data-gone", "true"));
      setTimeout(() => old.remove(), $EXIT + 160);
    }
    $untrack(() => {
      const adopting = $adopt !== null;
      const hit = adopting ? undefined : $pf.cache.get(path);
      if (hit) $pf.cache.delete(path);
      const page = hit ? hit.page : $el("div");
      if (hit) live = hit.root;
      else {
        page.setAttribute("class", "route");
        // The page lives in a root of its own: the effect reruns when the path moves inside a group and must not take
        // the page's effects with it.
        const savedOwner = $owner; $owner = null;
        try { live = $root(() => { page.appendChild(view(path)); }); } finally { $owner = savedOwner; }
      }
      region.end.parentNode.insertBefore(page, region.end);
      region.nodes = region.nodes.filter((node) => node.parentNode).concat([page]);
      if (!adopting) $fade(page, 0, 1, $PAGE, 28 * $direction);
    });
  });
  return box;
};

// Keys: the event being delivered to a "keydown" listener, read through Input.key() / Input.prevent().
const $key = { code: 0, shift: false, ctrl: false, alt: false, event: null, prevent() { if (this.event) this.event.preventDefault(); } };
addEventListener("keydown", (event) => {
  $key.code = event.keyCode; $key.shift = event.shiftKey; $key.ctrl = event.ctrlKey; $key.alt = event.altKey; $key.event = event;
}, true);
// Hotkeys: one step combos ("Mod+B", "Alt+Left", "PageDown"); Mod is Command on Apple systems and Control elsewhere. A
// shortcut without Ctrl, Alt or Meta is ignored while a field has focus, so typing never triggers it.
const $apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const $media = (query) => typeof matchMedia === "function" && matchMedia(query).matches;
const $hk = { mac: $apple, list: [], next: 1 };
const $names = { enter: 13, return: 13, escape: 27, esc: 27, space: 32, tab: 9, backspace: 8, delete: 46, del: 46, home: 36, end: 35,
  left: 37, up: 38, right: 39, down: 40, pageup: 33, pagedown: 34, browserback: 166, browserforward: 167 };
const $keyCode = (name) => {
  const lower = name.toLowerCase();
  if ($names[lower]) return $names[lower];
  if (lower.length === 1) {
    if (lower >= "a" && lower <= "z") return lower.toUpperCase().charCodeAt(0);
    if (lower >= "0" && lower <= "9") return lower.charCodeAt(0);
    return { ",": 188, ".": 190, "/": 191, "-": 189, "=": 187, "[": 219, "]": 221 }[lower] || 0;
  }
  const f = /^f([1-9]|1[0-2])$/.exec(lower);
  return f ? 111 + Number(f[1]) : 0;
};
const $hotkeyOn = (combo, scope, handler) => {
  const parts = combo.trim().split("+");
  const key = $keyCode(parts.pop());
  let mods = 0;
  for (const word of parts) {
    const w = word.toLowerCase();
    mods |= w === "shift" ? 1 : w === "ctrl" || w === "control" ? 2 : w === "alt" || w === "option" ? 4
      : w === "meta" || w === "cmd" || w === "command" || w === "super" ? 8 : w === "mod" ? ($hk.mac ? 8 : 2) : 0;
  }
  if (!key || $hk.list.some((h) => h.key === key && h.mods === mods)) return 0;
  const id = $hk.next++;
  $hk.list.push({ id, key, mods, handler });
  return id;
};
const $hotkeyOff = (id) => { $hk.list = $hk.list.filter((h) => h.id !== id); };
const $typing = (target) => !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
addEventListener("keydown", (event) => {
  if ((event.keyCode >= 16 && event.keyCode <= 18) || event.keyCode === 91 || event.keyCode === 92) return;
  const mods = (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0);
  if ($typing(event.target) && !(mods & 14)) return;
  const hit = $hk.list.find((h) => h.key === event.keyCode && h.mods === mods);
  if (hit) { event.preventDefault(); hit.handler(); }
});
// Focus: Tab order, and with no pointer (a TV) the arrows move to the nearest control in that direction.
const $focusable = () => [...document.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])')]
  .filter((el) => el.offsetParent !== null || el === document.activeElement);
const $focusStep = (backward) => {
  const items = $focusable();
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement);
  items[(at + (backward ? -1 : 1) + items.length) % items.length].focus();
};
addEventListener("keydown", (event) => {
  if (event.keyCode < 37 || event.keyCode > 40 || event.defaultPrevented || $typing(event.target) || !$media("(pointer: none)")) return;
  const items = $focusable(), from = document.activeElement;
  if (!from || from === document.body) { if (items[0]) { items[0].focus(); event.preventDefault(); } return; }
  const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === from) continue;
    const r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - ax, dy = r.top + r.height / 2 - ay;
    const along = event.keyCode === 37 ? -dx : event.keyCode === 39 ? dx : event.keyCode === 38 ? -dy : dy;
    const across = Math.abs(event.keyCode === 37 || event.keyCode === 39 ? dy : dx);
    if (along > 0.5 && along + 2 * across < bestScore) { best = el; bestScore = along + 2 * across; }
  }
  if (best) { best.focus(); event.preventDefault(); }
});
const $onDocument = (type, handler) => {
  const listener = () => handler();
  document.addEventListener(type, listener);
  $onCleanup(() => document.removeEventListener && document.removeEventListener(type, listener));
};

const $styles = new Set();
const $addStyles = (css) => {
  if ($styles.has(css)) return;
  $styles.add(css);
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
};

const $bindField = (root, signal) => {
  if (!signal) return root;
  const input = root.querySelector ? root.querySelector("input, textarea") : null;
  return input ? ($bindValue(input, signal), root) : root;
};
