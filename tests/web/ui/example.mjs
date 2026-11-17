// examples/ui-web end to end: a page of the static site (written natively with --out) is hydrated by the web build,
// then the router changes page, a field is typed into and a todo is added, with no update the page cannot apply.
import { readFileSync } from "node:fs";
import { Document } from "../fake_dom.js";
import { run } from "../../../runtime/web/djinn.js";
import { check } from "./support.mjs";

const [, , page, wasm] = process.argv;
const document = new Document();
document.load(readFileSync(page, "utf8"));
globalThis.location = { pathname: "/", search: "", hash: "" };
globalThis.history = { pushState: (state, title, path) => { location.pathname = path; } };
const warnings = [];
console.warn = (message) => warnings.push(message);
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const program = await run(wasm, { document });
let died = null;
program.exited.catch((error) => { died = error; });
check(document.createdElements === 0, "the static page is adopted");

document.fire("click", document.getElementById("inc"));
check(document.getElementById("count").textContent === "1", "the hydrated counter counts");

document.fire("click", document.querySelector('a[href="/todos"]'));
check(location.pathname === "/todos", "the link navigates");
await wait(600);
check(document.querySelectorAll("h1").map((h) => h.textContent).join() === "Todos", "the old page leaves after its fade");

const input = document.querySelector("input");
input.value = "ship";
document.fire("input", input);
document.fire("click", document.getElementById("add"));
const items = document.getElementById("todos").childNodes.filter((node) => node.nodeType === 1).map((node) => node.textContent);
check(items.join() === "hydrate the page,write the static site,ship", `the todo is added (${items.join()})`);
check(input.value === "", "the field is cleared");
check(died === null, `the program is alive (${died && died.message})`);
check(warnings.length === 0, `no update was lost (${warnings.join("; ")})`);
console.log("PASS example");
process.exit(0);
