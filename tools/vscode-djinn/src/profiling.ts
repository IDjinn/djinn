import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { AssemblyView, SCHEME as assemblyScheme } from "./assembly";
import * as compare from "./compare";
import * as perf from "./perf";
import * as profile from "./profile";
import { firstFolder, saveActiveEditor, taskPresentation } from "./tasks";
import * as toolchain from "./toolchain";
import { AllocationMetric, LaunchConfig, PerfMode, PerfOverrides, PerfRunner, ServerInfo } from "./types";

interface MetricChoice {
  id: AllocationMetric;
  label: string;
  detail: string;
}

const METRICS: MetricChoice[] = [
  { id: "alloc", label: "Allocated bytes", detail: "Total bytes requested at each call site, freed or not" },
  { id: "live", label: "Live at exit (leaks)", detail: "Bytes never freed before the program stopped" },
  { id: "peak", label: "Live at peak", detail: "Bytes alive at the moment memory use was highest" },
  { id: "count", label: "Allocation count", detail: "Number of allocations at each call site" },
];

const LEVELS = ["O0", "O1", "O2", "O3", "Os"];

const PROFILE_KINDS: Record<string, PerfMode> = { cpu: "cpu", allocations: "alloc", pages: "pages" };

interface LoadedProfile {
  file: string;
  projectRoot?: string;
}

interface RecordedProfile {
  output: string;
  root: string;
}

const isAllocationProfile = (file: string): boolean => /-alloc\.txt$/.test(file);

/** Everything that records, loads and shows profiles: the tree view, source hints, assembly view and perf runs. */
export class Profiling implements vscode.Disposable {
  private readonly profileView = new profile.ProfileView();
  private readonly hints = new profile.Hints();
  private readonly assemblyView = new AssemblyView();
  private readonly statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  private readonly recordingItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
  private loaded: LoadedProfile | undefined;
  private allocationMetric: AllocationMetric = "alloc";
  private projectOnly = false;
  private activeRunner: PerfRunner | undefined;

  constructor(private readonly getInfo: () => Promise<ServerInfo | undefined>) {
    void vscode.commands.executeCommand("setContext", "djinn.profile.projectOnly", false);
    void vscode.commands.executeCommand("setContext", "djinn.profile.allocations", false);
    this.statusItem.command = "djinn.profile.focus";
    this.recordingItem.text = "$(debug-stop) Stop profiling";
    this.recordingItem.tooltip = "Stop perf and show the profile";
    this.recordingItem.command = "djinn.perf.stop";
    this.recordingItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  }

  /** Registers the views, providers and commands; the returned disposables belong to the extension context. */
  register(): vscode.Disposable[] {
    const command = (id: string, handler: (...args: any[]) => unknown): vscode.Disposable => vscode.commands.registerCommand(id, handler);
    return [
      this,
      vscode.workspace.registerTextDocumentContentProvider(assemblyScheme, this.assemblyView),
      vscode.window.onDidChangeTextEditorSelection((event) => this.assemblyView.syncWith(event.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((editor) => editor && this.assemblyView.syncWith(editor)),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        this.assemblyView.decorateAll();
        this.hints.render();
      }),
      vscode.workspace.onDidOpenTextDocument(() => this.hints.render()),
      vscode.window.createTreeView("djinn.profile", { treeDataProvider: this.profileView }),
      vscode.languages.registerHoverProvider("djinn", { provideHover: (document, position) => this.hints.hover(document, position) }),
      command("djinn.perf.showAssembly", (argument?: { entry?: profile.FunctionEntry }) => this.showAssembly(argument)),
      command("djinn.perf.projectOnly", () => this.setProjectOnly(true)),
      command("djinn.perf.projectOnly.off", () => this.setProjectOnly(false)),
      command("djinn.perf.stop", () => this.stop()),
      command("djinn.perf.record", () => this.record("cpu")),
      command("djinn.perf.recordMemory", () => this.record("alloc")),
      command("djinn.perf.recordPages", () => this.record("pages")),
      command("djinn.perf.recordLevels", () => this.recordLevels()),
      command("djinn.perf.launch", (config: LaunchConfig) => this.launch(config)),
      command("djinn.perf.compare", () => this.pickAndCompare()),
      command("djinn.perf.memoryMetric", () => this.pickMetric()),
      command("djinn.perf.import", () => this.importProfile()),
      command("djinn.perf.clear", () => this.clear()),
      command("djinn.perf.toggleHints", () => {
        const on = this.hints.toggle();
        vscode.window.setStatusBarMessage(`Djinn profile hints ${on ? "shown" : "hidden"}`, 2000);
      }),
    ];
  }

