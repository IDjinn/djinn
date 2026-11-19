import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as toolchain from "./toolchain";

const RELEASES = "https://github.com/IDjinn/djinn-lang-v3/releases/latest/download";

export type SetupMode = "install" | "update";

/** The shell command that installs or updates the toolchain (the installed setup script, or the release installer). */
function setupCommand(mode: SetupMode): string {
  const home = toolchain.installHome();
  if (process.platform === "win32") {
    const script = path.join(home, "bin", "djinn-setup.ps1");
    if (fs.existsSync(script)) {
      return `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" -Mode ${mode}`;
    }
    return `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${RELEASES}/install.ps1 | iex"`;
  }
  const script = path.join(home, "bin", "djinn-setup");
  if (fs.existsSync(script)) {
    return `"${script}" ${mode}`;
  }
  return `curl -fsSL ${RELEASES}/install.sh | sh`;
}

export function runSetup(mode: SetupMode): void {
  const terminal = vscode.window.createTerminal("Djinn Setup");
  terminal.show();
  terminal.sendText(setupCommand(mode));
}

let offered = false;

/** Offers to install the toolchain, once per session. */
export async function offerInstall(): Promise<void> {
  if (offered) {
    return;
  }
  offered = true;
  const choice = await vscode.window.showWarningMessage("Djinn is not installed. Install the toolchain and language server?", "Install", "Later");
  if (choice === "Install") {
    runSetup("install");
  }
}
