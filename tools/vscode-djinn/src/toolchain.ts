import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ServerInfo } from "./types";

let extensionPath = "";

export function init(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;
}

export function settings(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("djinn");
}

export function exists(candidate: string | undefined): boolean {
  return Boolean(candidate) && fs.existsSync(candidate as string);
}

export function bundled(...parts: string[]): string | undefined {
  const candidate = path.join(extensionPath, ...parts);
  return fs.existsSync(candidate) ? candidate : undefined;
}

export function exe(name: string): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

export function repoRoot(): string | undefined {
  const starts: string[] = [...(vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath), extensionPath];
  for (const start of starts) {
    let dir: string = start;
    while (dir) {
      if (exists(path.join(dir, "djinnc", "djinn.proj")) && exists(path.join(dir, "std")) && exists(path.join(dir, "runtime"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  return undefined;
}

function inRepo(...parts: string[]): string | undefined {
  const root = repoRoot();
  const candidate = root ? path.join(root, ...parts) : undefined;
  return candidate && fs.existsSync(candidate) ? candidate : undefined;
}

// The toolchain put in place by the installer (installer/install.sh, installer/install.ps1):
// <home>/current -> versions/<tag> with bin, lib, runtime and std. The auto update swaps `current`.
export function installHome(): string {
  if (process.env.DJINN_HOME) {
    return process.env.DJINN_HOME;
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Djinn");
  }
  return path.join(os.homedir(), ".djinn");
}

export function installed(...parts: string[]): string | undefined {
  const candidate = path.join(installHome(), "current", ...parts);
  return fs.existsSync(candidate) ? candidate : undefined;
}

function firstExisting(...candidates: (string | undefined)[]): string | undefined {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

export function compiler(info?: ServerInfo): string {
  return settings().get<string>("compilerPath") || installed("bin", exe("djinnc")) || bundled("bin", exe("djinnc")) || (info && info.compiler) || inRepo("djinnc", "build", exe("djinnc")) || "";
}

export function stdDir(info?: ServerInfo): string {
  return settings().get<string>("stdDir") || installed("std") || bundled("toolchain", "std") || (info && info.stdDir) || inRepo("std") || "";
}

export function runtimeDir(info?: ServerInfo): string {
  return settings().get<string>("runtimeDir") || installed("runtime") || bundled("toolchain", "runtime") || (info && info.runtimeDir) || inRepo("runtime") || "";
}

export function runtimeLib(): string {
  const name = process.platform === "win32" ? "djinn_runtime.lib" : "libdjinn_runtime.a";
  const fromRepo = inRepo("build", "runtime", name) || inRepo("build", "bootstrap", "runtime", name);
  // Libraries built in a checkout (build/libs) pair with the checkout's runtime: the installed one can be older and miss symbols they use.
  const checkoutLibs = !installed("lib", "std.djlib") && !bundled("toolchain") && libDir() !== "";
  // A runtime built in the open checkout that is newer than the installed one has symbols the installed one lacks (the checkout's
  // sources use them), so it wins without any setting.
  const installedLib = installed("lib", name);
  const newerInCheckout = Boolean(fromRepo && installedLib && fs.statSync(fromRepo).mtimeMs > fs.statSync(installedLib).mtimeMs);
  return settings().get<string>("runtimeLib") || (checkoutLibs || newerInCheckout ? fromRepo : undefined) || installedLib || bundled("toolchain", name) || fromRepo || "";
}

export function libDir(): string {
  return (
    settings().get<string>("libDir") ||
    (installed("lib", "std.djlib") ? installed("lib") : undefined) ||
    bundled("toolchain") ||
    firstExisting(...["build/bootstrap/libs", "build/libs"].map((relative) => inRepo(...relative.split("/")))) ||
    ""
  );
}

export function linuxCompiler(): string {
  return settings().get<string>("perf.compiler") || bundled("toolchain", "linux", "djinnc") || inRepo("djinnc", "build", "djinnc") || "";
}

export function linuxRuntimeLib(): string {
  return (
    settings().get<string>("perf.runtimeLib") ||
    bundled("toolchain", "linux", "libdjinn_runtime.a") ||
    inRepo("build", "runtime", "libdjinn_runtime.a") ||
    inRepo("build", "bootstrap", "runtime", "libdjinn_runtime.a") ||
    ""
  );
}

export function allocationReport(): string {
  return bundled("scripts", "alloc_report.py") || "";
}

export function llvmBin(): string {
  const configured = settings().get<string>("llvmBinDir");
  if (configured) {
    return configured;
  }
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter((root): root is string => Boolean(root));
  const candidate = roots.map((root) => path.join(root, "LLVM", "bin")).find((directory) => fs.existsSync(directory));
  return process.platform === "win32" && candidate ? candidate : "";
}

export function environment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  const llvm = llvmBin();
  if (llvm) {
    env.PATH = `${llvm}${path.delimiter}${env.PATH || ""}`;
  }
  return env;
}

export function toWslPath(windowsPath: string): string {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(windowsPath);
  if (!match) {
    return windowsPath.replace(/\\/g, "/");
  }
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

export function fromWslPath(wslPath: string): string | undefined {
  const match = /^\/mnt\/([a-z])\/(.*)$/.exec(wslPath);
  if (!match) {
    return undefined;
  }
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
}

function inside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function findProject(start: string): string | undefined {
  let dir = start;
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
  return undefined;
}

export function resolveTarget(explicit?: string): string | undefined {
  if (explicit) {
    return explicit;
  }
  const editor = vscode.window.activeTextEditor;
  const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  const file = editor && editor.document.languageId === "djinn" ? editor.document.uri.fsPath : undefined;
  const own = file && !isInsideExtension(file) ? file : undefined;
  const project = own ? findProject(path.dirname(own)) : undefined;
  if (project) {
    return project;
  }
  const workspace = folder ? findProject(folder.uri.fsPath) : undefined;
  const fallback = workspace || own || (folder ? folder.uri.fsPath : undefined);
  return fallback && !isInsideExtension(fallback) ? fallback : undefined;
}

export function isInsideExtension(file: string): boolean {
  const resolved = path.resolve(file);
  if (/[\\/]extensions[\\/][^\\/]*djinn-lang[^\\/]*(?:[\\/]|$)/i.test(resolved)) {
    return true;
  }
  return Boolean(extensionPath) && (resolved === path.resolve(extensionPath) || inside(resolved, path.resolve(extensionPath)));
}
