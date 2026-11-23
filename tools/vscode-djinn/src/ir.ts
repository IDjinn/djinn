import * as path from "path";
import * as vscode from "vscode";
import * as build from "./build";
import * as toolchain from "./toolchain";
import { ServerInfo } from "./types";

export const SCHEME = "djinn-ir";
const LEVELS = ["O0", "O1", "O2", "O3", "Os", "Oz"];

interface Emitted {
  /** IR document line (0-based) -> source line (1-based), 0 when none. Empty for whole-program output. */
  map: number[];
  /** The source file the IR was cut down to. */
  file?: string;
}

/** Virtual `djinn-ir:` documents holding the LLVM IR djinnc emits for the open project, one per optimization level. */
export class IrView implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly texts = new Map<string, string>();
  private readonly emitted = new Map<string, Emitted>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private readonly highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });

  constructor(private readonly getInfo: () => Promise<ServerInfo | undefined>) {}

  register(): vscode.Disposable[] {
    return [
      this,
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      vscode.commands.registerCommand("djinn.showIR", () => this.show()),
      vscode.commands.registerCommand("djinn.compareIR", () => this.compare()),
      vscode.window.onDidChangeTextEditorSelection((event) => this.sync(event.textEditor)),
    ];
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.toString()) || "";
  }

  private target(): string | undefined {
    const target = toolchain.resolveTarget();
    if (!target) {
      vscode.window.showWarningMessage("Open a Djinn file or folder first.");
    }
    return target;
  }

  private async pick(multiple: boolean, title: string): Promise<string[] | undefined> {
    const configured = toolchain.settings().get<string>("build.optimization") || "O2";
    const items = LEVELS.map((level) => ({ label: level, description: level === "O0" ? "no optimization" : level === configured ? "build setting" : "", picked: level === "O0" }));
    const chosen = multiple
      ? await vscode.window.showQuickPick(items, { canPickMany: true, title, placeHolder: "Optimization levels to emit" })
      : await vscode.window.showQuickPick(items, { title });
    if (!chosen) {
      return undefined;
    }
    const list = Array.isArray(chosen) ? chosen : [chosen];
    return list.map((item) => item.label);
  }

  /** The open Djinn file when the IR is limited to it (djinn.ir.scope "file", the default); undefined for the whole program. */
  private scopeFile(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    const scope = toolchain.settings().get<string>("ir.scope") || "file";
    return scope === "file" && editor && editor.document.languageId === "djinn" ? editor.document.uri.fsPath : undefined;
  }

  private async emit(target: string, level: string, file?: string): Promise<vscode.Uri | undefined> {
    const name = path.basename(file || target, ".djinn");
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${name}.${level}.ll`, query: encodeURIComponent(target) });
    try {
      const ir = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Djinn: emitting LLVM IR (${level})` },
        async () => build.emitIR(target, level, await this.getInfo(), file)
      );
      this.texts.set(uri.toString(), ir.text);
      this.emitted.set(uri.toString(), { map: ir.map, file });
      this.emitter.fire(uri);
      return uri;
    } catch (error) {
      vscode.window.showErrorMessage(`Djinn IR (${level}) failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async open(uri: vscode.Uri, column: vscode.ViewColumn): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    try {
      await vscode.languages.setTextDocumentLanguage(document, "llvm");
    } catch {
      // without an LLVM IR language extension the plain text view is still useful
    }
    await vscode.window.showTextDocument(document, { viewColumn: column, preview: false, preserveFocus: true });
  }

  /** Emits the IR at each picked level and opens one document per level, side by side. */
  async show(): Promise<void> {
    const target = this.target();
    const file = this.scopeFile();
    const levels = target && (await this.pick(true, "Djinn: Show LLVM IR"));
    if (!target || !levels || levels.length === 0) {
      return;
    }
    for (const level of levels) {
      const uri = await this.emit(target, level, file);
      if (uri) {
        await this.open(uri, vscode.ViewColumn.Beside);
      }
    }
    const source = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.fsPath === file);
    if (source) {
      this.sync(source);
    }
  }

  /** A diff of the IR at two optimization levels: what the optimizer changed. */
  async compare(): Promise<void> {
    const target = this.target();
    const file = this.scopeFile();
    if (!target) {
      return;
    }
    const before = await this.pickOne("Compare LLVM IR: first level");
    const after = before && (await this.pickOne(`Compare LLVM IR: ${before} against`));
    if (!before || !after) {
      return;
    }
    const left = await this.emit(target, before, file);
    const right = left && (await this.emit(target, after, file));
    if (left && right) {
      await vscode.commands.executeCommand("vscode.diff", left, right, `LLVM IR ${before} ↔ ${after}`);
    }
  }

  private async pickOne(title: string): Promise<string | undefined> {
    const picked = await this.pick(false, title);
    return picked && picked[0];
  }

  private irEditors(): { editor: vscode.TextEditor; info: Emitted }[] {
    const found: { editor: vscode.TextEditor; info: Emitted }[] = [];
    for (const editor of vscode.window.visibleTextEditors) {
      const info = editor.document.uri.scheme === SCHEME ? this.emitted.get(editor.document.uri.toString()) : undefined;
      if (info && info.map.length > 0) {
        found.push({ editor, info });
      }
    }
    return found;
  }

  /** The IR lines generated from a source line; when it has none, from the nearest line before it that has some. */
  private linesFor(info: Emitted, line: number): number[] {
    for (let candidate = line; candidate > 0 && candidate > line - 6; candidate--) {
      const rows: number[] = [];
      info.map.forEach((from, row) => {
        if (from === candidate) {
          rows.push(row);
        }
      });
      if (rows.length > 0) {
        return rows;
      }
    }
    return [];
  }

  private ranges(rows: number[]): vscode.Range[] {
    return rows.map((row) => new vscode.Range(row, 0, row, 0));
  }

  /**
   * Keeps the source and its IR pointing at each other: the cursor in a .djinn file marks and scrolls to the IR it generated,
   * and the cursor in the IR marks and scrolls to the source line (the IR of the same line is marked in every open level).
   */
  private sync(editor: vscode.TextEditor): void {
    const views = this.irEditors();
    if (views.length === 0) {
      return;
    }
    const cursor = editor.selection.active.line;
    if (editor.document.uri.scheme === SCHEME) {
      const info = this.emitted.get(editor.document.uri.toString());
      const line = info ? info.map[cursor] || 0 : 0;
      if (!info || line === 0) {
        return;
      }
      const source = vscode.window.visibleTextEditors.find((candidate) => info.file !== undefined && candidate.document.uri.fsPath === info.file);
      if (source) {
        source.setDecorations(this.highlight, [new vscode.Range(line - 1, 0, line - 1, 0)]);
        source.revealRange(new vscode.Range(line - 1, 0, line - 1, 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
      for (const view of views) {
        if (view.editor !== editor) {
          const rows = this.linesFor(view.info, line);
          view.editor.setDecorations(this.highlight, this.ranges(rows));
          if (rows.length > 0) {
            view.editor.revealRange(new vscode.Range(rows[0], 0, rows[0], 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
          }
        }
      }
      editor.setDecorations(this.highlight, this.ranges(this.linesFor(info, line).filter((row) => info.map[row] === line)));
      return;
    }
    if (editor.document.languageId !== "djinn") {
      return;
    }
    const line = cursor + 1;
    for (const view of views) {
      if (view.info.file !== undefined && view.info.file !== editor.document.uri.fsPath) {
        continue;
      }
      const rows = this.linesFor(view.info, line);
      view.editor.setDecorations(this.highlight, this.ranges(rows));
      if (rows.length > 0) {
        view.editor.revealRange(new vscode.Range(rows[0], 0, rows[0], 0), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    }
    editor.setDecorations(this.highlight, [new vscode.Range(cursor, 0, cursor, 0)]);
  }

  dispose(): void {
    this.highlight.dispose();
    this.emitter.dispose();
  }
}
