import * as vscode from "vscode";

/**
 * Shows the preferred quick fix of a diagnostic as ghost text, like an inline suggestion: Tab accepts it.
 * It uses the code actions the language server already offers (the lightbulb), so a fix a rule adds shows up here with
 * no change. Only an insertion on the cursor's line, at or after the cursor, can be drawn as ghost text.
 */
export class InlineFixes implements vscode.InlineCompletionItemProvider {
  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    const line = document.lineAt(position.line);
    const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>(
      "vscode.executeCodeActionProvider",
      document.uri,
      line.range,
      vscode.CodeActionKind.QuickFix.value
    );
    if (token.isCancellationRequested || !actions) {
      return [];
    }
    const items: vscode.InlineCompletionItem[] = [];
    for (const action of actions) {
      if (!(action instanceof vscode.CodeAction) || !action.isPreferred || !action.edit) {
        continue;
      }
      const edits = action.edit.get(document.uri);
      if (edits.length !== 1) {
        continue;
      }
      const edit = edits[0];
      const at = edit.range.start;
      if (!edit.range.isEmpty || at.line !== position.line || at.isBefore(position)) {
        continue;
      }
      // the text between the cursor and the insertion stays, the fix is what follows it
      const between = document.getText(new vscode.Range(position, at));
      items.push(new vscode.InlineCompletionItem(between + edit.newText, new vscode.Range(position, at)));
    }
    return items;
  }
}
