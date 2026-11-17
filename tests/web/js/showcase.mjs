// Prints the page examples/showcase builds on the web at a route, as HTML, to compare with the native build's
// 'showcase.exe --html <route>' (tests/djinnc/showcase.sh).
import { serialize } from "../fake_dom.js";
import { load } from "./run.mjs";

const [, , script, route = "/"] = process.argv;
const { document } = load(script, route);
process.stdout.write(document.body.childNodes.filter((node) => node.nodeType === 1).map(serialize).join("") + "\n");