  private loadProfile(file: string, projectRoot: string | undefined): void {
    this.loaded = { file, projectRoot };
    const text = fs.readFileSync(file, "utf8");
    const disassemblyFile = file.replace(/\.txt$/, ".dis");
    const allocations = isAllocationProfile(file);
    void vscode.commands.executeCommand("setContext", "djinn.profile.allocations", allocations);
    const memory = allocations ? (this.allocationMetric === "count" ? "count" : "bytes") : /-memory\.txt$/.test(file);
    const model = profile.parse(text, {
      projectRoot,
      metric: this.allocationMetric,
      memory,
      disassembly: fs.existsSync(disassemblyFile) ? fs.readFileSync(disassemblyFile, "utf8") : "",
    });
    if (model.total === 0) {
      vscode.window.showWarningMessage(`No samples found in ${path.basename(file)}.`);
      return;
    }
    this.profileView.load(model);
    this.hints.load(model);
    this.assemblyView.load(model);
    const top = model.functions[0];
    const metric = METRICS.find((choice) => choice.id === this.allocationMetric);
    this.statusItem.text = allocations
      ? `$(database) ${profile.amount(model, model.total)} (${metric ? metric.label : this.allocationMetric})`
      : model.memory
        ? `$(database) ${profile.amount(model, model.total)} touched`
        : `$(flame) ${model.total} samples`;
    this.statusItem.tooltip = `${path.basename(file)}${top ? `\nhottest: ${top.name} (${((top.count / model.total) * 100).toFixed(1)}%)` : ""}`;
    this.statusItem.show();
    void vscode.commands.executeCommand("djinn.profile.focus");
  }

  private async pickMetric(): Promise<void> {
    if (!this.loaded || !isAllocationProfile(this.loaded.file)) {
      vscode.window.showInformationMessage("Record an allocation profile first (Djinn: Profile memory allocations).");
      return;
    }
    const picked = await vscode.window.showQuickPick(
      METRICS.map((metric) => ({ label: metric.label, description: metric.id === this.allocationMetric ? "current" : "", detail: metric.detail, id: metric.id })),
      { placeHolder: "What should the profile measure?" }
    );
    if (!picked) {
      return;
    }
    this.allocationMetric = picked.id;
    this.loadProfile(this.loaded.file, this.loaded.projectRoot);
  }

