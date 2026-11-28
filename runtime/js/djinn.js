// The core of a Djinn program compiled with --target web: text conversion and console output.
// djinnc inlines this file (and the .js files of the bindings the program uses) in front of the generated code.
const $str = (value) => typeof value === "boolean" ? (value ? "true" : "false") : "" + value;
let $pendingLine = "";
const $write = (text) => {
  $pendingLine += text;
  let at;
  while ((at = $pendingLine.indexOf("\n")) >= 0) {
    console.log($pendingLine.slice(0, at));
    $pendingLine = $pendingLine.slice(at + 1);
  }
};
const $format = (format, ...args) => format.replace(/\{(\d+)(?::[^}]*)?\}/g, (_, index) => $str(args[+index]));
const $panic = (message) => { throw new Error("djinn runtime error: " + message); };

// Integer arithmetic: checked (the default) stops on overflow like the native build, 's' saturates.
const $overflow = () => $panic("R10008: integer overflow");
const $i32 = (value) => (value | 0) === value ? value : $overflow();
const $u32 = (value) => (value >>> 0) === value ? value : $overflow();
const $i64 = (value) => Number.isSafeInteger(value) ? value : $overflow();
const $ck = (value, min, max) => value >= min && value <= max ? value : $overflow();
const $sat = (value, min, max) => value < min ? min : value > max ? max : value;
const $div = (left, right) => right === 0 ? $panic("division by zero") : Math.trunc(left / right);
const $rem = (left, right) => right === 0 ? $panic("division by zero") : left % right;
// The index of an inline array 'T[N]', checked against its length like the native build.
const $at = (index, length) => index >= 0 && index < length ? index : $panic("R10010: index out of range");
