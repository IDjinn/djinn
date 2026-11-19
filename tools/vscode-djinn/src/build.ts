import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as toolchain from "./toolchain";
import { BuildOptions, BuildPlan, ProjectManifest } from "./types";

export function readProject(dir: string): ProjectManifest | undefined {
  const file = path.join(dir, "djinn.proj");
  if (!fs.existsSync(file)) {
    return undefined;
  }
  const text = fs.readFileSync(file, "utf8");
  const pick = (key: string): string | undefined => {
    const match = new RegExp(`^\\s*${key}:\\s*"([^"]*)"`, "m").exec(text);
    return match ? match[1] : undefined;
  };
  return {
    dir,
    name: pick("project"),
    outputFile: pick("file"),
    outputDirectory: pick("directory"),
    libraryMode: /library-mode:\s*true/.test(text),
    usesStdLib: /libs:\s*\[[^\]]*'std'/.test(text),
  };
}

export function sourcesOf(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "build" || entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".djinn")) {
        found.push(full);
      }
    }
  };
  walk(directory);
  return found.sort();
}

export function describe(target: string): BuildPlan {
  const isDirectory = fs.statSync(target).isDirectory();
  const project = isDirectory ? readProject(target) : undefined;
  const root = isDirectory ? target : path.dirname(target);
  const name = project && project.name ? project.name : path.basename(target, ".djinn");
  const outputDirectory = project && project.outputDirectory ? path.resolve(root, project.outputDirectory) : path.join(root, "build");
  const outputFile = project && project.outputFile ? project.outputFile : name;
  const isLibrary = Boolean(project && project.libraryMode);
  // A library is a .djlib, never an executable: it has no entry point to run or debug.
  const libraryFile = /\.djlib$/i.test(outputFile) ? outputFile : `${outputFile}.djlib`;
  const program = path.join(outputDirectory, isLibrary ? libraryFile : toolchain.exe(outputFile));
  return { isDirectory, project, root, name, outputDirectory, program, isLibrary };
}

interface CompilerInvocation {
  compiler: string;
  args: string[];
  plan: BuildPlan;
}

function invocation(target: string, options: BuildOptions): CompilerInvocation {
  const info = options.info;
  const settings = toolchain.settings();
  const plan = describe(target);
  const compiler = toolchain.compiler(info);
  if (!compiler) {
    throw new Error("djinnc was not found. Set djinn.compilerPath.");
  }
  const args: string[] = [];
  const std = toolchain.stdDir(info);
  const runtime = toolchain.runtimeDir(info);
  const runtimeLib = toolchain.runtimeLib();
  const debugLibDir = path.join(toolchain.libDir() || "", "debug");
  const libDir = options.debug && fs.existsSync(path.join(debugLibDir, "std.djlib")) ? debugLibDir : toolchain.libDir();

  args.push(target, "-o", plan.program);
  if (plan.isDirectory) {
    if (libDir && fs.existsSync(path.join(libDir, "std.djlib"))) {
      args.push("--lib-dir", libDir);
    } else if (std) {
      args.push("--std", "--std-dir", std);
    }
  } else if (std) {
    args.push("--std", "--std-dir", std);
  }
  if (runtime) {
    args.push("--runtime-dir", runtime);
  }
  if (runtimeLib) {
    args.push("--runtime-lib", runtimeLib);
  }
  if (process.platform === "win32") {
    args.push("--lld");
  }
  if (options.mode === "check") {
    args.push("--check");
  } else if (options.mode === "run" && !plan.isLibrary) {
    args.push("--run");
  }
  if (options.mode !== "check") {
    if (settings.get<boolean>("build.debugInfo") || options.debug) {
      args.push("-g");
    }
    const level = options.debug ? settings.get<string>("debug.optimization") || "O0" : settings.get<string>("build.optimization") || "O2";
    args.push(`-${level}`);
  }
  return { compiler, args, plan };
}

export function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

export function commandLine(target: string, options: BuildOptions): string {
  const { compiler, args } = invocation(target, options);
  return [quote(compiler), ...args.map(quote)].join(" ");
}

export function ensureOutputDirectory(target: string, options: BuildOptions): BuildPlan {
  const { plan } = invocation(target, options);
  fs.mkdirSync(plan.outputDirectory, { recursive: true });
  return plan;
}

export function run(target: string, options: BuildOptions, onOutput?: (text: string) => void): Promise<{ plan: BuildPlan; text: string }> {
  const plan = ensureOutputDirectory(target, options);
  const { compiler, args } = invocation(target, options);
  return new Promise((resolve, reject) => {
    const child = cp.spawn(compiler, args, { env: toolchain.environment(), cwd: plan.root });
    let text = "";
    const collect = (chunk: Buffer): void => {
      const value = chunk.toString();
      text += value;
      if (onOutput) {
        onOutput(value);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ plan, text });
        return;
      }
      const errors = text.split("\n").filter((line) => line.includes("error")).slice(0, 5).join("\n");
      reject(new Error(errors || `djinnc exited with ${code}`));
    });
  });
}
