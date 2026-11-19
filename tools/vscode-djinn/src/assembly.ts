import * as fs from "fs";
import * as vscode from "vscode";
import { LEVELS, normalize, ProfileModel } from "./profile";
import * as toolchain from "./toolchain";

export const SCHEME = "djinn-asm";

type RowKind = { type: "header" } | { type: "instruction"; fraction: number; count: number };

/** The rendered disassembly of one function and where each source line starts in it. */
interface BuiltFunction {
  text: string;
  kinds: RowKind[];
  /** anchor key (file:line) -> document line */
  anchors: Map<string, number>;
}

interface InstructionGroup {
  key: string;
  file?: string;
  line?: number;
  items: { offset: number; text: string }[];
  count: number;
}

function windowsFile(file: string): string {
  return toolchain.fromWslPath(file) || file;
}

function anchorKey(file: string, line: number): string {
  return `${normalize(windowsFile(file))}:${line}`;
}

/** Virtual `djinn-asm:` documents showing the machine code of profiled functions, heat-mapped by sample count. */
export class AssemblyView implements vscode.TextDocumentContentProvider, vscode.Disposable {
  model: ProfileModel | undefined;
  readonly onDidChange: vscode.Event<vscode.Uri>;
  private readonly cache = new Map<string, BuiltFunction>();
  private readonly sources = new Map<string, string[]>();
  private readonly uris = new Map<string, vscode.Uri>();
  private lineIndex: Map<string, Set<string>> | undefined;
  private fileLines = new Map<string, number[]>();
  private switching = false;
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly headerType = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    color: new vscode.ThemeColor("descriptionForeground"),
    backgroundColor: "rgba(128, 128, 128, 0.08)",
  });
  private readonly heatTypes = LEVELS.map((level) =>
    vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: `rgba(255, 90, 40, ${level.alpha + 0.05})`,
      overviewRulerColor: `rgba(255, 90, 40, ${Math.min(1, level.alpha * 3)})`,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    })
  );

  constructor() {
    this.onDidChange = this.emitter.event;
  }

  load(model: ProfileModel): void {
    this.model = model;
    this.invalidate();
    this.decorateAll();
  }

  clear(): void {
    this.model = undefined;
    this.invalidate();
  }

  private invalidate(): void {
    this.cache.clear();
    this.lineIndex = undefined;
    for (const uri of this.uris.values()) {
      this.emitter.fire(uri);
    }
  }

  private sourceLine(file: string, line: number): string {
    const full = windowsFile(file);
    let lines = this.sources.get(full);
    if (!lines) {
      try {
        lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
      } catch {
        lines = [];
      }
      this.sources.set(full, lines);
    }
    return (lines[line - 1] || "").trim();
  }

  private sampleTotal(symbol: string): number {
    const counts = this.model && this.model.instructionCounts.get(symbol);
    let sum = 0;
    if (counts) {
      for (const value of counts.values()) {
        sum += value;
      }
    }
    return sum;
  }

  /** anchor key -> the functions containing that source line. */
  private index(): Map<string, Set<string>> {
    if (this.lineIndex) {
      return this.lineIndex;
    }
    const index = new Map<string, Set<string>>();
    if (this.model) {
      for (const [symbol, fn] of this.model.disassembly) {
        for (const instruction of fn.list) {
          if (!instruction.file || instruction.line === undefined) {
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
    const perFile = new Map<string, number[]>();
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

  /** The nearest source line (within 12) that has machine code. */
  private snap(file: string, line: number): number | undefined {
    this.index();
    const lines = this.fileLines.get(normalize(windowsFile(file)));
    if (!lines || lines.length === 0) {
      return undefined;
    }
    let best: number | undefined;
    for (const candidate of lines) {
      const distance = Math.abs(candidate - line);
      if (distance > 12) {
        continue;
      }
      if (best === undefined || distance < Math.abs(best - line) || (distance === Math.abs(best - line) && candidate > best)) {
        best = candidate;
      }
    }
    return best;
  }

  private anchorLine(built: BuiltFunction, file: string, line: number): number | undefined {
    const exact = built.anchors.get(anchorKey(file, line));
    if (exact !== undefined) {
      return exact;
    }
    const near = this.snap(file, line);
    return near === undefined ? undefined : built.anchors.get(anchorKey(file, near));
  }

  /** The function to show for a symbol name, or for a source line when no name is given. */
  resolve(name: string | undefined, file: string | undefined, line: number | undefined): string | undefined {
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

  private build(symbol: string): BuiltFunction {
    const cached = this.cache.get(symbol);
    if (cached) {
      return cached;
    }
    const fn = this.model && this.model.disassembly.get(symbol);
    const result: BuiltFunction = { text: "", kinds: [], anchors: new Map() };
    if (!this.model || !fn) {
      result.text = `; no disassembly for ${symbol}. Profile the program again to capture it.\n`;
      this.cache.set(symbol, result);
      return result;
    }
    const counts = this.model.instructionCounts.get(symbol) || new Map<number, number>();
    const total = this.model.total;
    const functionSamples = this.sampleTotal(symbol);

    const groups: InstructionGroup[] = [];
    for (const instruction of fn.list) {
      const key = instruction.file && instruction.line !== undefined ? anchorKey(instruction.file, instruction.line) : "";
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

    const percent = (count: number): string => (count > 0 ? `${((count / total) * 100).toFixed(1)}%` : "");
    const rows: { text: string; kind: RowKind }[] = [];
    rows.push({ text: `; ${symbol}  -  ${functionSamples} samples (${percent(functionSamples) || "0%"} of total)`, kind: { type: "header" } });
    for (const group of groups) {
      const hasSource = group.file !== undefined && group.line !== undefined;
      const source = hasSource ? this.sourceLine(group.file as string, group.line as number) : "";
      const comment = hasSource ? `; ${group.line}: ${source}` : "; no source";
      if (hasSource) {
        const key = anchorKey(group.file as string, group.line as number);
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

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.build(decodeURIComponent(uri.query)).text;
  }

  private uriFor(symbol: string): vscode.Uri {
    const safe = symbol.replace(/[^A-Za-z0-9_.-]+/g, "_");
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${safe}.s`, query: encodeURIComponent(symbol) });
    this.uris.set(symbol, uri);
    return uri;
  }

  private assemblyEditors(): vscode.TextEditor[] {
    return vscode.window.visibleTextEditors.filter((editor) => editor.document.uri.scheme === SCHEME);
  }

  async show(symbol: string, file: string | undefined, line: number | undefined): Promise<void> {
    const existing = this.assemblyEditors()[0];
    const uri = this.uriFor(symbol);
    const document = await vscode.workspace.openTextDocument(uri);
    try {
      await vscode.languages.setTextDocumentLanguage(document, "asm");
    } catch {
      // no assembly language support installed: the plain text view is still useful
    }
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: existing && existing.viewColumn ? existing.viewColumn : vscode.ViewColumn.Beside,
      preserveFocus: true,
      preview: true,
    });
    this.decorate(editor);
    this.reveal(editor, symbol, file, line, true);
  }

  private reveal(editor: vscode.TextEditor, symbol: string, file: string | undefined, line: number | undefined, atTop: boolean): void {
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

  private decorate(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== SCHEME) {
      return;
    }
    const built = this.build(decodeURIComponent(editor.document.uri.query));
    const headers: vscode.Range[] = [];
    const heat: vscode.Range[][] = LEVELS.map(() => []);
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

  decorateAll(): void {
    vscode.window.visibleTextEditors.forEach((editor) => this.decorate(editor));
  }

  /** Scrolls an open assembly view to the machine code of the source line the cursor is on. */
  syncWith(sourceEditor: vscode.TextEditor): void {
    if (!this.model || sourceEditor.document.languageId !== "djinn") {
      return;
    }
    const open = this.assemblyEditors();
    if (open.length === 0) {
      return;
    }
    const file = sourceEditor.document.uri.fsPath;
    const line = sourceEditor.selection.active.line + 1;
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
    const done = (): void => {
      this.switching = false;
    };
    this.show(symbol, file, line).then(done, done);
  }

  dispose(): void {
    this.headerType.dispose();
    this.heatTypes.forEach((type) => type.dispose());
    this.emitter.dispose();
  }
}
