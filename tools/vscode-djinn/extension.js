const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let client;
let output;
let errorDecoration;
let warningDecoration;

function exeName() {
  return process.platform === "win32" ? "djinn-lsp.exe" : "djinn-lsp";
}

function settings() {
  return vscode.workspace.getConfiguration("djinn");
}

function findServer(context) {
  const configured = settings().get("server.path");
  if (configured) {
    return configured;
  }
  const candidates = [path.join(context.extensionPath, "bin", exeName())];
  for (const folder of vscode.workspace.workspaceFolders || []) {
    candidates.push(path.join(folder.uri.fsPath, "djinn-lsp", "build", exeName()));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return exeName();
}

function initializationOptions() {
  const config = settings();
  return {
    compilerPath: config.get("compilerPath"),
    runtimeDir: config.get("runtimeDir"),
    stdDir: config.get("stdDir"),
    checkOnChange: config.get("checkOnChange"),
    debounceMs: config.get("checkDebounceMs"),
  };
}

async function startClient(context) {
  const command = findServer(context);
  const serverOptions = { command, transport: TransportKind.stdio };
  const clientOptions = {
    documentSelector: [{ scheme: "file", language: "djinn" }, { scheme: "untitled", language: "djinn" }],
    initializationOptions: initializationOptions(),
    outputChannel: output,
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{djinn,proj}"),
    },
  };
  client = new LanguageClient("djinn", "Djinn Language Server", serverOptions, clientOptions);
  try {
    await client.start();
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not start djinn-lsp (${command}). Build it with djinn-lsp/build.sh or set djinn.server.path. ${error.message || error}`
    );
  }
}

async function stopClient() {
  if (client) {
    const current = client;
    client = undefined;
    await current.stop().catch(() => {});
  }
}

async function restart(context) {
  await stopClient();
  await startClient(context);
}

async function serverInfo() {
  if (!client) {
    return undefined;
  }
  try {
    return await client.sendRequest("djinn/info");
  } catch (error) {
    return undefined;
  }
}

function quote(value) {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function activeTarget(explicit) {
  if (explicit) {
    return explicit;
  }
  const editor = vscode.window.activeTextEditor;
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  let dir = editor && editor.document.languageId === "djinn" ? path.dirname(editor.document.uri.fsPath) : undefined;
  while (dir) {
    if (fs.existsSync(path.join(dir, "djinn.proj"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  if (editor && editor.document.languageId === "djinn") {
    return editor.document.uri.fsPath;
  }
  return folder ? folder.uri.fsPath : undefined;
}

async function djinncCommand(mode, target) {
  const info = await serverInfo();
  const compiler = settings().get("compilerPath") || (info && info.compiler);
  if (!compiler) {
    throw new Error("djinnc was not found. Set djinn.compilerPath.");
  }
  const runtime = settings().get("runtimeDir") || (info && info.runtimeDir);
  const std = settings().get("stdDir") || (info && info.stdDir);
  const args = [quote(compiler), quote(target)];
  if (runtime) {
    args.push("--runtime-dir", quote(runtime));
  }
  if (std && fs.existsSync(target) && fs.statSync(target).isFile()) {
    args.push("--std", "--std-dir", quote(std));
  }
  if (mode === "check") {
    args.push("--check");
  } else if (mode === "run") {
    args.push("--run");
  }
  return args.join(" ");
}

async function runTask(mode, explicitTarget) {
  const target = activeTarget(explicitTarget);
  if (!target) {
    vscode.window.showWarningMessage("Open a Djinn file or folder first.");
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.isDirty) {
    await editor.document.save();
  }
  let line;
  try {
    line = await djinncCommand(mode, target);
  } catch (error) {
    vscode.window.showErrorMessage(error.message);
    return;
  }
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  const task = new vscode.Task(
    { type: "djinn", command: mode, target },
    folder || vscode.TaskScope.Workspace,
    `djinn ${mode}`,
    "djinn",
    new vscode.ShellExecution(line),
    "$djinnc"
  );
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true, panel: vscode.TaskPanelKind.Shared };
  await vscode.tasks.executeTask(task);
}

const taskProvider = {
  provideTasks() {
    return ["build", "run", "check"].map((mode) => {
      const task = new vscode.Task(
        { type: "djinn", command: mode },
        vscode.TaskScope.Workspace,
        `djinn ${mode}`,
        "djinn",
        new vscode.CustomExecution(async () => {
          const terminal = new vscode.EventEmitter();
          const closed = new vscode.EventEmitter();
          return {
            onDidWrite: terminal.event,
            onDidClose: closed.event,
            open: async () => {
              await runTask(mode);
              closed.fire(0);
            },
            close: () => {},
          };
        }),
        "$djinnc"
      );
      return task;
    });
  },
  resolveTask(task) {
    const mode = task.definition.command;
    const target = task.definition.target;
    return new vscode.Task(
      task.definition,
      task.scope || vscode.TaskScope.Workspace,
      task.name || `djinn ${mode}`,
      "djinn",
      new vscode.CustomExecution(async () => {
        const writer = new vscode.EventEmitter();
        const closed = new vscode.EventEmitter();
        return {
          onDidWrite: writer.event,
          onDidClose: closed.event,
          open: async () => {
            await runTask(mode, target);
            closed.fire(0);
          },
          close: () => {},
        };
      }),
      "$djinnc"
    );
  },
};


function inlineDecoration(color) {
  return vscode.window.createTextEditorDecorationType({
    after: { margin: "0 0 0 2em", color: new vscode.ThemeColor(color) },
    isWholeLine: false,
  });
}

function renderInline(editor) {
  if (!editor || editor.document.languageId !== "djinn") {
    return;
  }
  const errors = [];
  const warnings = [];
  if (settings().get("inlineDiagnostics")) {
    const seen = new Set();
    const diagnostics = vscode.languages.getDiagnostics(editor.document.uri)
      .filter((d) => d.severity <= vscode.DiagnosticSeverity.Warning)
      .sort((a, b) => a.severity - b.severity);
    for (const diagnostic of diagnostics) {
      const line = diagnostic.range.start.line;
      if (seen.has(line)) {
        continue;
      }
      seen.add(line);
      const end = editor.document.lineAt(line).range.end;
      const code = diagnostic.code ? ` [${diagnostic.code.value || diagnostic.code}]` : "";
      const decoration = {
        range: new vscode.Range(end, end),
        renderOptions: { after: { contentText: `${diagnostic.message.split(String.fromCharCode(10))[0]}${code}` } },
      };
      (diagnostic.severity === vscode.DiagnosticSeverity.Error ? errors : warnings).push(decoration);
    }
  }
  editor.setDecorations(errorDecoration, errors);
  editor.setDecorations(warningDecoration, warnings);
}

function renderAllInline() {
  vscode.window.visibleTextEditors.forEach(renderInline);
}

async function showInfo() {
  const info = await serverInfo();
  if (!info) {
    vscode.window.showWarningMessage("The Djinn language server is not running.");
    return;
  }
  output.appendLine(`compiler: ${info.compiler}`);
  output.appendLine(`runtime:  ${info.runtimeDir}`);
  output.appendLine(`std:      ${info.stdDir}`);
  output.appendLine(`indexed:  ${info.units} file(s)`);
  output.show(true);
}

async function activate(context) {
  output = vscode.window.createOutputChannel("Djinn Language Server");
  errorDecoration = inlineDecoration("editorError.foreground");
  warningDecoration = inlineDecoration("editorWarning.foreground");
  context.subscriptions.push(
    output,
    errorDecoration,
    warningDecoration,
    vscode.languages.onDidChangeDiagnostics(renderAllInline),
    vscode.window.onDidChangeVisibleTextEditors(renderAllInline),
    vscode.commands.registerCommand("djinn.restartServer", () => restart(context)),
    vscode.commands.registerCommand("djinn.checkProject", () => runTask("check")),
    vscode.commands.registerCommand("djinn.build", () => runTask("build")),
    vscode.commands.registerCommand("djinn.run", () => runTask("run")),
    vscode.commands.registerCommand("djinn.showServerInfo", showInfo),
    vscode.tasks.registerTaskProvider("djinn", taskProvider),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("djinn")) {
        return;
      }
      renderAllInline();
      if (client && event.affectsConfiguration("djinn.server.path")) {
        restart(context);
      } else if (client) {
        client.sendNotification("workspace/didChangeConfiguration", { settings: { djinn: initializationOptions() } });
      }
    })
  );
  await startClient(context);
}

async function deactivate() {
  await stopClient();
}

module.exports = { activate, deactivate };
