// examples/web-app compiled with --target web: components, signals, memos, if/for, keyed lists, two-way binding,
// batching, the router and the theme, driven through the DOM like a user would.
import { serialize } from "../fake_dom.js";
import { load, check, settle } from "./run.mjs";

const { document, location, history } = load(process.argv[2]);
const byId = (id) => document.getElementById(id);
const all = (selector) => document.querySelectorAll(selector);
const click = (element) => document.fire("click", element);
const created = () => document.created;

check(document.querySelector("style[data-djinn]")?.textContent.includes("--ui-"), "the theme stylesheet is in <head>");
check(byId("count")?.textContent === "0", "the counter starts at 0");
check(byId("doubled").textContent === "doubled: 0", "the memo starts at 0");
check(!byId("lot"), "the conditional part starts hidden");

const before = created();
click(byId("inc"));
check(byId("count").textContent === "1" && byId("doubled").textContent === "doubled: 2", "a click updates the signal and the memo");
check(created() - before === 2, "one click creates only the new list item and its text (" + (created() - before) + " nodes)");
click(byId("inc"));
click(byId("inc"));
check(byId("lot")?.textContent === "that is a lot of clicks", "the conditional part appears at 3");
check(all("li").map((li) => li.textContent).join(",") === "0,1,4", "the range renders one item per number");
const lot = byId("lot");
click(byId("inc"));
check(byId("lot") === lot, "a branch that stays shown is not rebuilt");
click(byId("reset"));
check(byId("count").textContent === "0" && !byId("lot") && all("li").length === 0, "reset clears everything");

const links = all("a");
check(links.length === 3 && links[0].getAttribute("aria-current") === "page", "the navigator marks the current page");
const navigation = click(links[1]);
check(navigation.defaultPrevented && location.pathname === "/todos", "a link navigates without reloading");
await settle();
check(links[1].getAttribute("aria-current") === "page" && links[0].getAttribute("aria-current") === "false", "the current link follows");
check(!byId("count") && byId("todos"), "the outlet shows the todos page");

const rows = () => all("li").filter((li) => li.parentNode === byId("todos"));
check(rows().length === 2 && byId("left").textContent === "1 left of 2", "the todos start with two items");
const input = byId("draft");
input.value = "  ship it ";
document.fire("input", input);
click(byId("add"));
check(rows().length === 3 && rows()[2].textContent.includes("ship it"), "add appends a todo");
check(input.value === "", "the field is bound both ways and was cleared");
check(byId("left").textContent === "2 left of 3", "the memo counts what is left");

const [first, second, third] = rows();
click(second.childNodes.find((node) => node.className === "check"));
check(rows()[0] === first && rows()[2] === third, "toggling one todo keeps the other rows");
check(rows()[1].className === "todo done" && byId("left").textContent === "1 left of 3", "the toggled row is rebuilt as done");
click(first.childNodes.find((node) => node.className === "remove"));
check(rows().length === 2 && rows()[1] === third, "removing a todo keeps the remaining rows");

click(byId("theme"));
check(document.documentElement.getAttribute("data-theme") === "dark", "the theme button forces dark");
click(byId("theme"));
check(document.documentElement.getAttribute("data-theme") === "light", "and then light");

history.back();
await settle();
check(location.pathname === "/" && byId("count")?.textContent === "0", "the back button returns to the counter");
check(!serialize(document.body).includes("undefined"), "nothing renders 'undefined'");
console.log("PASS web-app");
