// The host of a Djinn program compiled for the web (wasm32): loads the module, provides the imports of the "djinn"
// module (console, clock, timers, number formatting, math and the DOM host of libs/ui) and drives the event loop.
// No dependencies; runs in browsers and in Node.js.
//
//   import { run } from "./djinn.js";
//   const program = await run("app.wasm");           // a URL, a path (Node), bytes or a WebAssembly.Module
//   const code = await program.exited;               // when main (and an async main) finished
//
// In a page, <script type="module" src="djinn.js" data-wasm="app.wasm"></script> runs the program by itself.

const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

class DjinnExit extends Error {
    constructor(code) {
        super(`exit ${code}`);
        this.code = code;
    }
}

export class DjinnPanic extends Error {}

// ── Numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────────

// The exact decimal value of a finite positive double: value = digits * 10^-scale.
function exactDecimal(value) {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const high = view.getUint32(0);
    const low = view.getUint32(4);
    const biased = (high >>> 20) & 0x7ff;
    let mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    let exponent;
    if (biased === 0) {
        exponent = -1074;
    } else {
        mantissa |= 1n << 52n;
        exponent = biased - 1075;
    }
    if (exponent >= 0) {
        return { digits: mantissa << BigInt(exponent), scale: 0 };
    }
    return { digits: mantissa * 5n ** BigInt(-exponent), scale: -exponent };
}

// Drops 'count' decimal digits of n, rounding half to even (what C's printf does with the exact value).
function dropDigits(n, count) {
    if (count <= 0) {
        return n * 10n ** BigInt(-count);
    }
    const unit = 10n ** BigInt(count);
    let quotient = n / unit;
    const rest = n % unit;
    const twice = rest * 2n;
    if (twice > unit || (twice === unit && (quotient & 1n) === 1n)) {
        quotient += 1n;
    }
    return quotient;
}

function fixed(value, precision) {
    const { digits, scale } = exactDecimal(value);
    const rounded = dropDigits(digits, scale - precision).toString();
    if (precision === 0) {
        return rounded;
    }
    const padded = rounded.padStart(precision + 1, "0");
    return `${padded.slice(0, padded.length - precision)}.${padded.slice(padded.length - precision)}`;
}

function scientificParts(value, precision) {
    if (value === 0) {
        return { mantissa: "0".repeat(precision + 1), exponent: 0 };
    }
    const { digits, scale } = exactDecimal(value);
    const length = digits.toString().length;
    let exponent = length - 1 - scale;
    let rounded = dropDigits(digits, length - (precision + 1)).toString();
    if (rounded.length > precision + 1) {
        rounded = rounded.slice(0, precision + 1);
        exponent += 1;
    }
    return { mantissa: rounded, exponent };
}

