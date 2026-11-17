// Runs a program compiled with --target web (one .js file) on the fake DOM, as a browser would run its <script>.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { Document } from "../fake_dom.js";

export function load(path, startPath = "/") {
    const document = new Document();
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
        console: { log: (line) => output.push(line), error: console.error },
    };
    vm.runInNewContext(readFileSync(path, "utf8"), context, { filename: path });
    return { document, location, history: context.history, output };
}

// Lets the program's timers run (a page that leaves is removed after its fade, as natively).
export function settle(milliseconds = 300) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function check(condition, message) {
    if (!condition) {
        console.error(`FAIL ${message}`);
        process.exit(1);
    }
}
