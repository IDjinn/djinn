// The host of a Djinn program compiled for the web (wasm32): loads the module, provides the imports of the "djinn"
// module (console, clock, timers, number formatting, math and the DOM host of libs/ui) and drives the event loop.
// No dependencies; runs in browsers and in Node.js.
//
//   import { run } from "./djinn.js";
//   const program = await run("app.wasm");           // a URL, a path (Node), bytes or a WebAssembly.Module
//   const code = await program.exited;               // when main (and an async main) finished
//
// In a page, <script type="module" src="djinn.js" data-wasm="app.wasm"></script> runs the program by itself.

const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

class DjinnExit extends Error {
    constructor(code) {
        super(`exit ${code}`);
        this.code = code;
    }
}

export class DjinnPanic extends Error {}

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// The exact decimal value of a finite positive double: value = digits * 10^-scale.
function exactDecimal(value) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const high = view.getUint32(0);
    const low = view.getUint32(4);
    const biased = (high >>> 20) & 0x7ff;
    let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    let exponent;
    if (biased === 0) {
        exponent = -1074;
    } else {
        mantissa |= 1n << 52n;
        exponent = biased - 1075;
    }
    if (exponent >= 0) {
        return { digits: mantissa << BigInt(exponent), scale: 0 };
    }
    return { digits: mantissa * 5n ** BigInt(-exponent), scale: -exponent };
}

// Drops 'count' decimal digits of n, rounding half to even (what C's printf does with the exact value).
function dropDigits(n, count) {
    if (count <= 0) {
        return n * 10n ** BigInt(-count);
    }
    const unit = 10n ** BigInt(count);
    let quotient = n / unit;
    const rest = n % unit;
    const twice = rest * 2n;
    if (twice > unit || (twice === unit && (quotient & 1n) === 1n)) {
        quotient += 1n;
    }
    return quotient;
}

function fixed(value, precision) {
    const { digits, scale } = exactDecimal(value);
    const rounded = dropDigits(digits, scale - precision).toString();
    if (precision === 0) {
        return rounded;
    }
    const padded = rounded.padStart(precision + 1, "0");
    return `${padded.slice(0, padded.length - precision)}.${padded.slice(padded.length - precision)}`;
}

function scientificParts(value, precision) {
    if (value === 0) {
        return { mantissa: "0".repeat(precision + 1), exponent: 0 };
    }
    const { digits, scale } = exactDecimal(value);
    const length = digits.toString().length;
    let exponent = length - 1 - scale;
    let rounded = dropDigits(digits, length - (precision + 1)).toString();
    if (rounded.length > precision + 1) {
        rounded = rounded.slice(0, precision + 1);
        exponent += 1;
    }
    return { mantissa: rounded, exponent };
}

