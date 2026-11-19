import { DisassembledFunction } from "./types";

/** Parses `objdump -d -l` output into functions with their instructions and source lines. */
export function parseDisassembly(text: string | undefined): Map<string, DisassembledFunction> {
  const functions = new Map<string, DisassembledFunction>();
  if (!text) {
    return functions;
  }
  let current: DisassembledFunction | undefined;
  let file: string | undefined;
  let line: number | undefined;
  for (const row of text.split("\n")) {
    const header = /^([0-9a-f]+) <(.+)>:$/.exec(row);
    if (header) {
      current = { start: parseInt(header[1], 16), instructions: new Map(), list: [] };
      functions.set(header[2], current);
      file = undefined;
      line = undefined;
      continue;
    }
    if (!current) {
      continue;
    }
    const source = /^(\/.+\.djinn):(\d+)/.exec(row);
    if (source) {
      file = source[1];
      line = Number(source[2]);
      continue;
    }
    const instruction = /^\s*([0-9a-f]+):\s+(.*)$/.exec(row);
    if (instruction) {
      const offset = parseInt(instruction[1], 16) - current.start;
      const cleaned = instruction[2].replace(/\s*#.*$/, "").replace(/\s+<.*>$/, "").trim();
      current.instructions.set(offset, cleaned);
      current.list.push({ offset, text: cleaned, file, line });
    }
  }
  return functions;
}

export interface Classification {
  label: string;
  text: string;
}

/** A human label for what an instruction does, used to explain where a line's samples went. */
export function classify(instruction: string | undefined): Classification {
  if (!instruction) {
    return { label: "code", text: "" };
  }
  const parts = instruction.split(/\s+/);
  const mnemonic = parts[0];
  const operands = parts.slice(1).join(" ");
  const clean = (label: string): Classification => ({ label, text: instruction.replace(/\s+/g, " ") });
  if (/^(idiv|div)/.test(mnemonic)) return clean("integer division");
  if (/^(imul|mul)/.test(mnemonic)) return clean("integer multiply");
  if (/^call/.test(mnemonic)) return clean("call");
  if (/^(lock|xchg|cmpxchg|xadd)/.test(mnemonic)) return clean("atomic operation");
  if (/^(rep|stos[bwlq]?$|movs[bwlq]$)/.test(mnemonic)) return clean("block copy/fill");
  if (/^jn?o$/.test(mnemonic)) return clean("overflow check (checked arithmetic)");
  if (/^(sqrt|div|mul|add|sub|cvt|ucomi|comi|pxor|xorp|andp|maxs|mins|unpck|movs[sd]|mova|movu)[a-z]*[sd]?$/.test(mnemonic) && /xmm/.test(operands)) return clean("floating point / SIMD");
  if (/^j/.test(mnemonic) || /^loop/.test(mnemonic)) return clean("branch");
  if (/^(cmp|test)/.test(mnemonic)) return clean("compare");
  if (/^(mov|lea)/.test(mnemonic)) {
    if (mnemonic.startsWith("lea")) return clean("address computation");
    const pieces = operands.split(/,(?![^()]*\))/);
    const source = pieces[0] || "";
    const destination = pieces[pieces.length - 1] || "";
    if (destination.includes("(") && !source.includes("(")) return clean("memory store");
    if (source.includes("(")) return clean("memory load");
    return clean("register move");
  }
  if (/^(add|sub|and|or|xor|shl|shr|sar|neg|not|inc|dec|sh[lr]d|rol|ror|adc|sbb|cdq|cqo|cltq|movzx|movsx|movslq)/.test(mnemonic)) return clean("arithmetic");
  return clean("other");
}