function scientific(value, precision, alternate) {
    const { mantissa, exponent } = scientificParts(value, precision);
    const point = precision > 0 || alternate ? "." : "";
    const sign = exponent < 0 ? "-" : "+";
    return `${mantissa[0]}${point}${mantissa.slice(1)}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

function general(value, precision, alternate) {
    const significant = precision === 0 ? 1 : precision;
    const exponent = value === 0 ? 0 : scientificParts(value, significant - 1).exponent;
    let text;
    if (exponent >= -4 && exponent < significant) {
        text = fixed(value, significant - 1 - exponent);
    } else {
        text = scientific(value, significant - 1, alternate);
    }
    if (!alternate && text.includes(".")) {
        const at = text.indexOf("e");
        const body = at < 0 ? text : text.slice(0, at);
        const tail = at < 0 ? "" : text.slice(at);
        text = body.replace(/0+$/, "").replace(/\.$/, "") + tail;
    }
    return text;
}

export function formatDouble(value, precision, conversion) {
    const alternate = (conversion & 0x100) !== 0;
    const letter = String.fromCharCode(conversion & 0xff);
    const upper = letter === letter.toUpperCase();
    const negative = value < 0 || Object.is(value, -0);
    const magnitude = Math.abs(value);
    let text;
    if (Number.isNaN(value)) {
        text = "nan";
    } else if (!Number.isFinite(value)) {
        text = "inf";
    } else {
        switch (letter.toLowerCase()) {
            case "f":
                text = fixed(magnitude, precision);
                if (alternate && precision === 0) text += ".";
                break;
            case "e":
                text = scientific(magnitude, precision, alternate);
                break;
            default:
                text = general(magnitude, precision, alternate);
                break;
        }
    }
    if (upper) text = text.toUpperCase();
    return (negative && !Number.isNaN(value) ? "-" : "") + text;
}

function parseDouble(text) {
    const lower = text.trim().toLowerCase();
    const negative = lower.startsWith("-");
    const body = lower.replace(/^[+-]/, "");
    if (body.startsWith("inf")) return negative ? -Infinity : Infinity;
    if (body.startsWith("nan")) return NaN;
    return Number(lower);
}

// ── Math the C library has and JavaScript's Math does not ───────────────────────────────────────────────────────────

const lanczos = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

function gamma(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    x -= 1;
    let a = lanczos[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += lanczos[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

function logGamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
    x -= 1;
    let a = lanczos[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += lanczos[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// erf by its positive series for small x and erfc by a continued fraction (modified Lentz) for large x.
function erfc(x) {
    if (x < 0) return 2 - erfc(-x);
    if (x < 2.5) return 1 - erf(x);
    let f = x, c = x, d = 0;
    for (let n = 1; n < 300; n++) {
        const an = n / 2;
        d = x + an * d;
        d = d === 0 ? 1e-300 : 1 / d;
        c = x + an / c;
        if (c === 0) c = 1e-300;
        const delta = c * d;
        f *= delta;
        if (Math.abs(delta - 1) < 1e-16) break;
    }
    return Math.exp(-x * x) / (f * Math.sqrt(Math.PI));
}

function erf(x) {
    if (x < 0) return -erf(-x);
    if (x >= 2.5) return 1 - erfc(x);
    let term = x, sum = x;
    for (let n = 1; n < 200; n++) {
        term *= (2 * x * x) / (2 * n + 1);
        sum += term;
        if (term < sum * 1e-17) break;
    }
    return (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum;
}

function ieeeRemainder(a, b) {
    const n = a / b;
    let rounded = Math.round(n);
    if (Math.abs(n - Math.trunc(n)) === 0.5) rounded = 2 * Math.round(n / 2);
    return a - rounded * b;
}

const unary = [Math.sin, Math.cos, Math.tan, Math.asin, Math.acos, Math.atan, Math.sinh, Math.cosh, Math.tanh,
    Math.asinh, Math.acosh, Math.atanh, Math.exp, (x) => Math.pow(2, x), Math.expm1, Math.log, Math.log10, Math.log2,
    Math.log1p, Math.cbrt, erf, erfc, gamma, logGamma];
const binary = [Math.atan2, Math.pow, Math.hypot, ieeeRemainder, (a, b) => a % b];

// ── The program ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class DjinnProgram {
    constructor(options = {}) {
        this.options = options;
        this.instance = null;
        this.exports = null;
        this.timer = null;
        this.lines = ["", "", ""];
        this.dom = null;
        this.exitCode = null;
        this.exited = new Promise((resolve, reject) => {
            this.resolveExit = resolve;
            this.rejectExit = reject;
        });
    }

    memory() {
        return new Uint8Array(this.exports.memory.buffer);
    }

    text(pointer, length) {
        return decoder.decode(this.memory().subarray(pointer, pointer + length));
    }

    cstring(pointer) {
        const bytes = this.memory();
        let end = pointer;
        while (bytes[end] !== 0) end++;
        return decoder.decode(bytes.subarray(pointer, end));
    }

    // A copy of 'value' in the program's memory (UTF-8, terminated); the caller frees it with djinn_free.
    allocate(value) {
        const bytes = encoder.encode(value);
        const pointer = this.exports.djinn_alloc(bytes.length + 1);
        const memory = this.memory();
        memory.set(bytes, pointer);
        memory[pointer + bytes.length] = 0;
        return { pointer, length: bytes.length };
    }

    write(fd, pointer, length) {
        const bytes = this.memory().slice(pointer, pointer + length);
        if (this.options.write) {
            this.options.write(fd, bytes);
            return;
        }
        if (isNode) {
            (fd === 2 ? process.stderr : process.stdout).write(bytes);
            return;
        }
        let pending = this.lines[fd] + decoder.decode(bytes);
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
            (fd === 2 ? console.error : console.log)(pending.slice(0, newline));
            pending = pending.slice(newline + 1);
        }
        this.lines[fd] = pending;
    }

    finish(code) {
        if (this.exitCode !== null) return;
        this.exitCode = code;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.resolveExit(code);
    }

    tick() {
        this.timer = null;
        this.guard(() => this.exports.djinn_tick());
    }

    // Runs a call into the program; a panic or a trap rejects 'exited' instead of escaping into the caller.
    guard(call) {
        try {
            return call();
        } catch (error) {
            if (error instanceof DjinnExit) {
                this.finish(error.code);
                return undefined;
            }
            if (this.exitCode === null) {
                this.exitCode = 134;
                this.rejectExit(error);
            }
            if (!(error instanceof DjinnPanic) && this.options.onTrap) this.options.onTrap(error);
            return undefined;
        }
    }

    imports() {
        const program = this;
        const djinn = {
            console_write: (fd, pointer, length) => program.write(fd, pointer, length),
            now_ms: () => performance.now(),
            unix_ms: () => Date.now(),
            timer_set: (milliseconds) => {
                if (program.timer !== null) clearTimeout(program.timer);
                program.timer = setTimeout(() => program.tick(), Math.max(0, Math.ceil(milliseconds)));
            },
            panic: (pointer, length) => {
                throw new DjinnPanic(program.text(pointer, length));
            },
            exit: (code) => {
                throw new DjinnExit(code);
            },
            format_f64: (value, precision, conversion, out, capacity) => {
                const bytes = encoder.encode(formatDouble(value, precision, conversion));
                const length = Math.min(bytes.length, capacity - 1);
                program.memory().set(bytes.subarray(0, length), out);
                program.memory()[out + length] = 0;
                return length;
            },
            parse_f64: (pointer, length) => parseDouble(program.text(pointer, length)),
            math1: (op, x) => unary[op](x),
            math2: (op, a, b) => binary[op](a, b),
        };
        if (DjinnProgram.domImports) Object.assign(djinn, DjinnProgram.domImports(program));
        return { djinn };
    }

    async instantiate(source) {
        const module = await loadModule(source);
        this.instance = await WebAssembly.instantiate(module, this.imports());
        this.exports = this.instance.exports;
        return this;
    }

    start() {
        const code = this.guard(() => this.exports.main(0, 0));
        if (this.exitCode !== null) return this;
        this.guard(() => this.exports.djinn_tick());
        if (this.exitCode === null && !this.exports.djinn_main_pending()) {
            this.finish(code ?? 0);
        }
        return this;
    }
}

async function loadModule(source) {
    if (source instanceof WebAssembly.Module) return source;
    if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return WebAssembly.compile(source);
    if (isNode && !/^https?:/.test(String(source))) {
        const { readFile } = await import("node:fs/promises");
        return WebAssembly.compile(await readFile(source instanceof URL ? source : String(source)));
    }
    const response = fetch(source);
    if (WebAssembly.compileStreaming) {
        try {
            return await WebAssembly.compileStreaming(response);
        } catch {
            // a server that does not send application/wasm
        }
    }
    return WebAssembly.compile(await (await fetch(source)).arrayBuffer());
}

export async function run(source, options = {}) {
    const program = new DjinnProgram(options);
    await program.instantiate(source);
    return program.start();
}

if (!isNode && typeof document !== "undefined") {
    const script = document.currentScript || document.querySelector("script[data-wasm]");
    const wasm = script && script.dataset && script.dataset.wasm;
    if (wasm) {
        run(new URL(wasm, script.src || document.baseURI)).then((program) => program.exited).catch((error) => console.error(error));
    }
}
