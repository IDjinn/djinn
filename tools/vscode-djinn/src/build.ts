import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as toolchain from "./toolchain";
import { BuildOptions, BuildPlan, ProjectManifest, ServerInfo } from "./types";

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
    // Import libraries of the native libraries (vulkan-1.lib) ship in the installed toolchain's native/ folder; a library
    // folder built in a checkout has no native/ next to it.
    const native = toolchain.installed("native");
    if (native) {
      args.push(`-L${native}`);
    }
  }
  if (options.mode === "check") {
    args.push("--check");
  }
  // "run" builds a real executable (the platform files for the host are picked) and the caller starts it; `--run` would JIT it.
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

function spawnCompiler(compiler: string, args: string[], cwd: string, onOutput?: (text: string) => void): Promise<{ code: number | null; text: string }> {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(compiler, args, { env: toolchain.environment(), cwd });
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
    child.on("close", (code) => resolve({ code, text }));
  });
}

/**
 * Builds the libraries a project lists in djinn.proj that are missing from the library directory, from the sources in a
 * Djinn checkout's libs/ folder, in the order the project lists them (a library may import the ones before it).
 */
export async function ensureLibraries(target: string, options: BuildOptions, onOutput?: (text: string) => void): Promise<void> {
  const plan = describe(target);
  const libDir = toolchain.libDir();
  const root = toolchain.repoRoot();
  const std = toolchain.stdDir(options.info);
  const compiler = toolchain.compiler(options.info);
  if (!plan.isDirectory || !libDir || !root || !compiler || !fs.existsSync(path.join(libDir, "std.djlib"))) {
    return;
  }
  const manifest = path.join(target, "djinn.proj");
  if (!fs.existsSync(manifest)) {
    return;
  }
  const block = /libs:\s*\[([^\]]*)\]/.exec(fs.readFileSync(manifest, "utf8"));
  const names = block ? [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]).filter((name) => name !== "std") : [];
  for (const name of names) {
    const output = path.join(libDir, `${name}.djlib`);
    const source = path.join(root, "libs", name);
    if (fs.existsSync(output) || !fs.existsSync(source)) {
      continue;
    }
    onOutput?.(`> building library ${name} (missing from ${libDir})\n`);
    const args = [source, "-o", output, "--lib-dir", libDir];
    if (std) {
      args.push("--std-dir", std);
    }
    if (process.platform === "win32") {
      args.push("--lld");
    }
    const result = await spawnCompiler(compiler, args, root, onOutput);
    if (result.code !== 0) {
      const errors = result.text.split("\n").filter((line) => line.includes("error")).slice(0, 5).join("\n");
      throw new Error(`Building the library ${name} failed:\n${errors || `djinnc exited with ${result.code}`}`);
    }
  }
}

function samePath(root: string, name: string): string {
  const full = path.resolve(root, name);
  return process.platform === "win32" ? full.toLowerCase() : full;
}

export interface IrText {
  text: string;
  /** For each line of `text`, the 1-based source line it was generated from (0 when none). Empty for whole-program output. */
  map: number[];
}

/**
 * The module's definitions that come from `file`, without debug metadata: what the optimizer made of that one file.
 * Every run of instructions that comes from one source line is preceded by a `; <line>: <source>` comment, and the map says
 * which source line each output line belongs to.
 */
export function onlyFile(text: string, root: string, file: string, source?: string[]): IrText {
  const wanted = samePath(root, file);
  const names = new Map<string, string>();
  const subprograms = new Map<string, { file: string; line: number }>();
  const locations = new Map<string, number>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const named = /^!(\d+) = !DIFile\(filename: "([^"]*)"/.exec(line);
    if (named) {
      names.set(named[1], named[2].replace(/\\/g, "\\"));
      continue;
    }
    const program = /^!(\d+) = distinct !DISubprogram\(.*?[ (]file: !(\d+).*?[ (]line: (\d+)/.exec(line);
    if (program) {
      subprograms.set(program[1], { file: program[2], line: Number(program[3]) });
      continue;
    }
    const location = /^!(\d+) = !DILocation\(line: (\d+)/.exec(line);
    if (location) {
      locations.set(location[1], Number(location[2]));
    }
  }
  const out: string[] = [];
  const map: number[] = [];
  const add = (line: string, from: number): void => {
    out.push(line);
    map.push(from);
  };
  add(`; LLVM IR of ${path.basename(file)} only (functions defined in this file)`, 0);
  for (const line of lines) {
    if (/^(source_filename|target |%)/.test(line) || /^attributes #/.test(line)) {
      add(line, 0);
    }
  }
  add("", 0);
  let kept = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("define ")) {
      continue;
    }
    const at = /!dbg !(\d+) \{$/.exec(lines[i]);
    const program = at ? subprograms.get(at[1]) : undefined;
    const name = program ? names.get(program.file) : undefined;
    let end = i;
    while (end < lines.length && lines[end] !== "}") {
      end++;
    }
    if (program && name && samePath(root, name) === wanted) {
      if (i > 0 && lines[i - 1].startsWith(";")) {
        add(lines[i - 1], 0);
      }
      add(lines[i].replace(/ !dbg !\d+/g, ""), program.line);
      let current = 0;
      for (let n = i + 1; n <= end; n++) {
        const line = lines[n];
        if (line.trimStart().startsWith("#dbg_")) {
          continue;
        }
        const tag = /, !dbg !(\d+)/.exec(line);
        const from = tag ? locations.get(tag[1]) || 0 : 0;
        if (from > 0 && from !== current) {
          current = from;
          const code = source && source[from - 1] !== undefined ? source[from - 1].trim() : "";
          add(`  ; ${from}: ${code}`.trimEnd(), from);
        }
        add(line.replace(/, !dbg !\d+/g, "").replace(/ !dbg !\d+/g, ""), from || current);
      }
      add("", 0);
      kept++;
    }
    i = end;
  }
  if (kept === 0) {
    add("; no function in this file reaches the output (unused generics and library code are left out)", 0);
  }
  return { text: out.join("\n") + "\n", map };
}

/**
 * Compiles `target` with `--emit-ir` at one optimization level and returns the LLVM IR text. Only the project's own functions
 * are written (djinnc leaves the library code out), and the build stays out of the project's output folder.
 */
export async function emitIR(target: string, level: string, info?: ServerInfo, file?: string): Promise<IrText> {
  const { compiler, args, plan } = invocation(target, { mode: "build", info });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "djinn-ir-"));
  const output = path.join(directory, plan.name);
  const flags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === plan.program && args[i - 1] === "-o") {
      flags.push(output);
    } else if (args[i] !== "-g" && !/^-O[0-3sz]$/.test(args[i]) && args[i] !== "--lld") {
      flags.push(args[i]);
    }
  }
  // Debug info tells which source file each function came from; it is read to cut the module down to `file` and then dropped.
  flags.push("--emit-ir", `-${level}`);
  if (file) {
    flags.push("-g");
  }
  try {
    const result = await spawnCompiler(compiler, flags, plan.root);
    if (result.code !== 0 || !fs.existsSync(`${output}.ll`)) {
      const errors = result.text.split("\n").filter((line) => line.includes("error")).slice(0, 8).join("\n");
      throw new Error(errors || `djinnc exited with ${result.code}`);
    }
    const text = fs.readFileSync(`${output}.ll`, "utf8");
    if (!file) {
      return { text, map: [] };
    }
    let source: string[] | undefined;
    try {
      source = fs.readFileSync(file, "utf8").split(/\r?\n/);
    } catch {
      source = undefined;
    }
    return onlyFile(text, plan.root, file, source);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
