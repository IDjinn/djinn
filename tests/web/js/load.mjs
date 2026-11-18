// Each island is taken over when its [Client(load: ...)] says (libs/ui, "Loading islands"):
//   node load.mjs <app.js> <index.html>
import { readFileSync } from "node:fs";
import { load, check } from "./run.mjs";

const [, , program, pagePath] = process.argv;
const page = readFileSync(pagePath, "utf8").replaceAll("\r\n", "\n");

check(page.includes('data-load="load"') && page.includes('data-load="idle"') && page.includes('data-load="interaction"'), "the server writes the strategy of each island");
check(!/data-component="Seen"[^>]*data-load/.test(page), "and nothing for the default one (visible)");
check(!/data-load="visible"/.test(page), "visible is never written");

const observers = [];
const idle = [];
const extra = {
    IntersectionObserver: class {
        constructor(callback, options) { this.callback = callback; this.options = options; this.element = null; this.gone = false; observers.push(this); }
        observe(element) { this.element = element; }
        disconnect() { this.gone = true; }
    },
    requestIdleCallback: (callback) => { idle.push(callback); },
};
const { document, warnings } = load(program, "/", page, extra);
const click = (name) => document.fire("click", document.querySelector(`[class="${name}"]`).childNodes[0]);
const text = (name) => document.querySelector(`[class="${name}"]`).textContent;
check(warnings.length === 0, `no warnings (${warnings.join("; ")})`);

// load: alive at once
click("now");
check(text("now") === "now 1", "load: alive at once");
// the others wait
click("seen"); click("later"); click("touched");
check(text("seen") === "seen 0" && text("later") === "later 0" && text("touched") === "touched 0", "visible, idle and interaction islands are not alive before their moment");
check(observers.length === 1 && idle.length === 1, "one observer and one idle callback were asked for");
check(observers[0].element !== null && observers[0].element.localName !== "dj-island", "visible: the island's own element (display: contents, no box) is not what is watched");

// visible: when the observer says so, and the observer is released
observers[0].callback([{ isIntersecting: false }]);
click("seen");
check(text("seen") === "seen 0", "visible: not while it is out of view");
observers[0].callback([{ isIntersecting: true }]);
check(observers[0].gone, "visible: the observer is released");
click("seen");
check(text("seen") === "seen 1", "visible: alive when it comes into view");

// idle
idle[0]();
click("later");
check(text("later") === "later 1", "idle: alive when the browser is idle");

// interaction: the first event on it, and only on it
document.fire("pointerdown", document.querySelector("[class=\"later\"]"));
click("touched");
check(text("touched") === "touched 0", "interaction: an event on another island does not count");
document.fire("pointerdown", document.querySelector("[class=\"touched\"]"));
click("touched");
check(text("touched") === "touched 1", "interaction: alive after the first event on it");

// without IntersectionObserver the default is to take the island over at once
{
    const fallback = load(program, "/", page, {});
    fallback.document.fire("click", fallback.document.querySelector("[class=\"seen\"]").childNodes[0]);
    check(fallback.document.querySelector("[class=\"seen\"]").textContent === "seen 1", "visible falls back to load when the browser cannot observe");
}

// a window without a size (a hidden pane) never reports an island as visible: it is taken over at once
{
    const hidden = load(program, "/", page, { ...extra, innerHeight: 0, innerWidth: 0 });
    hidden.document.fire("click", hidden.document.querySelector("[class=\"seen\"]").childNodes[0]);
    check(hidden.document.querySelector("[class=\"seen\"]").textContent === "seen 1", "visible: a window of no size takes the island at once");
}

console.log("PASS load");
