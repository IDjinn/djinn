// Island props on the web (JavaScript): the native build writes the page with each [Client] island's props in
// data-props (a JSON object), and the web build builds every island from them instead of from its declaration.
//   node props.mjs <app.js> <index.html>
import { readFileSync } from "node:fs";
import { Document } from "../fake_dom.js";
import { load, check } from "./run.mjs";

const [, , program, pagePath] = process.argv;
// the server writes to a pipe in text mode on Windows, so a line break in the page arrives as CR LF
const page = readFileSync(pagePath, "utf8").replaceAll("\r\n", "\n");
const label = "say \"hi\" <b>&amp; 'it' é ✓ \\ \n end";

// what the server wrote: JSON in an attribute, with quotes, '<', '&', backslashes, line breaks and unicode intact
const written = new Document();
written.load(page);
const islands = written.querySelectorAll("dj-island");
check(islands.length === 2, "the server wrote both islands");
const first = JSON.parse(islands[0].getAttribute("data-props"));
check(first.label === label, `the label arrives intact (${JSON.stringify(first.label)})`);
check(first.count === 5 && first.big === 4000000000 && first.on === true, "numbers and booleans are JSON values");
check(JSON.stringify(first.tags) === JSON.stringify(["a<b", "&c\""]), "a slice is a JSON array");
const second = JSON.parse(islands[1].getAttribute("data-props"));
check(second.label === "second" && second.count === 7 && second.on === false && second.tags.join() === "x,y", "the second island has its own props");
const raw = [...page.matchAll(/data-props="([^"]*)"/g)].map((match) => match[1]);
check(raw.length === 2 && raw.every((value) => !/[<>]/.test(value) && !value.includes("\n")), "the attribute is escaped for HTML");

const texts = (document, selector) => document.querySelectorAll(selector).map((element) => element.textContent);

// the island adopts the server's HTML: no element is created, and it is alive from the server's values
{
    const { document, warnings } = load(program, "/", page);
    check(warnings.length === 0, `no warning for valid props (${warnings.join("; ")})`);
    check(document.createdElements === 0, `the page is adopted, not built again (${document.createdElements} elements created)`);
    check(texts(document, "[class=\"count\"]").join() === "5,7", `the island starts from the server's count (${texts(document, "[class=\"count\"]")})`);
    check(texts(document, "[class=\"label\"]")[0] === label, "the label survives the round trip");
    check(texts(document, "[class=\"big\"]")[0] === "4000000000", "a u32 above 2^31 arrives");
    check(document.querySelectorAll("[class=\"on\"]").length === 1, "a bool prop drives the branch");
    check(texts(document, "li").join("|") === "a<b|&c\"|x|y", "a slice prop drives the list");
    check(document.getElementById("static").textContent === "rendered once", "the rest of the page is the server's");
    document.fire("click", document.querySelectorAll("[class=\"inc\"]")[0]);
    check(texts(document, "[class=\"count\"]").join() === "6,7", "the island is alive");
    check(document.createdElements === 0, "and an update creates no element either");
}

// props that are not what the island's HTML shows: a warning, and that island is built again from its props
{
    const changed = page.replace("&quot;count&quot;:5,", "&quot;count&quot;:99,").replace("&quot;label&quot;:&quot;second&quot;", "&quot;label&quot;:&quot;from the page&quot;");
    check(changed !== page, "the test changed the page");
    const { document, warnings } = load(program, "/", changed);
    check(warnings.length === 2 && warnings.every((text) => text.includes("island Badge")), `each island that does not match is reported (${warnings.join("; ")})`);
    check(texts(document, "[class=\"count\"]").join() === "99,7", `the island is built from the props (${texts(document, "[class=\"count\"]")})`);
    check(texts(document, "[class=\"label\"]")[1] === "from the page", "each island reads its own props");
    check(document.getElementById("static").textContent === "rendered once", "the rest of the page is the server's");
    check(document.querySelectorAll("dj-island").length === 2, "the islands keep their elements");
    document.fire("click", document.querySelectorAll("[class=\"inc\"]")[0]);
    check(texts(document, "[class=\"count\"]").join() === "100,7", "the island built again is alive");
}

// a value of another type, a missing field or broken JSON: the island has no declaration to fall back on (the page's
// <Badge count={5}/> never reaches the client), so the prop is the type's zero value; what it renders is then not what
// the server wrote, and that island is built again
{
    const wrong = page.replace("&quot;count&quot;:5,", "&quot;count&quot;:&quot;x&quot;,");
    const { document, warnings } = load(program, "/", wrong);
    check(warnings.length === 2 && warnings[0].includes("count") && warnings[1].includes("island Badge"), `a prop of another type is reported (${warnings.join("; ")})`);
    check(texts(document, "[class=\"count\"]").join() === "0,7", "and the island is built with the zero value");

    const missing = page.replace("&quot;count&quot;:5,", "");
    const loaded = load(program, "/", missing);
    check(loaded.warnings.length === 1 && loaded.warnings[0].includes("island Badge") && texts(loaded.document, "[class=\"count\"]").join() === "0,7", `a missing prop is the zero value (${loaded.warnings.join("; ")})`);

    const broken = page.replace("data-props=\"{&quot;label&quot;:&quot;second", "data-props=\"{oops&quot;label&quot;:&quot;second");
    const again = load(program, "/", broken);
    check(again.warnings.length === 2 && again.warnings[0].includes("JSON"), `broken JSON is reported (${again.warnings.join("; ")})`);
    check(texts(again.document, "[class=\"label\"]")[1] === "", "and the island starts from zero values");
}

// a page without islands: nothing is built and nothing is reported
{
    const { document, warnings } = load(program, "/", "<html><head></head><body><main><p id=\"static\">rendered once</p></main></body></html>");
    check(warnings.length === 0 && document.createdElements === 0, "a page without islands is left as it is");
}

console.log("PASS props");
