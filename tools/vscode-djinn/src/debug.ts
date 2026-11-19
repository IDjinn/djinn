import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as build from "./build";
import * as toolchain from "./toolchain";
import { LaunchConfig } from "./types";

function nativeConfiguration(config: LaunchConfig, program: string, cwd: string): vscode.DebugConfiguration {
  const name = config.name || "Djinn: Debug";
  const args = config.args || [];
  if (process.platform === "win32") {
    return {
      type: "cppvsdbg",
      request: "launch",
      name,
      program,
      args,
      cwd,
      stopAtEntry: Boolean(config.stopAtEntry),
      symbolSearchPath: path.dirname(program),
      environment: [],
      console: config.console || "integratedTerminal",
    };
  }
  return {
    type: "cppdbg",
    request: "launch",
    name,
    program,
    args,
    cwd,
    stopAtEntry: Boolean(config.stopAtEntry),
    MIMode: config.MIMode || "gdb",
    externalConsole: false,
  };
}

/**
 * The `djinn` debug type only forwards to the native debugger (cppvsdbg/cppdbg) from the configuration provider, so its own
 * session never talks DAP. A descriptor is still registered so VS Code never reports "cannot find a debug adapter for djinn".
 */
export class DebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(): vscode.DebugAdapterDescriptor {
    const messages = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    const adapter: vscode.DebugAdapter = {
      onDidSendMessage: messages.event,
      handleMessage: (message) => {
        const request = message as { seq: number; type: string; command?: string };
        if (request.type === "request") {
          messages.fire({ type: "response", request_seq: request.seq, seq: 0, success: true, command: request.command } as vscode.DebugProtocolMessage);
          if (request.command === "initialize") {
            messages.fire({ type: "event", event: "terminated", seq: 0 } as vscode.DebugProtocolMessage);
          }
        }
      },
      dispose: () => messages.dispose(),
    };
    return new vscode.DebugAdapterInlineImplementation(adapter);
  }
}

export class DebugProvider implements vscode.DebugConfigurationProvider {
  provideDebugConfigurations(): vscode.DebugConfiguration[] {
    return [
      { type: "djinn", request: "launch", name: "Djinn: Debug project", args: [] },
      { type: "djinn", request: "launch", name: "Djinn: Profile CPU", mode: "profile", target: "${workspaceFolder}", args: [], profile: { kind: "cpu", optimization: "O2" } },
    ];
  }

  resolveDebugConfiguration(_folder: vscode.WorkspaceFolder | undefined, config: vscode.DebugConfiguration): vscode.DebugConfiguration {
    if (!config.type) {
      return { type: "djinn", request: "launch", name: "Djinn: Debug project", args: [] };
    }
    return config;
  }

  async resolveDebugConfigurationWithSubstitutedVariables(
    folder: vscode.WorkspaceFolder | undefined,
    debugConfig: vscode.DebugConfiguration
  ): Promise<undefined> {
    const config = debugConfig as LaunchConfig;
    if (config.mode === "profile") {
      await vscode.commands.executeCommand("djinn.perf.launch", config);
      return undefined;
    }
    const target = toolchain.resolveTarget(config.target);
    if (!target) {
      vscode.window.showWarningMessage("Open a Djinn file or folder first.");
      return undefined;
    }
    if (build.describe(target).isLibrary) {
      vscode.window.showWarningMessage("This project is a library (.djlib): it has no entry point to run or debug.");
      return undefined;
    }
    const output = vscode.window.createOutputChannel("Djinn Build");
    let program = config.program;
    try {
      if (config.build !== false) {
        output.show(true);
        output.appendLine(`> building ${target} with debug info`);
        const result = await build.run(target, { mode: "build", debug: true }, (text) => output.append(text));
        program = program || result.plan.program;
      } else {
        program = program || build.describe(target).program;
      }
    } catch (error) {
      output.appendLine(error instanceof Error ? error.message : String(error));
      vscode.window.showErrorMessage("Djinn build failed. See the Djinn Build output.");
      return undefined;
    }

    if (!program || !fs.existsSync(program)) {
      vscode.window.showErrorMessage(`Program not found: ${program}`);
      return undefined;
    }
    const cwd = config.cwd || path.dirname(program);
    const native = nativeConfiguration(config, program, cwd);
    const started = await vscode.debug.startDebugging(folder, native);
    if (!started) {
      vscode.window.showErrorMessage(`Could not start the ${native.type} debugger. Install the "C/C++" extension (ms-vscode.cpptools).`);
    }
    return undefined;
  }
}
