import * as path from "path";
import * as vscode from "vscode";
import * as build from "./build";
import * as toolchain from "./toolchain";
import { BuildMode, ServerInfo } from "./types";

const MODES: BuildMode[] = ["build", "run", "check"];

const presentation: vscode.TaskPresentationOptions = {
  reveal: vscode.TaskRevealKind.Always,
  clear: true,
  panel: vscode.TaskPanelKind.Shared,
};

export function firstFolder(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
}

export async function saveActiveEditor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.isDirty) {
    await editor.document.save();
  }
}

let libraryOutput: vscode.OutputChannel | undefined;

/** Builds the project's libraries that are missing from the library directory, showing the compiler output in the Djinn Build channel. */
async function ensureLibraries(target: string, info: ServerInfo | undefined): Promise<void> {
  libraryOutput = libraryOutput || vscode.window.createOutputChannel("Djinn Build");
  const output = libraryOutput;
  let shown = false;
  await build.ensureLibraries(target, { info }, (text) => {
    if (!shown) {
      output.show(true);
      shown = true;
    }
    output.append(text);
  });
}

/** Builds, runs or checks the active project (or `explicitTarget`) in a shell task. */
export async function runTask(mode: BuildMode, getInfo: () => Promise<ServerInfo | undefined>, explicitTarget?: string): Promise<void> {
  const target = toolchain.resolveTarget(explicitTarget);
  if (!target) {
    vscode.window.showWarningMessage("Open a Djinn file or folder first.");
    return;
  }
  await saveActiveEditor();
  let line: string;
  try {
    const info = await getInfo();
    await ensureLibraries(target, info);
    build.ensureOutputDirectory(target, { mode, info });
    line = build.commandLine(target, { mode, info });
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    return;
  }
  const task = new vscode.Task(
    { type: "djinn", command: mode, target },
    firstFolder() || vscode.TaskScope.Workspace,
    `djinn ${mode}`,
    "djinn",
    new vscode.ShellExecution(line, { env: toolchain.environment() }),
    "$djinnc"
  );
  task.presentationOptions = presentation;
  const execution = await vscode.tasks.executeTask(task);
  if (mode === "run") {
    startAfterBuild(execution, target, firstFolder());
  }
}

/** When the build task of a "run" ends successfully, starts the program it produced in its own task so its output stays visible. */
function startAfterBuild(buildExecution: vscode.TaskExecution, target: string, folder: vscode.WorkspaceFolder | undefined): void {
  const listener = vscode.tasks.onDidEndTaskProcess((event) => {
    if (event.execution !== buildExecution) {
      return;
    }
    listener.dispose();
    if (event.exitCode !== 0) {
      return;
    }
    const plan = build.describe(target);
    if (plan.isLibrary) {
      vscode.window.showWarningMessage("This project is a library (.djlib): it has no entry point to run.");
      return;
    }
    const run = new vscode.Task(
      { type: "djinn", command: "run", target },
      folder || vscode.TaskScope.Workspace,
      "djinn run program",
      "djinn",
      new vscode.ShellExecution({ value: plan.program, quoting: vscode.ShellQuoting.Strong }, [], { cwd: path.dirname(plan.program), env: toolchain.environment() })
    );
    run.presentationOptions = { ...presentation, clear: false };
    void vscode.tasks.executeTask(run);
  });
}

interface DjinnTaskDefinition extends vscode.TaskDefinition {
  command: BuildMode;
  target?: string;
}

/** A task that runs `runTask` inside a pseudoterminal so it can be listed and referenced from tasks.json. */
function customTask(
  definition: DjinnTaskDefinition,
  scope: vscode.WorkspaceFolder | vscode.TaskScope,
  name: string,
  getInfo: () => Promise<ServerInfo | undefined>
): vscode.Task {
  const execution = new vscode.CustomExecution(async () => {
    const writer = new vscode.EventEmitter<string>();
    const closed = new vscode.EventEmitter<number | void>();
    const terminal: vscode.Pseudoterminal = {
      onDidWrite: writer.event,
      onDidClose: closed.event,
      open: async () => {
        await runTask(definition.command, getInfo, definition.target);
        closed.fire(0);
      },
      close: () => undefined,
    };
    return terminal;
  });
  return new vscode.Task(definition, scope, name, "djinn", execution, "$djinnc");
}

export function taskProvider(getInfo: () => Promise<ServerInfo | undefined>): vscode.TaskProvider {
  return {
    provideTasks: () => MODES.map((mode) => customTask({ type: "djinn", command: mode }, vscode.TaskScope.Workspace, `djinn ${mode}`, getInfo)),
    resolveTask: (task) => {
      const definition = task.definition as DjinnTaskDefinition;
      return customTask(definition, task.scope || vscode.TaskScope.Workspace, task.name || `djinn ${definition.command}`, getInfo);
    },
  };
}

export { presentation as taskPresentation };
