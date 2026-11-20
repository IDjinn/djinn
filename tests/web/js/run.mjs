// Runs a program compiled with --target web (one .js file) on the fake DOM, as a browser would run its <script>.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import vm from "node:vm";
import { Document } from "../fake_dom.js";

export function load(path, startPath = "/", page = null, extra = {}) {
    const document = new Document();
    if (page !== null) document.load(page);
    const warnings = [];
    const location = { pathname: startPath, search: "", hash: "" };
    const windowListeners = new Map();
    const output = [];
    const context = {
        document,
        location,
        history: {
            pushed: [],
            pushState(state, title, path) { this.pushed.push(path); location.pathname = path; },
            back() { this.pushed.pop(); location.pathname = this.pushed[this.pushed.length - 1] || startPath; for (const listener of windowListeners.get("popstate") || []) listener({}); },
        },
        addEventListener(type, listener) {
            if (!windowListeners.has(type)) windowListeners.set(type, []);
            windowListeners.get(type).push(listener);
        },
        matchMedia: () => ({ matches: false }),
        performance: { now: () => 0 },
        setTimeout,
        clearTimeout,
        ...extra,
        console: { log: (line) => output.push(line), error: console.error, warn: (message) => warnings.push(message) },
    };
    // the program is an ES module that imports its runtime (system code, a file next to it): both run here as scripts
    const source = readFileSync(path, "utf8");
    const runtime = /^import "\.\/(djinn\.[0-9a-f]+\.js)";$/m.exec(source);
    if (!runtime) throw new Error(`${path} does not import its runtime`);
    const program = source.replace(runtime[0], "");
    vm.createContext(context);
    vm.runInContext(readFileSync(join(dirname(path), runtime[1]), "utf8"), context, { filename: runtime[1] });
    vm.runInContext(program, context, { filename: path });
    return { document, location, history: context.history, output, warnings };
}

// Lets the program's timers run (a page that leaves is removed after its fade, as natively).
export function settle(milliseconds = 600) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function check(condition, message) {
    if (!condition) {
        console.error(`FAIL ${message}`);
        process.exit(1);
    }
}
