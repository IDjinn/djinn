// Runs a Djinn program compiled for the web under Node.js: node tests/web/run.mjs <program.wasm>
// stdout and stderr are the program's, and the exit status is its exit code (134 for a panic or a trap).
import { run } from "../../runtime/web/djinn.js";

const wasm = process.argv[2];
if (!wasm) {
    console.error("usage: node tests/web/run.mjs <program.wasm>");
    process.exit(2);
}

const program = await run(wasm, {
    onTrap: (error) => process.stderr.write(`trap: ${error.message}\n`),
});
try {
    process.exitCode = await program.exited;
} catch (error) {
    process.exitCode = 134;
}
