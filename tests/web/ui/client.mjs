// The web host of libs/ui in client mode: the page is built from nothing, events reach the listeners, a field binds
// both ways, the router drives the address bar, and unsafe URLs never reach the DOM.
import { Document, serialize } from "../fake_dom.js";
import { run } from "../../../runtime/web/djinn.js";
import { check, waitFrames } from "./support.mjs";

const document = new Document();
const location = { pathname: "/", search: "", hash: "" };
const pushed = [];
globalThis.location = location;
globalThis.history = { pushState: (state, title, path) => { pushed.push(path); location.pathname = path; } };

const program = await run(process.argv[2], { document, location });
const byId = (id) => document.getElementById(id);

check(byId("count") && byId("count").textContent === "1", "the counter shows its start");
check(byId("parity").localName === "b" && byId("parity").textContent === "odd", "1 is odd");
check(document.querySelector("style[data-djinn]") && document.querySelector("style[data-djinn]").textContent.includes("--ui-"), "the theme is in a <style>");

document.fire("click", byId("inc"));
check(byId("count").textContent === "2", "a click updates the count");
check(byId("parity").localName === "small" && byId("parity").textContent === "even", "the region swapped its branch");

document.fire("click", byId("inc").firstChild ?? byId("inc"));
check(byId("count").textContent === "3", "a click on a child reaches the button");

const input = document.querySelector("input");
check(input && input.value === "world", "the field shows the signal");
input.value = "djinn";
document.fire("input", input);
check(byId("echo").textContent === "hello djinn", "typing sets the signal");

check(byId("where").textContent === "/", "the router starts at the page's path");
const click = document.fire("click", byId("go"));
check(byId("where").textContent === "/about", "navigating updates the view");
check(pushed.includes("/about"), "navigating pushes the address bar");
check(click.defaultPrevented, "a click that navigates cancels the browser's default");

check(byId("bad").getAttribute("href") === "about:invalid#blocked", "a javascript: URL is blocked");

check(!serialize(document.body).includes("dj-invalid"), "no invalid tags");
await waitFrames(program);
console.log("PASS client");
