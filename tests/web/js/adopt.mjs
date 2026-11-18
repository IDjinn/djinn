// A page the server rendered is adopted by the web build, not built again (libs/ui, "On the web"):
//   node adopt.mjs <app.js> <index.html> [debug]
// With "debug" the page is the one a debug build writes (indented, one element per line); otherwise the one a release
// build writes (no whitespace between elements). Both are adopted the same way.
import { readFileSync } from "node:fs";
import { Document, serialize } from "../fake_dom.js";
import { load, check } from "./run.mjs";

const [, , program, pagePath, kind] = process.argv;
// the server writes to a pipe in text mode on Windows, so a line break in the page arrives as CR LF
const page = readFileSync(pagePath, "utf8").replaceAll("\r\n", "\n");
// the line breaks of a debug page between two blocks are not part of what the app renders
const flat = (html) => html.replace(/<!--.*?-->/g, "").replace(/>\s*\n\s*</g, "><");
const body = (document) => flat(serialize(document.body));

const bodyText = /<body>([\s\S]*)<\/body>/.exec(page)[1];
if (kind === "debug") {
    check(/\n {4,}<h1>/.test(page) && /\n {2}<head>\n/.test(page), "a debug page has one element per line, indented");
    check(!/<\/(b|span|a|button)>\n/.test(page), "and no line break next to an inline element");
} else {
    check(!bodyText.includes("\n") && !/>\s+</.test(page.slice(page.indexOf("<head>"))), "a release page has no whitespace between elements");
    check(!/\/\*|;\s|\{\s/.test(/<style data-djinn>([\s\S]*?)<\/style>/.exec(page)[1]), "and a minified stylesheet");
}

const server = new Document();
server.load(page);
// the markers an island carries for the WebAssembly host (comments) are not kept
const written = body(server);
check(written.includes("data-component=\"Counter\""), "the server wrote the island");

// adoption: the same page, no element created, nothing reported
{
    const { document, warnings } = load(program, "/", page);
    check(warnings.length === 0, `a page that matches is not reported (${warnings.join("; ")})`);
    check(document.createdElements === 0, `no element is created (${document.createdElements})`);
    check(body(document) === written, "the page is the server's, node for node");
    check(document.getElementById("clock").textContent === server.getElementById("clock").textContent, "a [Server] part keeps the server's HTML");
    check(document.getElementById("hello").textContent === "Hello Ana, you have 3 items.", "text made of several parts is adopted whole");

    // the island is alive
    const value = () => document.querySelector("[class=\"value\"]").textContent;
    check(value() === "5", "the island starts from the server's props");
    const button = document.querySelector("[class=\"inc\"]");
    document.fire("click", button);
    check(value() === "6", "a click updates the text");
    check(document.querySelectorAll("[class=\"lot\"]").length === 0, "the branch is not shown yet");
    check(document.createdElements === 0, "the update created no element");
    document.fire("click", button);
    check(value() === "7" && document.querySelectorAll("[class=\"lot\"]").length === 1, "a branch that appears is built when it does");
    check(document.getElementById("hello").textContent === "Hello Ana, you have 3 items.", "the rest of the page is untouched");
}

// the program is the islands: the rest of the page is not its business, whatever it says
{
    const changed = page.replace("Hello ", "Goodbye ");
    check(changed !== page, "the test changed the page");
    const { document, warnings } = load(program, "/", changed);
    check(warnings.length === 0, `a page outside the islands is not checked (${warnings.join("; ")})`);
    check(document.getElementById("hello").textContent === "Goodbye Ana, you have 3 items.", "and it stays as the server wrote it");
    check(document.createdElements === 0, "nothing is created for it");
}

// an island that is not what the program renders is reported and built again, and only that island
{
    const changed = page.replace("add one", "add two");
    check(changed !== page, "the test changed the island");
    const { document, warnings } = load(program, "/", changed);
    check(warnings.length === 1 && warnings[0].includes("island Counter"), `the island that differs is reported (${warnings.join("; ")})`);
    check(document.querySelector("[class=\"inc\"]").textContent === "add one", "and it is built as the program declares it");
    check(document.getElementById("hello").textContent === "Hello Ana, you have 3 items.", "the rest of the page is untouched");
    document.fire("click", document.querySelector("[class=\"inc\"]"));
    check(document.querySelector("[class=\"value\"]").textContent === "6", "and it is alive");
}

// an island the program does not have is left as the server wrote it
{
    const changed = page.replace("data-component=\"Counter\"", "data-component=\"Other\"");
    const { document, warnings } = load(program, "/", changed);
    check(warnings.length === 1 && warnings[0].includes("Other"), `an island without a program is reported (${warnings.join("; ")})`);
    check(document.querySelector("[class=\"value\"]").textContent === "5", "and kept");
}

// the page's code and the code of a [Server] part are not in the program
{
    const program_text = readFileSync(program, "utf8");
    for (const text of ["stamp", "built by the server", "The page", "step ", "Hello ", "you have"]) {
        check(!program_text.includes(text), `no '${text}' in the generated JavaScript`);
    }
}

console.log("PASS adopt");