function scientific(value, precision, alternate) {
    const { mantissa, exponent } = scientificParts(value, precision);
    const point = precision > 0 || alternate ? "." : "";
    const sign = exponent < 0 ? "-" : "+";
    return `${mantissa[0]}${point}${mantissa.slice(1)}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

function general(value, precision, alternate) {
    const significant = precision === 0 ? 1 : precision;
    const exponent = value === 0 ? 0 : scientificParts(value, significant - 1).exponent;
    let text;
    if (exponent >= -4 && exponent < significant) {
        text = fixed(value, significant - 1 - exponent);
    } else {
        text = scientific(value, significant - 1, alternate);
    }
    if (!alternate && text.includes(".")) {
        const at = text.indexOf("e");
        const body = at < 0 ? text : text.slice(0, at);
        const tail = at < 0 ? "" : text.slice(at);
        text = body.replace(/0+$/, "").replace(/\.$/, "") + tail;
    }
    return text;
}

export function formatDouble(value, precision, conversion) {
    const alternate = (conversion & 0x100) !== 0;
    const letter = String.fromCharCode(conversion & 0xff);
    const upper = letter === letter.toUpperCase();
    const negative = value < 0 || Object.is(value, -0);
    const magnitude = Math.abs(value);
    let text;
    if (Number.isNaN(value)) {
        text = "nan";
    } else if (!Number.isFinite(value)) {
        text = "inf";
    } else {
        switch (letter.toLowerCase()) {
            case "f":
                text = fixed(magnitude, precision);
                if (alternate && precision === 0) text += ".";
                break;
            case "e":
                text = scientific(magnitude, precision, alternate);
                break;
            default:
                text = general(magnitude, precision, alternate);
                break;
        }
    }
    if (upper) text = text.toUpperCase();
    return (negative && !Number.isNaN(value) ? "-" : "") + text;
}

function parseDouble(text) {
    const lower = text.trim().toLowerCase();
    const negative = lower.startsWith("-");
    const body = lower.replace(/^[+-]/, "");
    if (body.startsWith("inf")) return negative ? -Infinity : Infinity;
    if (body.startsWith("nan")) return NaN;
    return Number(lower);
}

// ── Math the C library has and JavaScript's Math does not ───────────────────────────────────────────────────────────

const lanczos = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

function gamma(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    x -= 1;
    let a = lanczos[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += lanczos[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

function logGamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
    x -= 1;
    let a = lanczos[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += lanczos[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// erf by its positive series for small x and erfc by a continued fraction (modified Lentz) for large x.
function erfc(x) {
    if (x < 0) return 2 - erfc(-x);
    if (x < 2.5) return 1 - erf(x);
    let f = x, c = x, d = 0;
    for (let n = 1; n < 300; n++) {
        const an = n / 2;
        d = x + an * d;
        d = d === 0 ? 1e-300 : 1 / d;
        c = x + an / c;
        if (c === 0) c = 1e-300;
        const delta = c * d;
        f *= delta;
        if (Math.abs(delta - 1) < 1e-16) break;
    }
    return Math.exp(-x * x) / (f * Math.sqrt(Math.PI));
}

function erf(x) {
    if (x < 0) return -erf(-x);
    if (x >= 2.5) return 1 - erfc(x);
    let term = x, sum = x;
    for (let n = 1; n < 200; n++) {
        term *= (2 * x * x) / (2 * n + 1);
        sum += term;
        if (term < sum * 1e-17) break;
    }
    return (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum;
}

function ieeeRemainder(a, b) {
    const n = a / b;
    let rounded = Math.round(n);
    if (Math.abs(n - Math.trunc(n)) === 0.5) rounded = 2 * Math.round(n / 2);
    return a - rounded * b;
}

const unary = [Math.sin, Math.cos, Math.tan, Math.asin, Math.acos, Math.atan, Math.sinh, Math.cosh, Math.tanh,
    Math.asinh, Math.acosh, Math.atanh, Math.exp, (x) => Math.pow(2, x), Math.expm1, Math.log, Math.log10, Math.log2,
    Math.log1p, Math.cbrt, erf, erfc, gamma, logGamma];
const binary = [Math.atan2, Math.pow, Math.hypot, ieeeRemainder, (a, b) => a % b];

// ── The program ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class DjinnProgram {
    constructor(options = {}) {
        this.options = options;
        this.instance = null;
        this.exports = null;
        this.timer = null;
        this.lines = ["", "", ""];
        this.dom = null;
        this.exitCode = null;
        this.exited = new Promise((resolve, reject) => {
            this.resolveExit = resolve;
            this.rejectExit = reject;
        });
    }

    memory() {
        return new Uint8Array(this.exports.memory.buffer);
    }

    text(pointer, length) {
        return decoder.decode(this.memory().subarray(pointer, pointer + length));
    }

    cstring(pointer) {
        const bytes = this.memory();
        let end = pointer;
        while (bytes[end] !== 0) end++;
        return decoder.decode(bytes.subarray(pointer, end));
    }

    // A copy of 'value' in the program's memory (UTF-8, terminated); the caller frees it with djinn_free.
    allocate(value) {
        const bytes = encoder.encode(value);
        const pointer = this.exports.djinn_alloc(bytes.length + 1);
        const memory = this.memory();
        memory.set(bytes, pointer);
        memory[pointer + bytes.length] = 0;
        return { pointer, length: bytes.length };
    }

    write(fd, pointer, length) {
        const bytes = this.memory().slice(pointer, pointer + length);
        if (this.options.write) {
            this.options.write(fd, bytes);
            return;
        }
        if (isNode) {
            (fd === 2 ? process.stderr : process.stdout).write(bytes);
            return;
        }
        let pending = this.lines[fd] + decoder.decode(bytes);
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
            (fd === 2 ? console.error : console.log)(pending.slice(0, newline));
            pending = pending.slice(newline + 1);
        }
        this.lines[fd] = pending;
    }

    finish(code) {
        if (this.exitCode !== null) return;
        this.exitCode = code;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.resolveExit(code);
    }

    tick() {
        this.timer = null;
        this.call(() => this.exports.djinn_tick());
    }

    // Runs a call into the program and then applies what it changed in the page (libs/ui) in one go.
    call(body) {
        const result = this.guard(body);
        if (this.exports.ui_flush && this.exitCode === null) {
            const wants = this.guard(() => this.exports.ui_flush());
            if (wants && this.dom) this.dom.requestFrame();
        }
        return result;
    }

    // Runs a call into the program; a panic or a trap rejects 'exited' instead of escaping into the caller.
    guard(call) {
        try {
            return call();
        } catch (error) {
            if (error instanceof DjinnExit) {
                this.finish(error.code);
                return undefined;
            }
            if (this.exitCode === null) {
                this.exitCode = 134;
                this.rejectExit(error);
            }
            if (!(error instanceof DjinnPanic) && this.options.onTrap) this.options.onTrap(error);
            return undefined;
        }
    }

    imports() {
        const program = this;
        const djinn = {
            console_write: (fd, pointer, length) => program.write(fd, pointer, length),
            now_ms: () => performance.now(),
            unix_ms: () => Date.now(),
            timer_set: (milliseconds) => {
                if (program.timer !== null) clearTimeout(program.timer);
                program.timer = setTimeout(() => program.tick(), Math.max(0, Math.ceil(milliseconds)));
            },
            panic: (pointer, length) => {
                throw new DjinnPanic(program.text(pointer, length));
            },
            exit: (code) => {
                throw new DjinnExit(code);
            },
            format_f64: (value, precision, conversion, out, capacity) => {
                const bytes = encoder.encode(formatDouble(value, precision, conversion));
                const length = Math.min(bytes.length, capacity - 1);
                program.memory().set(bytes.subarray(0, length), out);
                program.memory()[out + length] = 0;
                return length;
            },
            parse_f64: (pointer, length) => parseDouble(program.text(pointer, length)),
            math1: (op, x) => unary[op](x),
            math2: (op, a, b) => binary[op](a, b),
        };
        if (DjinnProgram.domImports) Object.assign(djinn, DjinnProgram.domImports(program));
        return { djinn };
    }

    async instantiate(source) {
        const module = await loadModule(source);
        this.instance = await WebAssembly.instantiate(module, this.imports());
        this.exports = this.instance.exports;
        return this;
    }

    start() {
        const code = this.call(() => this.exports.main(0, 0));
        if (this.exitCode !== null) return this;
        this.call(() => this.exports.djinn_tick());
        // A page keeps running after main returns (its listeners, timers and frames call back in).
        if (this.exitCode === null && !this.exports.djinn_main_pending() && !this.exports.ui_flush) {
            this.finish(code ?? 0);
        }
        if (this.exitCode === null && this.exports.ui_flush) {
            this.mainResult = code ?? 0;
        }
        return this;
    }
}

// ── The DOM host of libs/ui ─────────────────────────────────────────────────────────────────────────────────────────
//
// The program sends batches of operations (libs/ui/src/view/dom_host.web.djinn, WebOp): nodes are created, filled
// and moved by id. A fragment (a region of 'if' or 'for') is a pair of comments, <!--[--> and <!--]-->, with its
// children between them, as the server writes it. Events are delegated: one listener per event type on the document
// finds the nearest node the program made and calls ui_dispatch.

const OP = {
    ELEMENT: 1, TEXT: 2, FRAGMENT: 3, ISLAND: 4, SLOT: 5, RAW: 6, SET_TEXT: 7, SET_ATTR: 8, REMOVE_ATTR: 9, INSERT: 10,
    REMOVE: 11, LISTEN: 12, STYLE: 13, HISTORY: 14, FOCUS: 15, CLAIM: 16, CLAIM_END: 17, DOCUMENT: 18,
};
const KIND = { ELEMENT: 1, TEXT: 2, FRAGMENT: 3, ISLAND: 4, SLOT: 5, RAW: 6 };
const HOST_EVENTS = new Set(["input", "change", "keydown", "keyup", "focus", "blur"]);
const NAMED_KEYS = {
    Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Pause: 19, CapsLock: 20, Escape: 27, " ": 32,
    PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Insert: 45,
    Delete: 46, Meta: 91, ContextMenu: 93,
};

export function virtualKey(event) {
    if (NAMED_KEYS[event.key] !== undefined) return NAMED_KEYS[event.key];
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) return 111 + Number(event.key.slice(1));
    if (event.code && /^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3);
    if (event.code && /^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
    if (event.key && event.key.length === 1) return event.key.toUpperCase().charCodeAt(0);
    return 0;
}

export class DomHost {
    constructor(program, doc) {
        this.program = program;
        this.doc = doc;
        this.nodes = new Map();
        this.events = new Set();
        this.names = new Map();
        this.style = null;
        this.frame = 0;
        this.frames = [];
        this.islands = null;
        this.mismatches = 0;
        this.listenHost();
    }

    get exports() {
        return this.program.exports;
    }

    // A text the program reads during a call, kept for the life of the page (event names).
    name(text) {
        let entry = this.names.get(text);
        if (!entry) {
            entry = this.program.allocate(text);
            this.names.set(text, entry);
        }
        return entry;
    }

    tag(node, id) {
        node.__djinn = id;
        return node;
    }

    entry(id) {
        const entry = this.nodes.get(id);
        if (!entry) throw new Error(`djinn: the page has no node #${id}`);
        return entry;
    }

    // An update for a node the page does not have (a bug in the program or a page that did not match): reported
    // once, and the rest of the batch still applies.
    known(id) {
        if (this.nodes.has(id)) return true;
        if (!this.warnedMissing) console.warn(`djinn: an update for node #${id}, which the page does not have, was skipped`);
        this.warnedMissing = true;
        return false;
    }

    // The DOM nodes of an entry, in order: one node, or the range of a fragment with its markers.
    domNodes(entry) {
        if (entry.kind !== KIND.FRAGMENT) return [entry.node];
        const nodes = [];
        for (let node = entry.start; node; node = node.nextSibling) {
            nodes.push(node);
            if (node === entry.end) break;
        }
        return nodes;
    }

    firstNode(entry) {
        return entry.kind === KIND.FRAGMENT ? entry.start : entry.node;
    }

    element(id, tag) {
        if (tag === "html") {
            this.nodes.set(id, { kind: KIND.ELEMENT, node: this.tag(this.doc.documentElement, id), container: this.doc.body });
            return;
        }
        this.nodes.set(id, { kind: KIND.ELEMENT, node: this.tag(this.doc.createElement(tag), id) });
    }

    fragment(id) {
        const holder = this.doc.createDocumentFragment();
        const start = this.tag(this.doc.createComment("["), id);
        const end = this.tag(this.doc.createComment("]"), id);
        holder.appendChild(start);
        holder.appendChild(end);
        this.nodes.set(id, { kind: KIND.FRAGMENT, start, end });
    }

    raw(id, html) {
        const template = this.doc.createElement("template");
        template.innerHTML = html;
        const holder = this.doc.createDocumentFragment();
        const start = this.tag(this.doc.createComment("["), id);
        const end = this.tag(this.doc.createComment("]"), id);
        holder.appendChild(start);
        holder.appendChild(template.content);
        holder.appendChild(end);
        this.nodes.set(id, { kind: KIND.FRAGMENT, start, end });
    }

    insert(parentId, childId, beforeId) {
        const parent = this.entry(parentId);
        const child = this.entry(childId);
        let container;
        let reference;
        if (parent.kind === KIND.FRAGMENT) {
            container = parent.end.parentNode;
            reference = beforeId ? this.firstNode(this.entry(beforeId)) : parent.end;
        } else {
            container = parent.container || parent.node;
            reference = beforeId ? this.firstNode(this.entry(beforeId)) : null;
        }
        for (const node of this.domNodes(child)) container.insertBefore(node, reference);
    }

    forget(node) {
        if (node.__djinn !== undefined && this.nodes.get(node.__djinn)) {
            const entry = this.nodes.get(node.__djinn);
            if (entry.node === node || entry.start === node) this.nodes.delete(node.__djinn);
        }
        for (let child = node.firstChild; child; child = child.nextSibling) this.forget(child);
    }

    remove(id) {
        const entry = this.nodes.get(id);
        if (!entry) return;
        for (const node of this.domNodes(entry)) {
            this.forget(node);
            if (node.parentNode) node.parentNode.removeChild(node);
        }
        this.nodes.delete(id);
    }

    setAttribute(id, name, value) {
        const node = this.entry(id).node;
        try {
            node.setAttribute(name, value);
        } catch {
            return;
        }
        if (name === "value" && "value" in node && node.value !== value) node.value = value;
        if (name === "checked" && "checked" in node) node.checked = true;
        if (name === "selected" && "selected" in node) node.selected = true;
    }

    removeAttribute(id, name) {
        const node = this.entry(id).node;
        node.removeAttribute(name);
        if (name === "checked" && "checked" in node) node.checked = false;
        if (name === "value" && "value" in node) node.value = "";
    }

    setStyle(css) {
        if (!this.style) {
            this.style = this.doc.querySelector("style[data-djinn]");
            if (!this.style) {
                this.style = this.doc.createElement("style");
                this.style.setAttribute("data-djinn", "");
                (this.doc.head || this.doc.documentElement).appendChild(this.style);
            }
        }
        if (this.style.textContent !== css) this.style.textContent = css;
    }

    history(path) {
        const location = globalThis.location;
        const history = globalThis.history;
        if (!location || !history || !history.pushState) return;
        if (location.pathname + location.search + location.hash === path || location.pathname + location.search === path) return;
        history.pushState(null, "", path);
    }

    focus(id) {
        const node = this.entry(id).node;
        if (this.doc.activeElement !== node && node.focus) node.focus();
    }

    // ── Hydration: a cursor walks the HTML the server sent, in step with the program's tree ──

    claimNext(kind, text) {
        const frame = this.frames[this.frames.length - 1];
        // Islands come in document order whether the page around them is adopted (hydrate) or not (server pages).
        if (kind === KIND.ISLAND) {
            if (!this.islands) this.islands = Array.from(this.doc.querySelectorAll("dj-island"));
            const island = this.islands.shift() || null;
            if (island && frame && frame.next === island) frame.next = island.nextSibling;
            return island;
        }
        if (!frame) return null;
        let node = frame.next;
        if (kind === KIND.TEXT) {
            if (node && node.nodeType === 3) {
                if (node.data.length > text.length && node.data.startsWith(text) && text.length > 0) {
                    node.splitText(text.length);
                }
                if (node.data === text) {
                    frame.next = node.nextSibling;
                    return node;
                }
            }
            if (text.length === 0) {
                const empty = this.doc.createTextNode("");
                frame.parent.insertBefore(empty, node || null);
                return empty;
            }
            return null;
        }
        if (kind === KIND.FRAGMENT) {
            if (node && node.nodeType === 8 && node.data === "[") {
                frame.next = node.nextSibling;
                return node;
            }
            return null;
        }
        if (node && node.nodeType === 1) {
            frame.next = node.nextSibling;
            return node;
        }
        return null;
    }

    claim(id, kind, text) {
        const node = this.claimNext(kind, text);
        if (!node) {
            this.mismatches++;
            if (this.mismatches === 1) console.warn(`djinn: the page does not match the program at node #${id} (${text || kind})`);
            return;
        }
        this.tag(node, id);
        if (kind === KIND.TEXT) {
            this.nodes.set(id, { kind: KIND.TEXT, node });
            return;
        }
        if (kind === KIND.FRAGMENT) {
            this.frames.push({ id, kind, parent: node.parentNode, next: node.nextSibling, start: node });
            return;
        }
        this.nodes.set(id, { kind: KIND.ELEMENT, node });
        if (kind === KIND.SLOT || kind === KIND.RAW) return;
        this.frames.push({ id, kind, parent: node, next: node.firstChild });
    }

    claimEnd(id) {
        const frame = this.frames.pop();
        if (!frame) return;
        if (frame.kind === KIND.FRAGMENT) {
            let end = frame.next;
            if (!(end && end.nodeType === 8 && end.data === "]")) {
                this.mismatches++;
                end = this.doc.createComment("]");
                frame.parent.insertBefore(end, frame.next || null);
            }
            this.tag(end, id);
            this.nodes.set(id, { kind: KIND.FRAGMENT, start: frame.start, end });
            const outer = this.frames[this.frames.length - 1];
            if (outer) outer.next = end.nextSibling;
        }
    }

    // ── Applying a batch ──

    apply(wordsAt, count, bytesAt) {
        const buffer = this.program.exports.memory.buffer;
        const words = new Uint32Array(buffer, wordsAt, count);
        const bytes = new Uint8Array(buffer);
        let at = 0;
        const text = () => {
            const offset = words[at++];
            const length = words[at++];
            return decoder.decode(bytes.subarray(bytesAt + offset, bytesAt + offset + length));
        };
        while (at < count) {
            const op = words[at++];
            const id = words[at++];
            switch (op) {
                case OP.ELEMENT: this.element(id, text()); break;
                case OP.TEXT: this.nodes.set(id, { kind: KIND.TEXT, node: this.tag(this.doc.createTextNode(text()), id) }); break;
                case OP.FRAGMENT: this.fragment(id); break;
                case OP.ISLAND:
                case OP.SLOT: {
                    const node = this.tag(this.doc.createElement(op === OP.ISLAND ? "dj-island" : "dj-server"), id);
                    node.setAttribute("data-component", text());
                    this.nodes.set(id, { kind: KIND.ELEMENT, node });
                    break;
                }
                case OP.RAW: this.raw(id, text()); break;
                case OP.SET_TEXT: { const value = text(); if (this.known(id)) this.entry(id).node.data = value; break; }
                case OP.SET_ATTR: { const name = text(); const value = text(); if (this.known(id)) this.setAttribute(id, name, value); break; }
                case OP.REMOVE_ATTR: { const name = text(); if (this.known(id)) this.removeAttribute(id, name); break; }
                case OP.INSERT: { const child = words[at++]; const before = words[at++]; this.insert(id, child, before); break; }
                case OP.REMOVE: this.remove(id); break;
                case OP.LISTEN: this.listen(text()); break;
                case OP.STYLE: this.setStyle(text()); break;
                case OP.HISTORY: this.history(text()); break;
                case OP.FOCUS: this.focus(id); break;
                case OP.CLAIM: { const kind = words[at++]; this.claim(id, kind, text()); break; }
                case OP.CLAIM_END: this.claimEnd(id); break;
                case OP.DOCUMENT:
                    this.nodes.set(id, { kind: KIND.ELEMENT, node: this.tag(this.doc.documentElement, id), container: this.doc.body });
                    this.frames = [{ id, kind: KIND.ELEMENT, parent: this.doc.body, next: this.doc.body.firstChild }];
                    break;
                default: throw new Error(`djinn: unknown DOM operation ${op}`);
            }
        }
    }

    // ── Events ──

    idOf(target) {
        for (let node = target; node; node = node.parentNode) {
            if (node.__djinn !== undefined && node.nodeType === 1) return node.__djinn;
        }
        return 0;
    }

    listen(type) {
        if (HOST_EVENTS.has(type) || this.events.has(type)) return;
        this.events.add(type);
        this.doc.addEventListener(type, (event) => {
            const id = this.idOf(event.target);
            if (!id) return;
            const { pointer, length } = this.name(type);
            const prevent = this.program.call(() => this.exports.ui_dispatch(id, pointer, length));
            if (prevent) event.preventDefault();
        });
    }

    listenHost() {
        const value = (type) => (event) => {
            const target = event.target;
            const id = this.idOf(target);
            if (!id || target.__djinn !== id || !("value" in target)) return;
            const typed = this.program.allocate(String(target.value));
            const { pointer, length } = this.name(type);
            this.program.call(() => this.exports.ui_input(id, typed.pointer, typed.length, pointer, length));
            this.exports.djinn_free(typed.pointer);
        };
        this.doc.addEventListener("input", value("input"));
        this.doc.addEventListener("change", value("change"));
        this.doc.addEventListener("keydown", (event) => {
            const mods = (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0);
            const prevent = this.program.call(() => this.exports.ui_key(virtualKey(event), mods));
            if (prevent) event.preventDefault();
        });
        this.doc.addEventListener("focusin", (event) => {
            const id = this.idOf(event.target);
            if (id) this.program.call(() => this.exports.ui_focus(id));
        });
        this.doc.addEventListener("focusout", (event) => {
            const id = this.idOf(event.target);
            if (id) this.program.call(() => this.exports.ui_blur(id));
        });
        const window = this.doc.defaultView || globalThis;
        if (window && window.addEventListener) {
            window.addEventListener("popstate", () => {
                const path = this.program.allocate(globalThis.location.pathname + globalThis.location.search);
                this.program.call(() => this.exports.ui_popstate(path.pointer, path.length));
                this.exports.djinn_free(path.pointer);
            });
        }
    }

    requestFrame() {
        if (this.frame) return;
        const request = globalThis.requestAnimationFrame || ((callback) => setTimeout(() => callback(performance.now()), 16));
        this.frame = request((now) => {
            this.frame = 0;
            this.program.call(() => this.exports.ui_frame(now));
        });
    }
}

