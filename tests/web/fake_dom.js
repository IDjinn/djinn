// A small DOM for testing the web host of libs/ui under Node.js without dependencies: nodes, attributes, events that
// bubble to the document, a serializer, and a parser for the HTML the Djinn HTML writer produces. It also counts the
// nodes created, so a test can check that hydration adopted the server's nodes instead of making new ones.

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "source", "wbr"]);
const RAW_TEXT = new Set(["style", "script"]);

export class Node {
    constructor(document, nodeType) {
        this.ownerDocument = document;
        this.nodeType = nodeType;
        this.parentNode = null;
        this.childNodes = [];
    }

    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }

    get nextSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.childNodes;
        return siblings[siblings.indexOf(this) + 1] || null;
    }

    get previousSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.childNodes;
        return siblings[siblings.indexOf(this) - 1] || null;
    }

    insertBefore(node, reference) {
        if (node.nodeType === 11) {
            for (const child of [...node.childNodes]) this.insertBefore(child, reference);
            return node;
        }
        if (node.parentNode) node.parentNode.removeChild(node);
        const at = reference ? this.childNodes.indexOf(reference) : -1;
        if (reference && at < 0) throw new Error("insertBefore: the reference is not a child");
        if (at < 0) this.childNodes.push(node);
        else this.childNodes.splice(at, 0, node);
        node.parentNode = this;
        return node;
    }

    appendChild(node) { return this.insertBefore(node, null); }

    removeChild(node) {
        const at = this.childNodes.indexOf(node);
        if (at < 0) throw new Error("removeChild: not a child");
        this.childNodes.splice(at, 1);
        node.parentNode = null;
        return node;
    }

    remove() { if (this.parentNode) this.parentNode.removeChild(this); }

    append(...nodes) { for (const node of nodes) this.appendChild(node); }

    prepend(...nodes) { const first = this.firstChild; for (const node of nodes) this.insertBefore(node, first); }

    replaceChildren(...nodes) { for (const child of [...this.childNodes]) this.removeChild(child); this.append(...nodes); }

    // Listeners on any node; Document.fire calls them from the target up to the document (bubbling).
    addEventListener(type, listener) {
        if (!this.listeners) this.listeners = new Map();
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    get textContent() {
        if (this.nodeType === 3 || this.nodeType === 8) return this.data;
        return this.childNodes.map((child) => (child.nodeType === 8 ? "" : child.textContent)).join("");
    }

    set textContent(value) {
        for (const child of [...this.childNodes]) this.removeChild(child);
        if (value !== "") this.appendChild(this.ownerDocument.createTextNode(String(value)));
    }
}

export class Text extends Node {
    constructor(document, data) {
        super(document, 3);
        this.data = data;
    }

    splitText(offset) {
        const rest = this.ownerDocument.createTextNode(this.data.slice(offset));
        this.data = this.data.slice(0, offset);
        if (this.parentNode) this.parentNode.insertBefore(rest, this.nextSibling);
        return rest;
    }
}

export class Comment extends Node {
    constructor(document, data) {
        super(document, 8);
        this.data = data;
    }
}

export class DocumentFragment extends Node {
    constructor(document) {
        super(document, 11);
    }
}

export class Element extends Node {
    constructor(document, tag) {
        super(document, 1);
        this.localName = tag.toLowerCase();
        this.tagName = this.localName.toUpperCase();
        this.attributes = new Map();
        this.value = "";
        this.checked = false;
        this.selected = false;
        if (this.localName === "template") this.content = new DocumentFragment(document);
    }

    setAttribute(name, value) {
        if (!/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(name)) throw new Error(`InvalidCharacterError: '${name}'`);
        this.attributes.set(name, String(value));
        if (name === "value") this.value = String(value);
    }

    get className() { return this.getAttribute("class") || ""; }
    set className(value) { this.setAttribute("class", value); }

    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    get dataset() { return Object.fromEntries([...this.attributes].filter(([k]) => k.startsWith("data-")).map(([k, v]) => [k.slice(5), v])); }

    focus() { this.ownerDocument.setFocus(this); }

    set innerHTML(html) {
        const target = this.localName === "template" ? this.content : this;
        for (const child of [...target.childNodes]) target.removeChild(child);
        for (const node of parseFragment(this.ownerDocument, html)) target.appendChild(node);
    }

    get innerHTML() { return this.childNodes.map(serialize).join(""); }
    get outerHTML() { return serialize(this); }
}

export class Document extends Node {
    constructor() {
        super(null, 9);
        this.ownerDocument = this;
        this.created = 0;
        this.createdElements = 0;
        this.listeners = new Map();
        this.activeElement = null;
        this.documentElement = new Element(this, "html");
        this.head = new Element(this, "head");
        this.body = new Element(this, "body");
        this.documentElement.append(this.head, this.body);
        this.appendChild(this.documentElement);
    }

    createElement(tag) { this.created++; this.createdElements++; return new Element(this, tag); }
    createTextNode(data) { this.created++; return new Text(this, data); }
    createComment(data) { this.created++; this.createdElements++; return new Comment(this, data); }
    createDocumentFragment() { return new DocumentFragment(this); }

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    // Fires an event at 'target': the listeners of the target and of its ancestors run, then the document's.
    fire(type, target, fields = {}) {
        const event = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
        for (let node = target; node && node !== this; node = node.parentNode) {
            for (const listener of (node.listeners && node.listeners.get(type)) || []) listener(event);
        }
        for (const listener of this.listeners.get(type) || []) listener(event);
        return event;
    }

