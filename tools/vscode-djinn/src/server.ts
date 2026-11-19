import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from "vscode-languageclient/node";
import { offerInstall } from "./setup";
import * as toolchain from "./toolchain";
import { ServerInfo } from "./types";

function exeName(): string {
  return process.platform === "win32" ? "djinn-lsp.exe" : "djinn-lsp";
}

/** What the language server needs to know about the toolchain; also resent when settings change. */
function initializationOptions(): Record<string, unknown> {
  const config = toolchain.settings();
  return {
    compilerPath: toolchain.compiler(),
    runtimeDir: toolchain.runtimeDir(),
    stdDir: toolchain.stdDir(),
    checkOnChange: config.get("checkOnChange"),
    debounceMs: config.get("checkDebounceMs"),
  };
}

function findServer(context: vscode.ExtensionContext): string {
  const configured = toolchain.settings().get<string>("server.path");
  if (configured) {
    return configured;
  }
  const candidates: (string | undefined)[] = [path.join(context.extensionPath, "bin", exeName()), toolchain.installed("bin", exeName())];
  for (const folder of vscode.workspace.workspaceFolders || []) {
    candidates.push(path.join(folder.uri.fsPath, "djinn-lsp", "build", exeName()));
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return exeName();
}

/** Owns the language client: start, stop, restart and the custom `djinn/info` request. */
export class ServerClient {
  private client: LanguageClient | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {}

  get running(): boolean {
    return this.client !== undefined;
  }

  async start(): Promise<void> {
    const command = findServer(this.context);
    const serverOptions: ServerOptions = { command, transport: TransportKind.stdio, options: { env: toolchain.environment() } };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "file", language: "djinn" },
        { scheme: "untitled", language: "djinn" },
      ],
      initializationOptions: initializationOptions(),
      outputChannel: this.output,
      synchronize: { fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{djinn,proj}") },
    };
    this.client = new LanguageClient("djinn", "Djinn Language Server", serverOptions, clientOptions);
    if (!toolchain.settings().get("server.path") && !fs.existsSync(command) && !toolchain.installed("bin", exeName())) {
      void offerInstall();
    }
    try {
      await this.client.start();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Could not start djinn-lsp (${command}). Build it with djinn-lsp/build.sh or set djinn.server.path. ${reason}`);
    }
  }

  async stop(): Promise<void> {
    const current = this.client;
    if (current) {
      this.client = undefined;
      await current.stop().catch(() => undefined);
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async info(): Promise<ServerInfo | undefined> {
    if (!this.client) {
      return undefined;
    }
    try {
      return await this.client.sendRequest<ServerInfo>("djinn/info");
    } catch {
      return undefined;
    }
  }

  /** Reacts to a settings change: a new server path restarts, anything else is pushed to the running server. */
  onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (!this.client) {
      return;
    }
    if (event.affectsConfiguration("djinn.server.path")) {
      void this.restart();
    } else {
      void this.client.sendNotification("workspace/didChangeConfiguration", { settings: { djinn: initializationOptions() } });
    }
  }
}
