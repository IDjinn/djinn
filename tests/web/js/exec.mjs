// Runs a program compiled with --target web under Node.js: its runtime (the file it imports, next to it) first, then the
// program, both in the global scope as two <script> tags would be.
//   node exec.mjs <program.js>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const path = process.argv[2];
const source = readFileSync(path, "utf8");
const runtime = /^import "\.\/(djinn\.[0-9a-f]+\.js)";$/m.exec(source);
if (!runtime) throw new Error(`${path} does not import its runtime`);
(0, eval)(readFileSync(join(dirname(path), runtime[1]), "utf8"));
(0, eval)(source.replace(runtime[0], ""));
