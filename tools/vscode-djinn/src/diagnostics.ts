import * as vscode from "vscode";
import * as toolchain from "./toolchain";

function decorationType(color: string): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    after: { margin: "0 0 0 2em", color: new vscode.ThemeColor(color) },
    isWholeLine: false,
  });
}

/** Shows the first error or warning of each line at the end of the line (`djinn.inlineDiagnostics`). */
export class InlineDiagnostics implements vscode.Disposable {
  private readonly errors = decorationType("editorError.foreground");
  private readonly warnings = decorationType("editorWarning.foreground");

  renderAll = (): void => {
    vscode.window.visibleTextEditors.forEach((editor) => this.render(editor));
  };

  private render(editor: vscode.TextEditor): void {
    if (editor.document.languageId !== "djinn") {
      return;
    }
    const errors: vscode.DecorationOptions[] = [];
    const warnings: vscode.DecorationOptions[] = [];
    if (toolchain.settings().get("inlineDiagnostics")) {
      const seen = new Set<number>();
      const diagnostics = vscode.languages
        .getDiagnostics(editor.document.uri)
        .filter((diagnostic) => diagnostic.severity <= vscode.DiagnosticSeverity.Warning)
        .sort((a, b) => a.severity - b.severity);
      for (const diagnostic of diagnostics) {
        const line = diagnostic.range.start.line;
        if (seen.has(line)) {
          continue;
        }
        seen.add(line);
        const end = editor.document.lineAt(line).range.end;
        const code = diagnostic.code ? ` [${typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code}]` : "";
        const decoration: vscode.DecorationOptions = {
          range: new vscode.Range(end, end),
          renderOptions: { after: { contentText: `${diagnostic.message.split("\n")[0]}${code}` } },
        };
        (diagnostic.severity === vscode.DiagnosticSeverity.Error ? errors : warnings).push(decoration);
      }
    }
    editor.setDecorations(this.errors, errors);
    editor.setDecorations(this.warnings, warnings);
  }

  dispose(): void {
    this.errors.dispose();
    this.warnings.dispose();
  }
}
