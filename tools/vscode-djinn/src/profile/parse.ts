import * as toolchain from "../toolchain";
import { classify, parseDisassembly } from "./disassembly";
import { normalize } from "./format";
import { Frame, FunctionEntry, FunctionLineStat, LineStat, ParseOptions, ProfileModel, RuntimeEntry } from "./types";

const SOURCE_LINE = /^(.+\.djinn):(\d+)(?:\s+\(inlined\))?\s*$/;
const FRAME_HEADER = /^\t\s*([0-9a-f]+)\s+(.*?)(?:\+0x([0-9a-f]+))?\s*$/;

function addDetail(stat: LineStat, key: string, text: string, weight = 1): void {
  stat.count += weight;
  const entry = stat.details.get(key);
  if (entry) {
    entry.count += weight;
  } else {
    stat.details.set(key, { count: weight, text });
  }
}

function lineStat(lines: Map<string, Map<number, LineStat>>, file: string, line: number): LineStat {
  let perFile = lines.get(file);
  if (!perFile) {
    perFile = new Map();
    lines.set(file, perFile);
  }
  let stat = perFile.get(line);
  if (!stat) {
    stat = { count: 0, details: new Map() };
    perFile.set(line, stat);
  }
  return stat;
}

function parseFrames(block: string): Frame[] {
  const rows = block.split("\n").filter((row) => row.trim().length > 0);
  const frames: Frame[] = [];
  for (let i = 0; i < rows.length; i++) {
    const header = FRAME_HEADER.exec(rows[i]);
    if (!header) {
      continue;
    }
    const source = rows[i + 1] && /^ {2}\S/.test(rows[i + 1]) ? rows[i + 1].trim() : "";
    if (source) {
      i++;
    }
    const match = SOURCE_LINE.exec(source);
    const known = match !== null && Number(match[2]) > 0;
    frames.push({
      address: header[1],
      symbol: header[2],
      physical: header[2],
      offset: header[3] ? parseInt(header[3], 16) : undefined,
      kernel: source.startsWith("[kernel.kallsyms]") || header[1].startsWith("ffff"),
      file: known && match ? match[1] : undefined,
      line: known && match ? Number(match[2]) : undefined,
    });
  }
  // inlined frames share an address with the physical function that contains them
  for (let i = frames.length - 1; i >= 0; i--) {
    if (i + 1 < frames.length && frames[i + 1].address === frames[i].address) {
      frames[i].physical = frames[i + 1].physical;
    }
  }
  return frames;
}

function shortSymbol(symbol: string): string {
  return symbol.replace(/^std::/, "");
}

interface Operation {
  key: string;
  text: string;
}

/** Parses `perf script` output (and optionally the matching disassembly) into a profile model. */
export function parse(text: string, options: ParseOptions = {}): ProfileModel {
  const projectRoot = options.projectRoot ? normalize(options.projectRoot) : undefined;
  const disassembly = parseDisassembly(options.disassembly);
  const isProject = (frame: Frame): boolean => {
    if (!frame.file) {
      return false;
    }
    return !projectRoot || normalize(toolchain.fromWslPath(frame.file) || frame.file).startsWith(projectRoot);
  };

  const lines = new Map<string, Map<number, LineStat>>();
  const functions = new Map<string, FunctionEntry>();
  const runtime = new Map<string, number>();
  const instructionCounts = new Map<string, Map<number, number>>();
  let total = 0;
  let kernelOnly = 0;
  let runtimeCount = 0;

  const metricColumn = ({ alloc: 1, count: 2, live: 3, peak: 4 } as Record<string, number>)[options.metric || "alloc"] || 1;
  for (const block of text.split(/\n\s*\n/)) {
    const frames = parseFrames(block);
    if (frames.length === 0) {
      continue;
    }
    const meta = /^#alloc=(\d+) #count=(\d+) #live=(\d+) #peak=(\d+) #op=(.*)$/m.exec(block);
    const weight = meta ? Number(meta[metricColumn]) : 1;
    if (weight === 0) {
      continue;
    }
    total += weight;
    const user = frames.filter((frame) => !frame.kernel);
    if (user.length === 0) {
      kernelOnly += weight;
      continue;
    }
    const leaf = user[0];
    let blameIndex = user.findIndex(isProject);
    if (blameIndex < 0) {
      blameIndex = user.findIndex((frame) => frame.file);
    }
    const blame = blameIndex >= 0 ? user[blameIndex] : undefined;
    if (leaf.offset !== undefined) {
      let perFunction = instructionCounts.get(leaf.physical);
      if (!perFunction) {
        perFunction = new Map();
        instructionCounts.set(leaf.physical, perFunction);
      }
      perFunction.set(leaf.offset, (perFunction.get(leaf.offset) || 0) + weight);
    }
    const instructionOf = (frame: Frame): string | undefined => {
      const owner = disassembly.get(frame.physical);
      return owner && frame.offset !== undefined ? owner.instructions.get(frame.offset) : undefined;
    };

    let operation: Operation | undefined;
    if (blame === leaf || (blame && blameIndex === 0)) {
      const kind = classify(instructionOf(leaf));
      operation = { key: kind.label, text: kind.text };
    } else if (blame) {
      const trail = user.slice(0, blameIndex).map((frame) => shortSymbol(frame.symbol)).reverse();
      const compact = trail.filter((name, index) => index === 0 || name !== trail[index - 1]);
      const shown = compact.length > 3 ? [compact[0], "…", compact[compact.length - 1]] : compact;
      operation = { key: `calls ${shown.join(" → ")}`, text: "" };
    }

    if (blame && meta) {
      operation = { key: meta[5], text: `${meta[2]} allocations` };
    }
    if (blame && operation && blame.file !== undefined && blame.line !== undefined) {
      const file = toolchain.fromWslPath(blame.file) || blame.file;
      addDetail(lineStat(lines, file, blame.line), operation.key, operation.text, weight);
      const name = blame.symbol;
      let entry = functions.get(name);
      if (!entry) {
        entry = { name, count: 0, file, line: blame.line, lines: new Map(), sortedLines: [], project: isProject(blame) };
        functions.set(name, entry);
      }
      entry.count += weight;
      const stat: FunctionLineStat = entry.lines.get(blame.line) || { file, line: blame.line, count: 0, details: new Map() };
      stat.count += weight;
      const detail = stat.details.get(operation.key);
      stat.details.set(operation.key, { count: (detail ? detail.count : 0) + weight, text: operation.text });
      entry.lines.set(blame.line, stat);
    } else {
      runtimeCount += weight;
      runtime.set(leaf.symbol, (runtime.get(leaf.symbol) || 0) + weight);
    }

    if (leaf.file !== undefined && leaf.line !== undefined && leaf !== blame) {
      const file = toolchain.fromWslPath(leaf.file) || leaf.file;
      const kind = classify(instructionOf(leaf));
      addDetail(lineStat(lines, file, leaf.line), kind.label, kind.text, weight);
    }
  }

  const list = [...functions.values()].sort((a, b) => b.count - a.count);
  for (const entry of list) {
    entry.sortedLines = [...entry.lines.values()].sort((a, b) => b.count - a.count);
    const hottest = entry.sortedLines[0];
    entry.file = hottest.file;
    entry.line = hottest.line;
  }
  const runtimeList: RuntimeEntry[] = [...runtime.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return {
    memory: options.memory || false,
    total,
    kernelOnly,
    runtimeCount,
    functions: list,
    runtime: runtimeList,
    lines,
    instructionCounts,
    disassembly,
    projectRoot,
  };
}
