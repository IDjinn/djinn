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

// DOM: a Node of the bindings is a real DOM node; a region (if, for, a dynamic child) is the nodes between its
// creation point and an empty text node that marks its end.
const $child = (parent, child) => { parent.appendChild(child); return parent; };
const $text = (parent, value) => { parent.appendChild(document.createTextNode(value)); return parent; };
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
  const node = document.createTextNode("");
  parent.appendChild(node);
  $effect(() => { const value = $str(fn()); if (node.data !== value) node.data = value; });
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
  if (typeof node !== "object") node = document.createTextNode($str(node));
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

// The application: the theme stylesheet goes into <head> (unless the server already sent it), and the app is mounted
// into #app or <body> (CLIENT), or, for a page the server rendered (HYDRATE, SERVER, STATIC), rendered again in
// place of the server's markup.
const $mountApp = (render, mode, theme) => {
  if (!document.querySelector("style[data-djinn]")) {
    const style = document.createElement("style");
    style.setAttribute("data-djinn", "theme");
    style.textContent = theme;
    document.head.prepend(style);
  }
  const target = document.getElementById("app") || document.body;
  $root(() => {
    const node = render();
    if (mode !== 0) target.replaceChildren();
    target.appendChild(node);
  });
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
addEventListener("popstate", () => { $direction = -1; $set($path, location.pathname); });
const $navigate = (path, replace) => {
  if ($event && $event.type === "click") $event.preventDefault();
  if (path === $path.value) return;
  if (replace) history.replaceState(null, "", path); else history.pushState(null, "", path);
  $direction = 1;
  $set($path, path);
};
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
const $fade = (node, from, to, duration, slide, done) => {
  if (!node.animate || $reduced()) { if (done) done(); return; }
  const frames = slide ? [{ opacity: from, transform: `translateX(${slide}px)` }, { opacity: to, transform: "none" }] : [{ opacity: from }, { opacity: to }];
  const animation = node.animate(frames, { duration, easing: "ease-out" });
  if (done) animation.onfinish = done;
};
const $present = (node, on) => {
  if (!node.hasAttribute("data-gone")) { node.setAttribute("data-gone", on ? "false" : "true"); return; }
  if (on) { node.setAttribute("data-gone", "false"); $fade(node, 0, 1, 200); }
  else $fade(node, 1, 0, 140, 0, () => node.setAttribute("data-gone", "true"));
};
const $attributeMoved = (node, name, value, existed) => {
  if (name === "data-open") $present(node, value === "true");
  else if (existed && name === "data-active" && value === "true") $fade(node, 0, 1, 200);
};
const $transition = (show, children) => {
  const box = document.createElement("div");
  box.setAttribute("class", "transition");
  if (children) box.appendChild(children);
  $effect(() => $present(box, $read(show)));
  return box;
};
const $outlet = (view) => {
  const box = document.createElement("div");
  box.setAttribute("class", "outlet");
  const region = $region();
  box.appendChild(region.fragment);
  $effect(() => {
    for (const old of region.nodes) {
      if (old.nodeType !== 1 || old.hasAttribute("data-leaving")) continue;
      old.setAttribute("data-leaving", "true");
      $fade(old, 1, 0, 140, 0, () => old.setAttribute("data-gone", "true"));
      setTimeout(() => old.remove(), 260);
    }
    const path = $read($path);
    $untrack(() => {
      const page = document.createElement("div");
      page.setAttribute("class", "route");
      page.appendChild(view(path));
      region.end.parentNode.insertBefore(page, region.end);
      region.nodes = region.nodes.filter((node) => node.parentNode).concat([page]);
      $fade(page, 0, 1, 280, 28 * $direction);
    });
  });
  return box;
};

// Keys: the event being delivered to a "keydown" listener, read through Input.key() / Input.prevent().
const $key = { code: 0, shift: false, ctrl: false, alt: false, event: null, prevent() { if (this.event) this.event.preventDefault(); } };
addEventListener("keydown", (event) => {
  $key.code = event.keyCode; $key.shift = event.shiftKey; $key.ctrl = event.ctrlKey; $key.alt = event.altKey; $key.event = event;
}, true);
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
  const input = root.querySelector ? root.querySelector("input") : null;
  return input ? ($bindValue(input, signal), root) : root;
};
