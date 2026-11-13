const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const build = require("./build");
const toolchain = require("./toolchain");

function targetFor(config) {
  return toolchain.resolveTarget(config.target);
}

function nativeConfiguration(config, program, cwd) {
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

class DebugProvider {
  provideDebugConfigurations() {
    return [
      { type: "djinn", request: "launch", name: "Djinn: Debug project", args: [] },
      { type: "djinn", request: "launch", name: "Djinn: Profile CPU", mode: "profile", target: "${workspaceFolder}", args: [], profile: { kind: "cpu", optimization: "O2" } },
    ];
  }

  resolveDebugConfiguration(folder, config) {
    if (!config.type) {
      return { type: "djinn", request: "launch", name: "Djinn: Debug project", args: [] };
    }
    return config;
  }

  async resolveDebugConfigurationWithSubstitutedVariables(folder, config) {
    if (config.mode === "profile") {
      await vscode.commands.executeCommand("djinn.perf.launch", config);
      return undefined;
    }
    const target = targetFor(config);
    if (!target) {
      vscode.window.showWarningMessage("Open a Djinn file or folder first.");
      return undefined;
    }

    const output = vscode.window.createOutputChannel("Djinn Build");
    let program = config.program;
    try {
      if (config.build !== false) {
        output.show(true);
        output.appendLine(`> building ${target} with debug info`);
        const result = await build.run(target, { mode: "build", debug: true, info: undefined }, (text) => output.append(text));
        program = program || result.plan.program;
      } else {
        program = program || build.describe(target, {}).program;
      }
    } catch (error) {
      output.appendLine(String(error.message || error));
      vscode.window.showErrorMessage("Djinn build failed. See the Djinn Build output.");
      return undefined;
    }

    if (!fs.existsSync(program)) {
      vscode.window.showErrorMessage(`Program not found: ${program}`);
      return undefined;
    }
    const cwd = config.cwd || path.dirname(program);
    const native = nativeConfiguration(config, program, cwd);
    const started = await vscode.debug.startDebugging(folder, native);
    if (!started) {
      vscode.window.showErrorMessage(
        `Could not start the ${native.type} debugger. Install the "C/C++" extension (ms-vscode.cpptools).`
      );
    }
    return undefined;
  }
}

module.exports = { DebugProvider };
