const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

let extensionPath = "";

function init(context) {
  extensionPath = context.extensionPath;
}

function settings() {
  return vscode.workspace.getConfiguration("djinn");
}

function exists(candidate) {
  return candidate && fs.existsSync(candidate);
}

function bundled(...parts) {
  const candidate = path.join(extensionPath, ...parts);
  return fs.existsSync(candidate) ? candidate : undefined;
}

function exe(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function repoRoot() {
  const starts = [...(vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath), extensionPath];
  for (const start of starts) {
    let dir = start;
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

function inRepo(...parts) {
  const root = repoRoot();
  const candidate = root ? path.join(root, ...parts) : undefined;
  return candidate && fs.existsSync(candidate) ? candidate : undefined;
}

function firstExisting(...candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function compiler(info) {
  return settings().get("compilerPath") || bundled("bin", exe("djinnc")) || (info && info.compiler) || inRepo("djinnc", "build", exe("djinnc")) || "";
}

function stdDir(info) {
  return settings().get("stdDir") || bundled("toolchain", "std") || (info && info.stdDir) || inRepo("std") || "";
}

function runtimeDir(info) {
  return settings().get("runtimeDir") || bundled("toolchain", "runtime") || (info && info.runtimeDir) || inRepo("runtime") || "";
}

function runtimeLib() {
  const name = process.platform === "win32" ? "djinn_runtime.lib" : "libdjinn_runtime.a";
  return (
    settings().get("runtimeLib") ||
    bundled("toolchain", name) ||
    inRepo("build", "runtime", name) ||
    inRepo("build", "bootstrap", "runtime", name) ||
    ""
  );
}

function libDir() {
  return (
    settings().get("libDir") ||
    bundled("toolchain") ||
    firstExisting(...["build/bootstrap/libs", "build/libs"].map((relative) => inRepo(...relative.split("/")))) ||
    ""
  );
}

function linuxCompiler() {
  return settings().get("perf.compiler") || bundled("toolchain", "linux", "djinnc") || inRepo("djinnc", "build", "djinnc") || "";
}

function linuxRuntimeLib() {
  return (
    settings().get("perf.runtimeLib") ||
    bundled("toolchain", "linux", "libdjinn_runtime.a") ||
    inRepo("build", "runtime", "libdjinn_runtime.a") ||
    inRepo("build", "bootstrap", "runtime", "libdjinn_runtime.a") ||
    ""
  );
}

function allocationReport() {
  return bundled("scripts", "alloc_report.py") || "";
}

function llvmBin() {
  const configured = settings().get("llvmBinDir");
  if (configured) {
    return configured;
  }
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  const candidate = roots.map((root) => path.join(root, "LLVM", "bin")).find((directory) => fs.existsSync(directory));
  return process.platform === "win32" && candidate ? candidate : "";
}

function environment() {
  const env = { ...process.env };
  const llvm = llvmBin();
  if (llvm) {
    env.PATH = `${llvm}${path.delimiter}${env.PATH || ""}`;
  }
  return env;
}

function toWslPath(windowsPath) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(windowsPath);
  if (!match) {
    return windowsPath.replace(/\\/g, "/");
  }
  return `/mnt/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

function fromWslPath(wslPath) {
  const match = /^\/mnt\/([a-z])\/(.*)$/.exec(wslPath);
  if (!match) {
    return undefined;
  }
  return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
}

function inside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function findProject(start) {
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

function resolveTarget(explicit) {
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

function isInsideExtension(file) {
  const resolved = path.resolve(file);
  if (/[\\/]extensions[\\/][^\\/]*djinn-lang[^\\/]*(?:[\\/]|$)/i.test(resolved)) {
    return true;
  }
  return Boolean(extensionPath) && (resolved === path.resolve(extensionPath) || inside(resolved, path.resolve(extensionPath)));
}

module.exports = {
  repoRoot,
  linuxCompiler,
  linuxRuntimeLib,
  allocationReport,
  resolveTarget,
  isInsideExtension,
  init,
  settings,
  exists,
  bundled,
  exe,
  compiler,
  stdDir,
  runtimeDir,
  runtimeLib,
  libDir,
  llvmBin,
  environment,
  toWslPath,
  fromWslPath,
};
