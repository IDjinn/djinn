const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const toolchain = require("./toolchain");
const { LEVELS, normalize } = require("./profile");

const SCHEME = "djinn-asm";

function windowsFile(file) {
  return toolchain.fromWslPath(file) || file;
}

function anchorKey(file, line) {
  return `${normalize(windowsFile(file))}:${line}`;
}

class AssemblyView {
  constructor() {
    this.model = undefined;
    this.cache = new Map();
    this.sources = new Map();
    this.uris = new Map();
    this.lineIndex = undefined;
    this.emitter = new vscode.EventEmitter();
    this.onDidChange = this.emitter.event;
    this.headerType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      color: new vscode.ThemeColor("descriptionForeground"),
      backgroundColor: "rgba(128, 128, 128, 0.08)",
    });
    this.heatTypes = LEVELS.map((level) =>
      vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        backgroundColor: `rgba(255, 90, 40, ${level.alpha + 0.05})`,
        overviewRulerColor: `rgba(255, 90, 40, ${Math.min(1, level.alpha * 3)})`,
        overviewRulerLane: vscode.OverviewRulerLane.Right,
      })
    );
  }

  load(model) {
    this.model = model;
    this.cache.clear();
    this.lineIndex = undefined;
    for (const uri of this.uris.values()) {
      this.emitter.fire(uri);
    }
    this.decorateAll();
  }

  clear() {
    this.model = undefined;
    this.cache.clear();
    this.lineIndex = undefined;
    for (const uri of this.uris.values()) {
      this.emitter.fire(uri);
    }
  }

  sourceLine(file, line) {
    const full = windowsFile(file);
    let lines = this.sources.get(full);
    if (!lines) {
      try {
        lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
      } catch (error) {
        lines = [];
      }
      this.sources.set(full, lines);
    }
    return (lines[line - 1] || "").trim();
  }

  sampleTotal(symbol) {
    const counts = this.model && this.model.instructionCounts.get(symbol);
    let sum = 0;
    if (counts) {
      for (const value of counts.values()) {
        sum += value;
      }
    }
    return sum;
  }

  index() {
    if (this.lineIndex) {
      return this.lineIndex;
    }
    const index = new Map();
    if (this.model) {
      for (const [symbol, fn] of this.model.disassembly) {
        for (const instruction of fn.list) {
          if (!instruction.file) {
            continue;
          }
          const key = anchorKey(instruction.file, instruction.line);
          let symbols = index.get(key);
          if (!symbols) {
            symbols = new Set();
            index.set(key, symbols);
          }
          symbols.add(symbol);
        }
      }
    }
    this.lineIndex = index;
    const perFile = new Map();
    for (const key of index.keys()) {
      const cut = key.lastIndexOf(":");
      const file = key.slice(0, cut);
      const lines = perFile.get(file) || [];
      lines.push(Number(key.slice(cut + 1)));
      perFile.set(file, lines);
    }
    perFile.forEach((lines) => lines.sort((a, b) => a - b));
    this.fileLines = perFile;
    return index;
  }

  snap(file, line) {
    this.index();
    const lines = this.fileLines.get(normalize(windowsFile(file)));
    if (!lines || lines.length === 0) {
      return undefined;
    }
    let best;
    for (const candidate of lines) {
      const distance = Math.abs(candidate - line);
      if (distance <= 12 && (best === undefined || distance < Math.abs(best - line) || (distance === Math.abs(best - line) && candidate > best))) {
        best = candidate;
      }
    }
    return best;
  }

  anchorLine(built, file, line) {
    const exact = built.anchors.get(anchorKey(file, line));
    if (exact !== undefined) {
      return exact;
    }
    const near = this.snap(file, line);
    return near === undefined ? undefined : built.anchors.get(anchorKey(file, near));
  }

  resolve(name, file, line) {
    if (!this.model) {
      return undefined;
    }
    if (name && this.model.disassembly.has(name)) {
      return name;
    }
    let candidates = file && line ? this.index().get(anchorKey(file, line)) : undefined;
    if (!candidates && file && line) {
      const near = this.snap(file, line);
      candidates = near === undefined ? undefined : this.index().get(anchorKey(file, near));
    }
    if (!candidates || candidates.size === 0) {
      return undefined;
    }
    return [...candidates].sort((a, b) => this.sampleTotal(b) - this.sampleTotal(a))[0];
  }

  build(symbol) {
    const cached = this.cache.get(symbol);
    if (cached) {
      return cached;
    }
    const fn = this.model && this.model.disassembly.get(symbol);
    const result = { text: "", kinds: [], anchors: new Map() };
    if (!fn) {
      result.text = `; no disassembly for ${symbol}. Profile the program again to capture it.\n`;
      this.cache.set(symbol, result);
      return result;
    }
    const counts = this.model.instructionCounts.get(symbol) || new Map();
    const total = this.model.total;
    const functionSamples = this.sampleTotal(symbol);

    const groups = [];
    for (const instruction of fn.list) {
      const key = instruction.file ? anchorKey(instruction.file, instruction.line) : "";
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.items.push(instruction);
      } else {
        groups.push({ key, file: instruction.file, line: instruction.line, items: [instruction], count: 0 });
      }
    }
    for (const group of groups) {
      group.count = group.items.reduce((sum, item) => sum + (counts.get(item.offset) || 0), 0);
    }

    const percent = (count) => (count > 0 ? `${((count / total) * 100).toFixed(1)}%` : "");
    const rows = [];
    const header = `; ${symbol}  -  ${functionSamples} samples (${percent(functionSamples) || "0%"} of total)`;
    rows.push({ text: header, kind: { type: "header" } });
    for (const group of groups) {
      const source = group.file ? this.sourceLine(group.file, group.line) : "";
      const comment = group.file ? `; ${group.line}: ${source}` : "; no source";
      if (group.file) {
        const key = anchorKey(group.file, group.line);
        if (!result.anchors.has(key)) {
          result.anchors.set(key, rows.length);
        }
      }
      group.items.forEach((item, position) => {
        const count = counts.get(item.offset) || 0;
        const offset = `+0x${item.offset.toString(16)}`.padEnd(8);
        const numbers = count ? `${percent(count)} (${count})` : "";
        const tail = position === 0 ? `  ${comment}` : "";
        const text = `    ${offset}${numbers.padEnd(16)}${item.text.padEnd(38)}${tail}`.trimEnd();
        rows.push({ text, kind: { type: "instruction", fraction: count / total, count } });
      });
    }
    result.text = rows.map((row) => row.text).join("\n") + "\n";
    result.kinds = rows.map((row) => row.kind);
    this.cache.set(symbol, result);
    return result;
  }

  provideTextDocumentContent(uri) {
    return this.build(decodeURIComponent(uri.query)).text;
  }

  uriFor(symbol) {
    const safe = symbol.replace(/[^A-Za-z0-9_.-]+/g, "_");
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${safe}.s`, query: encodeURIComponent(symbol) });
    this.uris.set(symbol, uri);
    return uri;
  }

  assemblyEditors() {
    return vscode.window.visibleTextEditors.filter((editor) => editor.document.uri.scheme === SCHEME);
  }

  async show(symbol, file, line) {
    const existing = this.assemblyEditors()[0];
    const uri = this.uriFor(symbol);
    const document = await vscode.workspace.openTextDocument(uri);
    try {
      await vscode.languages.setTextDocumentLanguage(document, "asm");
    } catch (error) {
      void error;
    }
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: existing && existing.viewColumn ? existing.viewColumn : vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: true,
    });
    this.decorate(editor);
    this.reveal(editor, symbol, file, line, true);
  }

  reveal(editor, symbol, file, line, atTop) {
    const built = this.build(symbol);
    const docLine = file && line ? this.anchorLine(built, file, line) : undefined;
    if (docLine === undefined) {
      return;
    }
    editor.revealRange(
      new vscode.Range(docLine, 0, docLine, 0),
      atTop ? vscode.TextEditorRevealType.AtTop : vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  }

  decorate(editor) {
    if (!editor || editor.document.uri.scheme !== SCHEME) {
      return;
    }
    const built = this.build(decodeURIComponent(editor.document.uri.query));
    const headers = [];
    const heat = LEVELS.map(() => []);
    built.kinds.forEach((kind, index) => {
      const range = new vscode.Range(index, 0, index, 0);
      if (kind.type === "header") {
        headers.push(range);
      } else if (kind.count > 0) {
        const level = LEVELS.findIndex((candidate) => kind.fraction >= candidate.minimum);
        heat[level].push(range);
      }
    });
    editor.setDecorations(this.headerType, headers);
    this.heatTypes.forEach((type, index) => editor.setDecorations(type, heat[index]));
  }

  decorateAll() {
    vscode.window.visibleTextEditors.forEach((editor) => this.decorate(editor));
  }

  syncWith(sourceEditor) {
    if (!this.model || sourceEditor.document.languageId !== "djinn") {
      return;
    }
    const open = this.assemblyEditors();
    if (open.length === 0) {
      return;
    }
    const file = sourceEditor.document.uri.fsPath;
    const line = sourceEditor.selection.active.line + 1;
    const key = anchorKey(file, line);
    for (const editor of open) {
      const docLine = this.anchorLine(this.build(decodeURIComponent(editor.document.uri.query)), file, line);
      if (docLine !== undefined) {
        editor.revealRange(new vscode.Range(docLine, 0, docLine, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        return;
      }
    }
    const symbol = this.resolve(undefined, file, line);
    if (!symbol || this.switching) {
      return;
    }
    this.switching = true;
    this.show(symbol, file, line).then(
      () => {
        this.switching = false;
      },
      () => {
        this.switching = false;
      }
    );
  }

  dispose() {
    this.headerType.dispose();
    this.heatTypes.forEach((type) => type.dispose());
  }
}

module.exports = { AssemblyView, SCHEME };
