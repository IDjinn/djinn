import * as fs from "fs";
import * as path from "path";
import * as build from "../build";
import * as toolchain from "../toolchain";
import { BuildPlan, PerfMode, PerfOverrides, PerfRunner } from "../types";
import { script, ScriptPaths, shellQuote } from "./script";

export interface PreparedRun {
  /** The bash script to run (inside WSL or natively). */
  runner: string;
  /** The `perf script` text output the script writes. */
  output: string;
  plan: BuildPlan;
  runnerConfig: PerfRunner;
}

export interface ShellCommand {
  command: string;
  args: string[];
}

function perfDirectory(root: string): string {
  const dir = path.join(root, ".djinn", "perf");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sourcesFor(target: string): string[] {
  const isDirectory = fs.statSync(target).isDirectory();
  const source = isDirectory && fs.existsSync(path.join(target, "src")) ? path.join(target, "src") : target;
  const files = isDirectory ? build.sourcesOf(source) : [target];
  return files.map((file) => toolchain.toWslPath(file));
}

function runnerFor(overrides: Partial<PerfRunner> = {}): PerfRunner {
  const settings = toolchain.settings();
  return {
    type: overrides.type || (process.platform === "win32" ? "wsl" : "native"),
    distro: overrides.distro || settings.get<string>("perf.distro") || "",
    user: overrides.user || settings.get<string>("perf.user") || "root",
    sudo: overrides.sudo === true,
    perf: overrides.perf || settings.get<string>("perf.path") || "perf",
    workDir: overrides.workDir || "$HOME/.djinn-perf",
  };
}

function argumentsText(value: string | string[] | undefined, fallback: string | undefined): string {
  if (Array.isArray(value)) {
    return value.map((item) => shellQuote(item)).join(" ");
  }
  return typeof value === "string" ? value : fallback || "";
}

function environmentOf(value: Record<string, unknown> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      result[key] = String(item);
    }
  }
  return result;
}

/** Writes the perf script for `target` and says where its output will land. Throws a readable error when something is missing. */
export function prepare(target: string, mode: PerfMode, overrides: PerfOverrides = {}): PreparedRun {
  const info = overrides.info;
  const settings = toolchain.settings();
  const runnerConfig = runnerFor(overrides.runner);
  if (runnerConfig.type === "wsl" && process.platform !== "win32") {
    throw new Error('The "wsl" runner only exists on Windows. Use "runner": { "type": "native" } in launch.json.');
  }
  if (runnerConfig.type === "native" && process.platform === "win32") {
    throw new Error('The "native" runner needs Linux. On Windows use the "wsl" runner.');
  }
  const requested = overrides.optimization || settings.get<string>("perf.optimization") || "O2";
  const optimization = /^O[0-3sz]$/.test(requested) ? requested : "O2";
  const plan = build.describe(target);
  if (toolchain.isInsideExtension(plan.root)) {
    throw new Error(`"${plan.root}" is inside the extension's own toolchain folder. Open your project, or set "target" in launch.json.`);
  }
  const paths: ScriptPaths = {
    compiler: toolchain.linuxCompiler(),
    runtimeLib: toolchain.linuxRuntimeLib(),
    stdDir: toolchain.stdDir(info),
    runtimeDir: toolchain.runtimeDir(info),
    report: toolchain.allocationReport(),
  };
  const missing: [string, string][] = [
    [paths.compiler, 'a Linux djinnc (build it on Linux or in WSL and set "djinn.perf.compiler")'],
    [paths.runtimeLib, 'a Linux libdjinn_runtime.a (tools/build_runtime.sh on Linux, then set "djinn.perf.runtimeLib")'],
    [paths.stdDir, 'the standard library sources ("djinn.stdDir")'],
    [paths.runtimeDir, 'the runtime sources ("djinn.runtimeDir")'],
  ];
  const absent = missing.filter(([value]) => !value);
  if (absent.length > 0) {
    throw new Error(`perf profiling needs ${absent.map(([, text]) => text).join("; ")}.`);
  }
  const directory = perfDirectory(plan.root);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = mode === "pages" ? "-memory" : mode === "alloc" ? "-alloc" : "";
  const output = path.join(directory, `profile-${stamp}-${optimization}${suffix}.txt`);
  const runner = path.join(directory, "run.sh");
  const body = script({
    distroBin: runnerConfig.workDir,
    paths,
    sources: sourcesFor(target),
    name: `${plan.name.replace(/[^A-Za-z0-9_.-]/g, "_")}_${optimization}`,
    args: argumentsText(overrides.args, settings.get<string>("perf.arguments")),
    duration: overrides.duration !== undefined ? overrides.duration : Number(settings.get("perf.duration") || 0),
    frequency: Number(overrides.frequency || settings.get("perf.frequency") || 499),
    callGraph: (overrides.callGraph || settings.get<string>("perf.callGraph")) === "dwarf" ? "--call-graph dwarf,16384" : "-g",
    perfBin: runnerConfig.perf,
    env: environmentOf(overrides.env),
    cwd: overrides.cwd,
    output,
    mode,
    optimization,
  });
  fs.writeFileSync(runner, body, { encoding: "utf8" });
  return { runner, output, plan, runnerConfig };
}

function wrap(runnerConfig: PerfRunner, program: string, args: string[]): ShellCommand {
  if (runnerConfig.type === "wsl") {
    const distro = runnerConfig.distro ? ["-d", runnerConfig.distro] : [];
    return { command: "wsl", args: [...distro, "-u", runnerConfig.user, "--", program, ...args] };
  }
  return runnerConfig.sudo ? { command: "sudo", args: [program, ...args] } : { command: program, args };
}

export function commandFor(runner: string, runnerConfig: PerfRunner = runnerFor()): ShellCommand {
  return wrap(runnerConfig, "bash", [toolchain.toWslPath(runner)]);
}

export function stopCommand(runnerConfig: PerfRunner = runnerFor()): ShellCommand {
  return wrap(runnerConfig, "pkill", ["-INT", "-x", "perf"]);
}