  /** Compiles the target for Linux, records it with perf and (unless `load` is false) shows the result. */
  async record(mode: PerfMode, options: PerfOverrides = {}): Promise<RecordedProfile | undefined> {
    if (process.platform === "darwin") {
      vscode.window.showWarningMessage("Djinn: perf profiling needs Linux (natively or through WSL on Windows).");
      return undefined;
    }
    const target = toolchain.resolveTarget(options.target);
    if (!target) {
      vscode.window.showWarningMessage("Open a Djinn file or folder first.");
      return undefined;
    }
    await saveActiveEditor();
    let prepared: perf.PreparedRun;
    try {
      prepared = perf.prepare(target, mode, { ...options, info: await this.getInfo() });
    } catch (error) {
      vscode.window.showErrorMessage(`Could not prepare the perf run: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
    this.activeRunner = prepared.runnerConfig;
    const { command, args } = perf.commandFor(prepared.runner, prepared.runnerConfig);
    const task = new vscode.Task({ type: "djinn", command: "perf", target }, firstFolder() || vscode.TaskScope.Workspace, "djinn perf", "djinn", new vscode.ShellExecution(command, args));
    task.presentationOptions = taskPresentation;
    const execution = await vscode.tasks.executeTask(task);
    this.recordingItem.show();
    return new Promise((resolve) => {
      const watcher = vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution !== execution) {
          return;
        }
        watcher.dispose();
        this.recordingItem.hide();
        if (event.exitCode === 0 && fs.existsSync(prepared.output)) {
          if (options.load !== false) {
            this.loadProfile(prepared.output, prepared.plan.root);
          }
          resolve({ output: prepared.output, root: prepared.plan.root });
        } else {
          vscode.window.showErrorMessage("The perf run failed. See the task terminal for details.");
          resolve(undefined);
        }
      });
    });
  }

  private async showComparison(files: string[], root: string | undefined): Promise<void> {
    const text = compare.table(files, root, { projectOnly: this.projectOnly });
    const directory = path.join(root || firstFolder()?.uri.fsPath || ".", ".djinn", "perf");
    fs.mkdirSync(directory, { recursive: true });
    const output = path.join(directory, `compare-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`);
    fs.writeFileSync(output, text, "utf8");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(output));
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
  }

  /** Records the same program at several optimization levels and opens a comparison table. */
  async recordLevels(presetLevels?: string[], presetDuration?: number, base: PerfOverrides = {}): Promise<void> {
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
    const outputs: string[] = [];
    let root: string | undefined;
    for (const [index, level] of levels.entries()) {
      const result = await this.record("cpu", { ...base, optimization: level, duration: seconds, load: index === levels.length - 1 });
      if (!result) {
        return;
      }
      outputs.push(result.output);
      root = result.root;
    }
    await this.showComparison(outputs, root);
  }

  private async pickAndCompare(): Promise<void> {
    const folder = (this.loaded && this.loaded.projectRoot) || firstFolder()?.uri.fsPath;
    const directory = folder ? path.join(folder, ".djinn", "perf") : undefined;
    if (!folder || !directory || !fs.existsSync(directory)) {
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
    await this.showComparison(picked.map((item) => path.join(directory, item.label)).reverse(), folder);
  }

  private async importProfile(): Promise<void> {
    const folder = firstFolder();
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: folder ? vscode.Uri.file(path.join(folder.uri.fsPath, ".djinn", "perf")) : undefined,
      filters: { "perf script output": ["txt"] },
      openLabel: "Import profile",
    });
    if (picked && picked[0]) {
      this.loadProfile(picked[0].fsPath, folder ? folder.uri.fsPath : undefined);
    }
  }

  /** Runs a `djinn` launch configuration that has `"mode": "profile"`. */
  private async launch(config: LaunchConfig): Promise<void> {
    const settings = config.profile || {};
    const mode = PROFILE_KINDS[settings.kind || "cpu"] || "cpu";
    const folder = firstFolder();
    let target = config.target;
    if (target && !path.isAbsolute(target) && folder) {
      target = path.join(folder.uri.fsPath, target);
    }
    const base: PerfOverrides = {
      target,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      frequency: settings.frequency,
      callGraph: settings.callGraph,
      runner: settings.runner,
    };
    if (settings.metric) {
      this.allocationMetric = settings.metric;
    }
    const duration = settings.duration !== undefined ? Number(settings.duration) : undefined;
    if (Array.isArray(settings.levels) && settings.levels.length >= 2) {
      await this.recordLevels(settings.levels, duration !== undefined ? duration : 0, base);
      return;
    }
    await this.record(mode, { ...base, optimization: settings.optimization, duration });
  }

  private stop(): void {
    const { command, args } = perf.stopCommand(this.activeRunner);
    const child = cp.spawn(command, args, { windowsHide: true });
    child.on("close", (code) => {
      if (code !== 0) {
        vscode.window.showWarningMessage("No perf recording is running.");
      } else {
        vscode.window.setStatusBarMessage("Stopping perf and converting samples…", 5000);
      }
    });
  }

  private clear(): void {
    this.profileView.clear();
    this.hints.load(undefined);
    this.assemblyView.clear();
    this.statusItem.hide();
  }

  private setProjectOnly(value: boolean): void {
    this.projectOnly = value;
    this.profileView.setProjectOnly(value);
    this.hints.setProjectOnly(value);
    void vscode.commands.executeCommand("setContext", "djinn.profile.projectOnly", value);
  }

  private async showAssembly(argument?: { entry?: profile.FunctionEntry }): Promise<void> {
    if (!this.assemblyView.model) {
      vscode.window.showWarningMessage("Profile the program first (Djinn: Profile with perf).");
      return;
    }
    let name: string | undefined;
    let file: string | undefined;
    let line: number | undefined;
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
    const symbol = this.assemblyView.resolve(name, file, line);
    if (!symbol) {
      vscode.window.showWarningMessage("No machine code was found for this line (it may not have run, or was optimized away).");
      return;
    }
    await this.assemblyView.show(symbol, file, line);
  }

  dispose(): void {
    this.hints.dispose();
    this.assemblyView.dispose();
    this.statusItem.dispose();
    this.recordingItem.dispose();
  }
}
