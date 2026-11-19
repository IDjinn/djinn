import * as vscode from "vscode";
import * as toolchain from "../toolchain";
import { amount, isProjectFile, LEVELS, normalize } from "./format";
import { topDetails } from "./tree";
import { LineStat, ProfileModel } from "./types";

/** Inline heat and hover text for the profiled lines of `.djinn` editors. */
export class Hints implements vscode.Disposable {
  private model: ProfileModel | undefined;
  private enabled = true;
  private projectOnly = false;
  private readonly types = LEVELS.map((level) =>
    vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: `rgba(255, 90, 40, ${level.alpha})`,
      overviewRulerColor: `rgba(255, 90, 40, ${Math.min(1, level.alpha * 3)})`,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      after: { margin: "0 0 0 2em", color: new vscode.ThemeColor("editorCodeLens.foreground") },
    })
  );

  load(model: ProfileModel | undefined): void {
    this.model = model;
    this.render();
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    this.render();
    return this.enabled;
  }

  setProjectOnly(value: boolean): void {
    this.projectOnly = value;
    this.render();
  }

  private hidden(fsPath: string): boolean {
    return this.projectOnly && this.model !== undefined && !isProjectFile(this.model, fsPath);
  }

  render(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.renderEditor(editor);
    }
  }

  private statsFor(fsPath: string): Map<number, LineStat> | undefined {
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

  private renderEditor(editor: vscode.TextEditor): void {
    const buckets: vscode.DecorationOptions[][] = LEVELS.map(() => []);
    const model = this.model;
    if (this.enabled && model && editor.document.languageId === "djinn" && !this.hidden(editor.document.uri.fsPath)) {
      const perFile = this.statsFor(editor.document.uri.fsPath);
      const minimum = Number(toolchain.settings().get("perf.hintThreshold") || 0.5) / 100;
      if (perFile) {
        for (const [line, stat] of perFile) {
          const fraction = stat.count / model.total;
          if (fraction < minimum || line < 1 || line > editor.document.lineCount) {
            continue;
          }
          const end = editor.document.lineAt(line - 1).range.end;
          const top = topDetails(stat, 1)[0];
          const level = LEVELS.findIndex((candidate) => fraction >= candidate.minimum);
          buckets[level].push({
            range: new vscode.Range(line - 1, 0, line - 1, end.character),
            renderOptions: {
              after: { contentText: `${(fraction * 100).toFixed(1)}%  ·  ${amount(model, stat.count)}${top ? `  ·  ${top.key}` : ""}` },
            },
          });
        }
      }
    }
    this.types.forEach((type, index) => editor.setDecorations(type, buckets[index]));
  }

  hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const model = this.model;
    if (!this.enabled || !model || this.hidden(document.uri.fsPath)) {
      return undefined;
    }
    const perFile = this.statsFor(document.uri.fsPath);
    const stat = perFile && perFile.get(position.line + 1);
    if (!stat) {
      return undefined;
    }
    const unit = model.memory === true ? "memory touched" : model.memory ? "of the metric" : "samples";
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**Djinn profile** — ${((stat.count / model.total) * 100).toFixed(1)}% of ${unit} (${amount(model, stat.count)})\n\n`);
    for (const detail of topDetails(stat, 6)) {
      const share = ((detail.count / stat.count) * 100).toFixed(0);
      markdown.appendMarkdown(`- ${share}% ${detail.key}${detail.text ? ` — \`${detail.text}\`` : ""}\n`);
    }
    return new vscode.Hover(markdown);
  }

  dispose(): void {
    this.types.forEach((type) => type.dispose());
  }
}
