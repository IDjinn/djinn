const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const toolchain = require("./toolchain");

const SOURCE_LINE = /^(.+\.djinn):(\d+)(?:\s+\(inlined\))?\s*$/;
const FRAME_HEADER = /^\t\s*([0-9a-f]+)\s+(.*?)(?:\+0x([0-9a-f]+))?\s*$/;

function amount(model, count) {
  if (!model.memory) {
    return `${count}`;
  }
  if (model.memory === "count") {
    return `${count} allocs`;
  }
  const bytes = model.memory === "bytes" ? count : count * 4096;
  if (bytes >= 1073741824) {
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

function normalize(file) {
  const lower = path.normalize(file).toLowerCase().replace(/\\/g, "/");
  const marker = "/toolchain/std/";
  const at = lower.lastIndexOf(marker);
  if (at >= 0) {
    return `<std>/${lower.slice(at + marker.length)}`;
  }
  return path.normalize(file).toLowerCase();
}

function parseDisassembly(text) {
  const functions = new Map();
  if (!text) {
    return functions;
  }
  let current;
  let file;
  let line;
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

function classify(instruction) {
  if (!instruction) {
    return { label: "code", text: "" };
  }
  const parts = instruction.split(/\s+/);
  const mnemonic = parts[0];
  const operands = parts.slice(1).join(" ");
  const clean = (label) => ({ label, text: instruction.replace(/\s+/g, " ") });
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

function createLine() {
  return { count: 0, details: new Map() };
}

function addDetail(stat, key, text, weight = 1) {
  stat.count += weight;
  const entry = stat.details.get(key);
  if (entry) {
    entry.count += weight;
  } else {
    stat.details.set(key, { count: weight, text });
  }
}

function lineStat(lines, file, line) {
  let perFile = lines.get(file);
  if (!perFile) {
    perFile = new Map();
    lines.set(file, perFile);
  }
  let stat = perFile.get(line);
  if (!stat) {
    stat = createLine();
    perFile.set(line, stat);
  }
  return stat;
}

function parseFrames(block) {
  const rows = block.split("\n").filter((row) => row.trim().length > 0);
  const frames = [];
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
    const known = match && Number(match[2]) > 0;
    frames.push({
      address: header[1],
      symbol: header[2],
      physical: header[2],
      offset: header[3] ? parseInt(header[3], 16) : undefined,
      kernel: source.startsWith("[kernel.kallsyms]") || header[1].startsWith("ffff"),
      file: known ? match[1] : undefined,
      line: known ? Number(match[2]) : undefined,
    });
  }
  for (let i = frames.length - 1; i >= 0; i--) {
    if (i + 1 < frames.length && frames[i + 1].address === frames[i].address) {
      frames[i].physical = frames[i + 1].physical;
    }
  }
  return frames;
}

function shortSymbol(symbol) {
  return symbol.replace(/^std::/, "");
}

function parse(text, options = {}) {
  const projectRoot = options.projectRoot ? normalize(options.projectRoot) : undefined;
  const disassembly = parseDisassembly(options.disassembly);
  const isProject = (frame) => frame.file && (!projectRoot || normalize(toolchain.fromWslPath(frame.file) || frame.file).startsWith(projectRoot));

  const lines = new Map();
  const functions = new Map();
  const runtime = new Map();
  const instructionCounts = new Map();
  let total = 0;
  let kernelOnly = 0;
  let runtimeCount = 0;

  const metricColumn = { alloc: 1, count: 2, live: 3, peak: 4 }[options.metric] || 1;
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
    const instructionOf = (frame) => {
      const function_ = disassembly.get(frame.physical);
      return function_ && frame.offset !== undefined ? function_.instructions.get(frame.offset) : undefined;
    };

    let operation;
    if (blame === leaf || (blame && blameIndex === 0)) {
      const kind = classify(instructionOf(leaf));
      operation = { key: kind.label, text: kind.text };
    } else if (blame) {
      const path_ = user.slice(0, blameIndex).map((frame) => shortSymbol(frame.symbol)).reverse();
      const compact = path_.filter((name, index) => index === 0 || name !== path_[index - 1]);
      const shown = compact.length > 3 ? [compact[0], "…", compact[compact.length - 1]] : compact;
      operation = { key: `calls ${shown.join(" → ")}`, text: "" };
    }

    if (blame && meta) {
      operation = { key: meta[5], text: `${meta[2]} allocations` };
    }
    if (blame) {
      const file = toolchain.fromWslPath(blame.file) || blame.file;
      addDetail(lineStat(lines, file, blame.line), operation.key, operation.text, weight);
      const name = blame.symbol;
      let entry = functions.get(name);
      if (!entry) {
        entry = { name, count: 0, file, line: blame.line, lines: new Map(), project: isProject(blame) };
        functions.set(name, entry);
      }
      entry.count += weight;
      const stat = entry.lines.get(blame.line) || { file, line: blame.line, count: 0, details: new Map() };
      stat.count += weight;
      const detail = stat.details.get(operation.key);
      stat.details.set(operation.key, { count: (detail ? detail.count : 0) + weight, text: operation.text });
      entry.lines.set(blame.line, stat);
    } else {
      runtimeCount += weight;
      runtime.set(leaf.symbol, (runtime.get(leaf.symbol) || 0) + weight);
    }

    if (leaf.file && leaf !== blame) {
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
  const runtimeList = [...runtime.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
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

function isProjectFile(model, file) {
  return !model.projectRoot || normalize(file).startsWith(model.projectRoot);
}

function splitName(name) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < name.length; i++) {
    const character = name[i];
    if (character === "<" || character === "(") {
      depth++;
    } else if (character === ">" || character === ")") {
      depth--;
    }
    if (depth === 0 && character === ":" && name[i + 1] === ":") {
      parts.push(current);
      current = "";
      i++;
    } else if (depth === 0 && character === ".") {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  parts.push(current);
  return parts.filter((part) => part.length > 0);
}

function buildTree(entries) {
  const root = { name: "", count: 0, children: new Map(), entry: undefined };
  for (const entry of entries) {
    let node = root;
    node.count += entry.count;
    for (const part of splitName(entry.name)) {
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, count: 0, children: new Map(), entry: undefined };
        node.children.set(part, child);
      }
      child.count += entry.count;
      node = child;
    }
    node.entry = entry;
  }
  const compact = (node) => {
    for (const [key, child] of [...node.children]) {
      let merged = child;
      while (merged.children.size === 1 && !merged.entry) {
        const only = merged.children.values().next().value;
        only.name = `${merged.name}::${only.name}`;
        merged = only;
      }
      node.children.delete(key);
      node.children.set(merged.name, merged);
      compact(merged);
    }
  };
  compact(root);
  return root;
}

function topDetails(stat, limit) {
  return [...stat.details.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([key, value]) => ({ key, count: value.count, text: value.text }));
}

class ProfileView {
  constructor() {
    this.model = undefined;
    this.projectOnly = false;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }

  load(model) {
    this.model = model;
    this.emitter.fire();
  }

  clear() {
    this.model = undefined;
    this.emitter.fire();
  }

  setProjectOnly(value) {
    this.projectOnly = value;
    this.emitter.fire();
  }

  getTreeItem(item) {
    return item;
  }

  percent(count) {
    return ((count / this.model.total) * 100).toFixed(1);
  }

  icon(fraction) {
    return new vscode.ThemeIcon(
      "flame",
      new vscode.ThemeColor(fraction >= 0.1 ? "charts.red" : fraction >= 0.03 ? "charts.orange" : "charts.foreground")
    );
  }

  open(file, line) {
    if (!file || !fs.existsSync(file)) {
      return undefined;
    }
    return {
      command: "vscode.open",
      title: "Open",
      arguments: [vscode.Uri.file(file), { selection: new vscode.Range(line - 1, 0, line - 1, 0) }],
    };
  }

  visibleFunctions() {
    return this.model.functions.filter((entry) => !this.projectOnly || entry.project);
  }

  nodeItems(node) {
    const items = [];
    const children = [...node.children.values()].sort((a, b) => b.count - a.count);
    for (const child of children) {
      const hasChildren = child.children.size > 0 || (child.entry && child.entry.sortedLines.length > 0);
      const item = new vscode.TreeItem(child.name, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.description = `${this.percent(child.count)}%  ·  ${amount(this.model, child.count)}`;
      item.iconPath = child.entry && child.children.size === 0 ? this.icon(child.count / this.model.total) : new vscode.ThemeIcon(child.entry ? "symbol-method" : "symbol-namespace");
      item.node = { kind: "node", node: child };
      if (child.entry) {
        item.contextValue = "djinnFunction";
        item.tooltip = `${child.entry.name}\n${amount(this.model, child.entry.count)} of ${amount(this.model, this.model.total)} ${this.model.memory === true ? "first-touched memory" : this.model.memory ? "memory" : "samples"}`;
        item.command = this.open(child.entry.file, child.entry.line);
        item.entry = child.entry;
      }
      items.push(item);
    }
    return items;
  }

  lineItems(entry) {
    return entry.sortedLines.slice(0, 12).map((stat) => {
      const details = topDetails(stat, 1)[0];
      const item = new vscode.TreeItem(`line ${stat.line}`, vscode.TreeItemCollapsibleState.None);
      item.description = `${this.percent(stat.count)}%  ·  ${details ? details.key : ""}`;
      item.iconPath = this.icon(stat.count / this.model.total);
      item.command = this.open(stat.file, stat.line);
      return item;
    });
  }

  getChildren(element) {
    const model = this.model;
    if (!model) {
      return [];
    }
    if (!element) {
      const items = [];
      const visible = this.visibleFunctions();
      const projectSamples = model.functions.filter((entry) => entry.project).reduce((sum, entry) => sum + entry.count, 0);
      const otherSamples = model.total - projectSamples;
      const summary = new vscode.TreeItem(model.memory ? `${amount(model, model.total)}${model.memory === true ? " touched" : ""}` : `${model.total} samples`, vscode.TreeItemCollapsibleState.None);
      summary.description = this.projectOnly
        ? `${this.percent(projectSamples)}% in project code (${this.percent(otherSamples)}% hidden)`
        : `${this.percent(projectSamples)}% project · ${this.percent(otherSamples)}% std, runtime, kernel`;
      summary.iconPath = new vscode.ThemeIcon(this.projectOnly ? "filter-filled" : "graph");
      items.push(summary);
      items.push(...this.nodeItems(buildTree(visible)));
      if (!this.projectOnly && model.runtime.length > 0) {
        const group = new vscode.TreeItem("Runtime, libc and kernel", vscode.TreeItemCollapsibleState.Collapsed);
        group.description = `${this.percent(model.runtimeCount + model.kernelOnly)}%`;
        group.tooltip = "Samples with no Djinn frame (the program was idle, in libc or in the kernel).";
        group.iconPath = new vscode.ThemeIcon("library");
        group.node = { kind: "runtime" };
        items.push(group);
      }
      return items;
    }
    const node = element.node;
    if (!node) {
      return [];
    }
    if (node.kind === "runtime") {
      return model.runtime.slice(0, 30).map((entry) => {
        const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
        item.description = `${this.percent(entry.count)}%  ·  ${amount(this.model, entry.count)}`;
        return item;
      });
    }
    if (node.kind === "node") {
      const items = this.nodeItems(node.node);
      if (node.node.entry) {
        items.push(...this.lineItems(node.node.entry));
      }
      return items;
    }
    return [];
  }
}

const LEVELS = [
  { minimum: 0.25, alpha: 0.3 },
  { minimum: 0.1, alpha: 0.22 },
  { minimum: 0.03, alpha: 0.15 },
  { minimum: 0.01, alpha: 0.09 },
  { minimum: 0, alpha: 0.05 },
];

class Hints {
  constructor() {
    this.model = undefined;
    this.enabled = true;
    this.projectOnly = false;
    this.types = LEVELS.map((level) =>
      vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: `rgba(255, 90, 40, ${level.alpha})`,
        overviewRulerColor: `rgba(255, 90, 40, ${Math.min(1, level.alpha * 3)})`,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        after: { margin: "0 0 0 2em", color: new vscode.ThemeColor("editorCodeLens.foreground") },
      })
    );
  }

  load(model) {
    this.model = model;
    this.render();
  }

  toggle() {
    this.enabled = !this.enabled;
    this.render();
    return this.enabled;
  }

  setProjectOnly(value) {
    this.projectOnly = value;
    this.render();
  }

  hidden(fsPath) {
    return this.projectOnly && this.model && !isProjectFile(this.model, fsPath);
  }

  render() {
    for (const editor of vscode.window.visibleTextEditors) {
      this.renderEditor(editor);
    }
  }

  statsFor(fsPath) {
    if (!this.model) {
      return undefined;
    }
    const wanted = normalize(fsPath);
    for (const [file, perFile] of this.model.lines) {
      if (normalize(file) === wanted) {
        return perFile;
      }
    }
    return undefined;
  }

  renderEditor(editor) {
    const buckets = LEVELS.map(() => []);
    if (this.enabled && this.model && editor.document.languageId === "djinn" && !this.hidden(editor.document.uri.fsPath)) {
      const perFile = this.statsFor(editor.document.uri.fsPath);
      const minimum = Number(toolchain.settings().get("perf.hintThreshold") || 0.5) / 100;
      if (perFile) {
        for (const [line, stat] of perFile) {
          const fraction = stat.count / this.model.total;
          if (fraction < minimum || line < 1 || line > editor.document.lineCount) {
            continue;
          }
          const end = editor.document.lineAt(line - 1).range.end;
          const top = topDetails(stat, 1)[0];
          const level = LEVELS.findIndex((candidate) => fraction >= candidate.minimum);
          buckets[level].push({
            range: new vscode.Range(line - 1, 0, line - 1, end.character),
            renderOptions: {
              after: { contentText: `${(fraction * 100).toFixed(1)}%  ·  ${amount(this.model, stat.count)}${top ? `  ·  ${top.key}` : ""}` },
            },
          });
        }
      }
    }
    this.types.forEach((type, index) => editor.setDecorations(type, buckets[index]));
  }

  hover(document, position) {
    if (!this.enabled || !this.model || this.hidden(document.uri.fsPath)) {
      return undefined;
    }
    const perFile = this.statsFor(document.uri.fsPath);
    const stat = perFile && perFile.get(position.line + 1);
    if (!stat) {
      return undefined;
    }
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**Djinn profile** — ${((stat.count / this.model.total) * 100).toFixed(1)}% of ${this.model.memory === true ? "memory touched" : this.model.memory ? "of the metric" : "samples"} (${amount(this.model, stat.count)})\n\n`);
    for (const detail of topDetails(stat, 6)) {
      const share = ((detail.count / stat.count) * 100).toFixed(0);
      markdown.appendMarkdown(`- ${share}% ${detail.key}${detail.text ? ` — \`${detail.text}\`` : ""}\n`);
    }
    return new vscode.Hover(markdown);
  }

  dispose() {
    this.types.forEach((type) => type.dispose());
  }
}

module.exports = {
  amount, parse, ProfileView, Hints, LEVELS, normalize, isProjectFile, topDetails };