DjinnProgram.domImports = (program) => ({
    dom_apply: (words, count, bytes) => {
        if (!program.dom) program.dom = new DomHost(program, program.options.document || globalThis.document);
        program.dom.apply(words, count, bytes);
    },
    dom_location: (out, capacity) => {
        const location = program.options.location || globalThis.location;
        const path = location ? location.pathname + (location.search || "") : "/";
        const bytes = encoder.encode(path);
        const length = Math.min(bytes.length, capacity);
        program.memory().set(bytes.subarray(0, length), out);
        return length;
    },
});

async function loadModule(source) {
    if (source instanceof WebAssembly.Module) return source;
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return WebAssembly.compile(source);
    if (isNode && !/^https?:/.test(String(source))) {
        const { readFile } = await import("node:fs/promises");
        return WebAssembly.compile(await readFile(source instanceof URL ? source : String(source)));
    }
    const response = fetch(source);
    if (WebAssembly.compileStreaming) {
        try {
            return await WebAssembly.compileStreaming(response);
        } catch {
            // a server that does not send application/wasm
        }
    }
    return WebAssembly.compile(await (await fetch(source)).arrayBuffer());
}

export async function run(source, options = {}) {
    const program = new DjinnProgram(options);
    await program.instantiate(source);
    return program.start();
}

if (!isNode && typeof document !== "undefined") {
    const script = document.querySelector("script[data-wasm]");
    const wasm = script && script.dataset && script.dataset.wasm;
    if (wasm) {
        run(new URL(wasm, document.baseURI)).then((program) => program.exited).catch((error) => console.error(error));
    }
}
