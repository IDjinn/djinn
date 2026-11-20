import * as vscode from "vscode";
import { Android } from "./android";
import { DebugAdapterFactory, DebugProvider } from "./debug";
import { InlineDiagnostics } from "./diagnostics";
import { Profiling } from "./profiling";
import { ServerClient } from "./server";
import { runSetup } from "./setup";
import { runTask, taskProvider } from "./tasks";
import * as toolchain from "./toolchain";

let server: ServerClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  toolchain.init(context);
  const output = vscode.window.createOutputChannel("Djinn Language Server");
  const client = new ServerClient(context, output);
  server = client;
  const getInfo = (): ReturnType<ServerClient["info"]> => client.info();
  const profiling = new Profiling(getInfo);
  const diagnostics = new InlineDiagnostics();
  const android = new Android(getInfo);

  const showInfo = async (): Promise<void> => {
    const info = await client.info();
    if (!info) {
      vscode.window.showWarningMessage("The Djinn language server is not running.");
      return;
    }
    output.appendLine(`compiler: ${info.compiler}`);
    output.appendLine(`runtime:  ${info.runtimeDir}`);
    output.appendLine(`std:      ${info.stdDir}`);
    output.appendLine(`indexed:  ${info.units} file(s)`);
    output.show(true);
  };

  context.subscriptions.push(
    output,
    diagnostics,
    ...profiling.register(),
    ...android.register(),
    vscode.debug.registerDebugConfigurationProvider("djinn", new DebugProvider(getInfo, android)),
    vscode.debug.registerDebugAdapterDescriptorFactory("djinn", new DebugAdapterFactory()),
    vscode.tasks.registerTaskProvider("djinn", taskProvider(getInfo)),
    vscode.commands.registerCommand("djinn.install", () => runSetup("install")),
    vscode.commands.registerCommand("djinn.update", () => runSetup("update")),
    vscode.commands.registerCommand("djinn.debug", () =>
      vscode.debug.startDebugging(undefined, { type: "djinn", request: "launch", name: "Djinn: Debug project", args: [] })
    ),
    vscode.commands.registerCommand("djinn.restartServer", () => client.restart()),
    vscode.commands.registerCommand("djinn.checkProject", () => runTask("check", getInfo)),
    vscode.commands.registerCommand("djinn.build", () => runTask("build", getInfo)),
    vscode.commands.registerCommand("djinn.run", () => runTask("run", getInfo)),
    vscode.commands.registerCommand("djinn.showServerInfo", showInfo),
    vscode.languages.onDidChangeDiagnostics(diagnostics.renderAll),
    vscode.window.onDidChangeVisibleTextEditors(diagnostics.renderAll),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("djinn")) {
        return;
      }
      diagnostics.renderAll();
      client.onConfigurationChanged(event);
    })
  );
  await client.start();
}

export async function deactivate(): Promise<void> {
  await server?.stop();
}
