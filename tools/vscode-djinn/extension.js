const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");
const toolchain = require("./src/toolchain");
const build = require("./src/build");
const { DebugProvider } = require("./src/debug");
const perf = require("./src/perf");
const profile = require("./src/profile");
const compare = require("./src/compare");
const { AssemblyView, SCHEME: assemblyScheme } = require("./src/assembly");

let client;
let profileView;
let hints;
let assemblyView;
let projectOnly = false;
let statusItem;
let recordingItem;
let extensionPathValue = "";
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
    compilerPath: toolchain.compiler(),
    runtimeDir: toolchain.runtimeDir(),
    stdDir: toolchain.stdDir(),
    checkOnChange: config.get("checkOnChange"),
    debounceMs: config.get("checkDebounceMs"),
  };
}

async function startClient(context) {
  const command = findServer(context);
  const serverOptions = { command, transport: TransportKind.stdio, options: { env: toolchain.environment() } };
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
  return toolchain.resolveTarget(explicit);
}

async function djinncCommand(mode, target) {
  const info = await serverInfo();
  build.ensureOutputDirectory(target, { mode, info });
  return build.commandLine(target, { mode, info });
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
    new vscode.ShellExecution(line, { env: toolchain.environment() }),
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

const METRICS = [
  { id: "alloc", label: "Allocated bytes", detail: "Total bytes requested at each call site, freed or not" },
  { id: "live", label: "Live at exit (leaks)", detail: "Bytes never freed before the program stopped" },
  { id: "peak", label: "Live at peak", detail: "Bytes alive at the moment memory use was highest" },
  { id: "count", label: "Allocation count", detail: "Number of allocations at each call site" },
];

let loaded;
let allocationMetric = "alloc";

function loadProfile(file, projectRoot) {
  loaded = { file, projectRoot };
  const text = fs.readFileSync(file, "utf8");
  const disassemblyFile = file.replace(/\.txt$/, ".dis");
  const allocations = /-alloc\.txt$/.test(file);
  vscode.commands.executeCommand("setContext", "djinn.profile.allocations", allocations);
  const model = profile.parse(text, {
    projectRoot,
    metric: allocationMetric,
    memory: allocations ? (allocationMetric === "count" ? "count" : "bytes") : /-memory\.txt$/.test(file),
    disassembly: fs.existsSync(disassemblyFile) ? fs.readFileSync(disassemblyFile, "utf8") : "",
  });
  if (model.total === 0) {
    vscode.window.showWarningMessage(`No samples found in ${path.basename(file)}.`);
    return;
  }
  profileView.load(model);
  hints.load(model);
  assemblyView.load(model);
  const top = model.functions[0];
  statusItem.text = allocations
    ? `$(database) ${profile.amount(model, model.total)} (${METRICS.find((metric) => metric.id === allocationMetric).label})`
    : model.memory
      ? `$(database) ${profile.amount(model, model.total)} touched`
      : `$(flame) ${model.total} samples`;
  statusItem.tooltip = `${path.basename(file)}${top ? `\nhottest: ${top.name} (${((top.count / model.total) * 100).toFixed(1)}%)` : ""}`;
  statusItem.show();
  vscode.commands.executeCommand("djinn.profile.focus");
}

async function pickMetric() {
  if (!loaded || !/-alloc\.txt$/.test(loaded.file)) {
    vscode.window.showInformationMessage("Record an allocation profile first (Djinn: Profile memory allocations).");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    METRICS.map((metric) => ({ label: metric.label, description: metric.id === allocationMetric ? "current" : "", detail: metric.detail, id: metric.id })),
    { placeHolder: "What should the profile measure?" }
  );
  if (!picked) {
    return;
  }
  allocationMetric = picked.id;
  loadProfile(loaded.file, loaded.projectRoot);
}

let activeRunner;

async function perfRecord(mode, options = {}) {
  if (process.platform === "darwin") {
    vscode.window.showWarningMessage("Djinn: perf profiling needs Linux (natively or through WSL on Windows).");
    return;
  }
  const target = activeTarget(options.target);
  if (!target) {
    vscode.window.showWarningMessage("Open a Djinn file or folder first.");
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.isDirty) {
    await editor.document.save();
  }
  let prepared;
  try {
    prepared = perf.prepare(target, extensionPathValue, mode, { ...options, info: await serverInfo() });
  } catch (error) {
    vscode.window.showErrorMessage(`Could not prepare the perf run: ${error.message}`);
    return;
  }
  activeRunner = prepared.runnerConfig;
  const { command, args } = perf.commandFor(prepared.runner, prepared.runnerConfig);
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  const task = new vscode.Task(
    { type: "djinn", command: "perf", target },
    folder || vscode.TaskScope.Workspace,
    "djinn perf",
    "djinn",
    new vscode.ShellExecution(command, args)
  );
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true, panel: vscode.TaskPanelKind.Shared };
  const execution = await vscode.tasks.executeTask(task);
  recordingItem.show();
  return new Promise((resolve) => {
    const watcher = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution !== execution) {
        return;
      }
      watcher.dispose();
      recordingItem.hide();
      if (event.exitCode === 0 && fs.existsSync(prepared.output)) {
        if (options.load !== false) {
          loadProfile(prepared.output, prepared.plan.root);
        }
        resolve({ output: prepared.output, root: prepared.plan.root });
      } else {
        vscode.window.showErrorMessage("The perf run failed. See the task terminal for details.");
        resolve(undefined);
      }
    });
  });
}

