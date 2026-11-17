// Hydration: the page the native build wrote is adopted by the web build without creating a node, and then it is
// as alive as a client-rendered one. With 'islands' only the [Client] islands of a server page are adopted.
import { readFileSync } from "node:fs";
import { Document, serialize } from "../fake_dom.js";
import { run } from "../../../runtime/web/djinn.js";
import { check } from "./support.mjs";

const [, , page, wasm, kind] = process.argv;
const document = new Document();
document.load(readFileSync(page, "utf8"));
const before = serialize(document.body);
globalThis.location = { pathname: "/", search: "", hash: "" };
const warnings = [];
console.warn = (message) => warnings.push(message);

check(document.querySelector("script[data-wasm]"), "the page loads the program");
await run(wasm, { document });
const byId = (id) => document.getElementById(id);

check(warnings.length === 0, `the page matches the program (${warnings.join("; ")})`);
// the only nodes made are text nodes: empty ones the server could not write, and splits of texts the parser joined
check(document.createdElements === 0, `hydration creates no element or marker (created ${document.createdElements})`);
check(serialize(document.body) === before, "hydration leaves the page as it was");

if (kind === "islands") {
    document.fire("click", byId("like"));
    check(byId("like").textContent === "1 likes", "the island is alive");
    check(byId("static").textContent === "rendered once", "the rest stays the server's");
    console.log("PASS islands");
} else {
    document.fire("click", byId("inc"));
    check(byId("count").textContent === "2", "a click updates the adopted text");
    check(byId("parity").localName === "small", "the region swaps its branch in place");
    check(byId("count").nextSibling.data === "clicks", "the text next to it is kept");
    const input = document.querySelector("input");
    input.value = "page";
    document.fire("input", input);
    check(byId("echo").textContent === "hello page!", "the adopted field binds its signal");
    check(byId("report") && byId("report").textContent === "Report Q4", "the [Server] part keeps the server's HTML");
    check(byId("tasks").childNodes.filter((node) => node.nodeType === 1).length === 2, "the list is adopted");
    console.log("PASS hydrate");
}
