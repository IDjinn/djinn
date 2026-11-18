// examples/ui-web end to end: the pages of the static site (written natively with --out) are adopted by the JavaScript
// islands. Nothing is created for the HTML, the counter starts at the 5 the server sent, and the list takes a new item.
//   node example.mjs <site dir> <app.js>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "../js/run.mjs";
import { check } from "./support.mjs";

const [, , site, program] = process.argv;
const page = (path) => readFileSync(join(site, path, "index.html"), "utf8").replaceAll("\r\n", "\n");
const immediately = { requestIdleCallback: (run) => run() };

{
    const { document, warnings } = load(program, "/", page("."));
    check(document.createdElements === 0, `the page is adopted, nothing is created (${document.createdElements})`);
    check(warnings.length === 0, `no warning (${warnings.join("; ")})`);
    check(document.getElementById("count").textContent === "5", "the counter starts at the server's 5");
    document.fire("click", document.getElementById("inc"));
    check(document.getElementById("count").textContent === "6", "the island counts");
    check(document.querySelector("h1").textContent === "Home", "the rest of the page is the server's");
    // the theme button starts on the first interaction
    const root = document.documentElement;
    document.fire("click", document.getElementById("theme"));
    check(!root.getAttribute("data-theme"), "an island that waits for an interaction is not alive before one");
    document.fire("pointerdown", document.getElementById("theme"));
    document.fire("click", document.getElementById("theme"));
    check(root.getAttribute("data-theme") !== null, "and is alive after it");
}

{
    const { document, warnings } = load(program, "/todos", page("todos"), immediately);
    check(document.createdElements === 0, `the todos page is adopted (${document.createdElements})`);
    check(warnings.length === 0, `no warning (${warnings.join("; ")})`);
    const input = document.getElementById("draft");
    input.value = "ship";
    document.fire("input", input);
    document.fire("click", document.getElementById("add"));
    const items = document.getElementById("todos").childNodes.filter((node) => node.nodeType === 1).map((node) => node.textContent);
    check(items.join() === "send HTML,take over the islands,ship", `the item is added (${items.join()})`);
    check(input.value === "", "the field is cleared");
}

{
    const { document, warnings } = load(program, "/about", page("about"));
    check(document.getElementById("built").textContent === "Built natively, sent as HTML.", "a [Server] part is as the server sent it");
    check(warnings.length === 0, `no warning (${warnings.join("; ")})`);
}
console.log("PASS example");
process.exit(0);