const LEVELS = ["O0", "O1", "O2", "O3", "Os"];

async function showComparison(files, root) {
  const text = compare.table(files, root, { projectOnly });
  const directory = path.join(root, ".djinn", "perf");
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `compare-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);
  fs.writeFileSync(output, text, "utf8");
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(output));
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function perfLevels(presetLevels, presetDuration, base = {}) {
  let levels = presetLevels;
  let seconds = presetDuration;
  if (!levels) {
    const picked = await vscode.window.showQuickPick(
      LEVELS.map((level) => ({ label: level, picked: level === "O1" || level === "O3" })),
      { canPickMany: true, placeHolder: "Optimization levels to profile and compare (in this order)" }
    );
    if (!picked || picked.length < 2) {
      vscode.window.showInformationMessage("Pick at least two levels.");
      return;
    }
    levels = picked.map((item) => item.label);
  }
  if (seconds === undefined) {
    const configured = Number(toolchain.settings().get("perf.duration") || 0);
    const answer = await vscode.window.showInputBox({
      prompt: "Seconds to record at each level (0 runs the program to completion)",
      value: String(configured > 0 ? configured : 20),
      validateInput: (value) => (Number(value) >= 0 && value !== "" ? undefined : "Enter a number of seconds"),
    });
    if (answer === undefined) {
      return;
    }
    seconds = Number(answer);
  }
  const outputs = [];
  let root;
  for (const [index, level] of levels.entries()) {
    const result = await perfRecord("cpu", { ...base, optimization: level, duration: seconds, load: index === levels.length - 1 });
    if (!result) {
      return;
    }
    outputs.push(result.output);
    root = result.root;
  }
  await showComparison(outputs, root);
}

async function perfCompare() {
  const folder = (loaded && loaded.projectRoot) || (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath);
  const directory = folder ? path.join(folder, ".djinn", "perf") : undefined;
  if (!directory || !fs.existsSync(directory)) {
    vscode.window.showInformationMessage("No profiles found. Record some with Djinn: Profile with perf first.");
    return;
  }
  const files = fs
    .readdirSync(directory)
    .filter((name) => /^profile-.*\.txt$/.test(name) && !/-(alloc|memory)\.txt$/.test(name))
    .sort()
    .reverse();
  const picked = await vscode.window.showQuickPick(
    files.map((name) => ({ label: name, description: compare.levelOf(name) })),
    { canPickMany: true, placeHolder: "Pick the profiles to compare (first is the baseline)" }
  );
  if (!picked || picked.length < 2) {
    return;
  }
  await showComparison(picked.map((item) => path.join(directory, item.label)).reverse(), folder);
}

async function perfImport() {
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: folder ? vscode.Uri.file(path.join(folder.uri.fsPath, ".djinn", "perf")) : undefined,
    filters: { "perf script output": ["txt"] },
    openLabel: "Import profile",
  });
  if (picked && picked[0]) {
    loadProfile(picked[0].fsPath, folder ? folder.uri.fsPath : undefined);
  }
}

function launchProfile(config) {
  const profileSettings = config.profile || {};
  const mode = { cpu: "cpu", allocations: "alloc", pages: "pages" }[profileSettings.kind || "cpu"] || "cpu";
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  let target = config.target;
  if (target && !path.isAbsolute(target) && folder) {
    target = path.join(folder.uri.fsPath, target);
  }
  const base = {
    target,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    frequency: profileSettings.frequency,
    callGraph: profileSettings.callGraph,
    runner: profileSettings.runner,
  };
  if (profileSettings.metric) {
    allocationMetric = profileSettings.metric;
  }
  const duration = profileSettings.duration !== undefined ? Number(profileSettings.duration) : undefined;
  if (Array.isArray(profileSettings.levels) && profileSettings.levels.length >= 2) {
    return perfLevels(profileSettings.levels, duration !== undefined ? duration : 0, base);
  }
  return perfRecord(mode, { ...base, optimization: profileSettings.optimization, duration });
}

function perfStop() {
  const { command, args } = perf.stopCommand(activeRunner);
  const child = require("child_process").spawn(command, args, { windowsHide: true });
  child.on("close", (code) => {
    if (code !== 0) {
      vscode.window.showWarningMessage("No perf recording is running.");
    } else {
      vscode.window.setStatusBarMessage("Stopping perf and converting samples…", 5000);
    }
  });
}

function perfClear() {
  profileView.clear();
  hints.load(undefined);
  assemblyView.clear();
  statusItem.hide();
}

function setProjectOnly(value) {
  projectOnly = value;
  profileView.setProjectOnly(value);
  hints.setProjectOnly(value);
  vscode.commands.executeCommand("setContext", "djinn.profile.projectOnly", value);
}

async function showAssembly(argument) {
  if (!assemblyView.model) {
    vscode.window.showWarningMessage("Profile the program first (Djinn: Profile with perf).");
    return;
  }
  let name;
  let file;
  let line;
  if (argument && argument.entry) {
    name = argument.entry.name;
    file = argument.entry.file;
    line = argument.entry.line;
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "djinn") {
      vscode.window.showWarningMessage("Place the cursor on a line of a .djinn file.");
      return;
    }
    file = editor.document.uri.fsPath;
    line = editor.selection.active.line + 1;
  }
  const symbol = assemblyView.resolve(name, file, line);
  if (!symbol) {
    vscode.window.showWarningMessage("No machine code was found for this line (it may not have run, or was optimized away).");
    return;
  }
  await assemblyView.show(symbol, file, line);
}

async function activate(context) {
  extensionPathValue = context.extensionPath;
  toolchain.init(context);
  profileView = new profile.ProfileView();
  hints = new profile.Hints();
  assemblyView = new AssemblyView();
  vscode.commands.executeCommand("setContext", "djinn.profile.projectOnly", false);
  vscode.commands.executeCommand("setContext", "djinn.profile.allocations", false);
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusItem.command = "djinn.profile.focus";
  recordingItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  recordingItem.text = "$(debug-stop) Stop profiling";
  recordingItem.tooltip = "Stop perf and show the profile";
  recordingItem.command = "djinn.perf.stop";
  recordingItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  context.subscriptions.push(
    hints,
    assemblyView,
    statusItem,
    recordingItem,
    vscode.workspace.registerTextDocumentContentProvider(assemblyScheme, assemblyView),
    vscode.window.onDidChangeTextEditorSelection((event) => assemblyView.syncWith(event.textEditor)),
    vscode.window.onDidChangeActiveTextEditor((editor) => editor && assemblyView.syncWith(editor)),
    vscode.window.onDidChangeVisibleTextEditors(() => assemblyView.decorateAll()),
    vscode.commands.registerCommand("djinn.perf.showAssembly", showAssembly),
    vscode.commands.registerCommand("djinn.perf.projectOnly", () => setProjectOnly(true)),
    vscode.commands.registerCommand("djinn.perf.projectOnly.off", () => setProjectOnly(false)),
    vscode.languages.registerHoverProvider("djinn", { provideHover: (document, position) => hints.hover(document, position) }),
    vscode.commands.registerCommand("djinn.perf.stop", perfStop),
    vscode.window.createTreeView("djinn.profile", { treeDataProvider: profileView }),
    vscode.window.onDidChangeVisibleTextEditors(() => hints.render()),
    vscode.workspace.onDidOpenTextDocument(() => hints.render()),
    vscode.debug.registerDebugConfigurationProvider("djinn", new DebugProvider()),
    vscode.commands.registerCommand("djinn.debug", () =>
      vscode.debug.startDebugging(undefined, { type: "djinn", request: "launch", name: "Djinn: Debug project", args: [] })
    ),
    vscode.commands.registerCommand("djinn.perf.record", () => perfRecord("cpu")),
    vscode.commands.registerCommand("djinn.perf.recordMemory", () => perfRecord("alloc")),
    vscode.commands.registerCommand("djinn.perf.recordPages", () => perfRecord("pages")),
    vscode.commands.registerCommand("djinn.perf.recordLevels", () => perfLevels()),
    vscode.commands.registerCommand("djinn.perf.launch", launchProfile),
    vscode.commands.registerCommand("djinn.perf.compare", perfCompare),
    vscode.commands.registerCommand("djinn.perf.memoryMetric", pickMetric),
    vscode.commands.registerCommand("djinn.perf.import", perfImport),
    vscode.commands.registerCommand("djinn.perf.clear", perfClear),
    vscode.commands.registerCommand("djinn.perf.toggleHints", () => {
      const on = hints.toggle();
      vscode.window.setStatusBarMessage(`Djinn profile hints ${on ? "shown" : "hidden"}`, 2000);
    })
  );
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