    setFocus(element) {
        if (this.activeElement === element) return;
        const previous = this.activeElement;
        this.activeElement = element;
        if (previous) this.fire("focusout", previous);
        if (element) this.fire("focusin", element);
    }

    walk(predicate, from = this.documentElement, found = []) {
        if (from.nodeType === 1 && predicate(from)) found.push(from);
        for (const child of from.childNodes) this.walk(predicate, child, found);
        return found;
    }

    // Enough of a selector for the host: 'tag', '[attr]', 'tag[attr]', '#id'.
    matcher(selector) {
        const id = /^#([-\w]+)$/.exec(selector);
        if (id) return (element) => element.getAttribute("id") === id[1];
        const parts = /^([-\w]*)(?:\[([-\w]+)(?:="([^"]*)")?\])?$/.exec(selector);
        if (!parts) throw new Error(`fake_dom: unsupported selector '${selector}'`);
        const [, tag, attribute, value] = parts;
        return (element) => (!tag || element.localName === tag) && (!attribute || (element.hasAttribute(attribute)
            && (value === undefined || element.getAttribute(attribute) === value)));
    }

    querySelector(selector) { return this.walk(this.matcher(selector))[0] || null; }
    querySelectorAll(selector) { return this.walk(this.matcher(selector)); }
    getElementById(id) { return this.querySelector(`#${id}`); }

    // Loads a whole page (doctype, html, head and body) written by the HTML writer.
    load(html) {
        const nodes = parseFragment(this, html.replace(/^<!doctype html>/i, ""));
        const root = nodes.find((node) => node.nodeType === 1 && node.localName === "html");
        if (!root) throw new Error("fake_dom: the page has no <html>");
        this.removeChild(this.documentElement);
        this.documentElement = root;
        this.appendChild(root);
        this.head = root.childNodes.find((node) => node.localName === "head") || this.head;
        this.body = root.childNodes.find((node) => node.localName === "body") || this.body;
        this.created = 0;
        this.createdElements = 0;
    }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#34": '"' };

function decode(text) {
    return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name) => {
        if (ENTITIES[name] !== undefined) return ENTITIES[name];
        if (name[0] === "#") return String.fromCodePoint(name[1] === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
        return whole;
    });
}

function escapeText(text) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttribute(text) { return escapeText(text).replace(/"/g, "&quot;"); }

export function parseFragment(document, html) {
    const root = new DocumentFragment(document);
    const stack = [root];
    let at = 0;
    const top = () => stack[stack.length - 1];
    while (at < html.length) {
        if (html.startsWith("<!--", at)) {
            const end = html.indexOf("-->", at + 4);
            top().appendChild(document.createComment(html.slice(at + 4, end)));
            at = end + 3;
        } else if (html.startsWith("</", at)) {
            const end = html.indexOf(">", at);
            const tag = html.slice(at + 2, end).trim().toLowerCase();
            while (stack.length > 1 && top().localName !== tag) stack.pop();
            if (stack.length > 1) stack.pop();
            at = end + 1;
        } else if (html[at] === "<" && /[A-Za-z]/.test(html[at + 1] || "")) {
            const tagMatch = /^<([A-Za-z][-A-Za-z0-9]*)/.exec(html.slice(at));
            const element = document.createElement(tagMatch[1]);
            at += tagMatch[0].length;
            for (;;) {
                const attribute = /^\s+([^\s=>\/]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/.exec(html.slice(at));
                if (!attribute) break;
                element.setAttribute(attribute[1], decode(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""));
                at += attribute[0].length;
            }
            const close = html.indexOf(">", at);
            const selfClosing = html[close - 1] === "/";
            at = close + 1;
            top().appendChild(element);
            if (RAW_TEXT.has(element.localName)) {
                const end = html.toLowerCase().indexOf(`</${element.localName}>`, at);
                if (end > at) element.appendChild(document.createTextNode(html.slice(at, end)));
                at = end + element.localName.length + 3;
            } else if (!VOID.has(element.localName) && !selfClosing) {
                stack.push(element);
            }
        } else {
            const next = html.indexOf("<", at + 1);
            const end = next < 0 ? html.length : next;
            top().appendChild(document.createTextNode(decode(html.slice(at, end))));
            at = end;
        }
    }
    return [...root.childNodes];
}

export function serialize(node) {
    if (node.nodeType === 3) return escapeText(node.data);
    if (node.nodeType === 8) return `<!--${node.data}-->`;
    if (node.nodeType === 11 || node.nodeType === 9) return node.childNodes.map(serialize).join("");
    const attributes = [...node.attributes].map(([name, value]) => (value === "" ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`)).join("");
    if (VOID.has(node.localName)) return `<${node.localName}${attributes}>`;
    const inner = RAW_TEXT.has(node.localName) ? node.textContent : node.childNodes.map(serialize).join("");
    return `<${node.localName}${attributes}>${inner}</${node.localName}>`;
}
