const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const build = require("./build");
const toolchain = require("./toolchain");

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function perfDirectory(root) {
  const dir = path.join(root, ".djinn", "perf");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cpuLines({ duration, args, event, callGraph, output }) {
  const record = duration > 0
    ? `"$PERF" record ${event} ${callGraph} -o "$WORK/perf.data" -- timeout -s TERM ${duration} "$WORK/app" ${args} || true`
    : `"$PERF" record ${event} ${callGraph} -o "$WORK/perf.data" -- "$WORK/app" ${args} || true`;
  return [
    record,
    `echo "[djinn] converting samples"`,
    `test -s "$WORK/perf.data"`,
    `"$PERF" script -f --full-source-path -F ip,sym,symoff,srcline -i "$WORK/perf.data" > ${shellQuote(toolchain.toWslPath(output))} 2>/dev/null`,
    `objdump -d -l --no-show-raw-insn "$WORK/app" > ${shellQuote(toolchain.toWslPath(output.replace(/\.txt$/, ".dis")))} 2>/dev/null || true`,
  ];
}

function allocationLines({ duration, args, output }) {
  const disassembly = shellQuote(toolchain.toWslPath(output.replace(/\.txt$/, ".dis")));
  const probes = [
    "a_alloc=__djinn_alloc size=%di",
    "a_alloc_r=__djinn_alloc%return ptr=$retval",
    "a_zero=__djinn_alloc_zeroed size=%di",
    "a_zero_r=__djinn_alloc_zeroed%return ptr=$retval",
    "a_realloc=__djinn_realloc old=%di size=%si",
    "a_realloc_r=__djinn_realloc%return ptr=$retval",
    "a_free=__djinn_free ptr=%di",
  ];
  const record = duration > 0
    ? `"$PERF" record $EVENTS -o "$WORK/perf.data" -- timeout -s TERM ${duration} "$WORK/app" ${args} || true`
    : `"$PERF" record $EVENTS -o "$WORK/perf.data" -- "$WORK/app" ${args} || true`;
  return [
    `command -v python3 >/dev/null || { echo "[djinn] python3 is required in the WSL distribution for allocation profiling"; exit 1; }`,
    `"$PERF" probe -x "$WORK/app" -d 'probe_app:*' >/dev/null 2>&1 || true`,
    ...probes.map((probe) => `"$PERF" probe -x "$WORK/app" ${shellQuote(probe)} >/dev/null 2>&1`),
    `EVENTS=""`,
    `for e in $("$PERF" probe -l 2>/dev/null | awk '{print $1}' | grep '^probe_app:'); do case "$e" in *return) EVENTS="$EVENTS -e $e/call-graph=fp/";; *) EVENTS="$EVENTS -e $e";; esac; done`,
    `test -n "$EVENTS"`,
    record,
    `"$PERF" probe -x "$WORK/app" -d 'probe_app:*' >/dev/null 2>&1 || true`,
    `echo "[djinn] pairing allocations with frees"`,
    `test -s "$WORK/perf.data"`,
    `objdump -d -l --no-show-raw-insn "$WORK/app" > ${disassembly} 2>/dev/null || true`,
    `"$PERF" script -f -i "$WORK/perf.data" -F tid,event,trace,ip,sym,symoff 2>/dev/null | python3 "$REPORT" --binary "$WORK/app" --disassembly ${disassembly} > ${shellQuote(toolchain.toWslPath(output))}`,
  ];
}

function script(options) {
  const { distroBin, paths, sources, name, args, duration, frequency, output, callGraph, mode, optimization, perfBin, env, cwd } = options;
  const event = mode === "pages" ? "-e page-faults -c 1" : `-e cpu-clock -F ${frequency}`;
  const lines = [
    "set -eu",
    `PERF=${shellQuote(perfBin)}`,
    `HOME_DIR="${distroBin}"`,
    `COMPILER=${shellQuote(toolchain.toWslPath(paths.compiler))}`,
    `RUNTIME_LIB=${shellQuote(toolchain.toWslPath(paths.runtimeLib))}`,
    `STD_DIR=${shellQuote(toolchain.toWslPath(paths.stdDir))}`,
    `RUNTIME_DIR=${shellQuote(toolchain.toWslPath(paths.runtimeDir))}`,
    `REPORT=${shellQuote(toolchain.toWslPath(paths.report))}`,
    `WORK="$HOME_DIR/work/${name}"`,
    `mkdir -p "$HOME_DIR/bin" "$WORK"`,
    `cp -f "$COMPILER" "$HOME_DIR/bin/djinnc"`,
    `cp -f "$RUNTIME_LIB" "$HOME_DIR/bin/libdjinn_runtime.a"`,
    `chmod +x "$HOME_DIR/bin/djinnc"`,
    `echo "[djinn] compiling for Linux with debug info"`,
    `"$HOME_DIR/bin/djinnc" ${sources.map(shellQuote).join(" ")} -o "$WORK/app" -g -${optimization} --std --std-dir "$STD_DIR" --runtime-dir "$RUNTIME_DIR" --runtime-lib "$HOME_DIR/bin/libdjinn_runtime.a" 2>&1 | grep -v '^djinnc:' || true`,
    `test -x "$WORK/app"`,
    `echo "[djinn] recording with perf (${frequency} Hz${duration > 0 ? `, stops after ${duration}s` : ", until the program exits or you run Djinn: Stop profiling"})"`,
    `rm -f "$WORK/perf.data"`,
    ...Object.entries(env).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    ...(cwd ? [`cd ${shellQuote(toolchain.toWslPath(cwd))}`] : []),
    ...(mode === "alloc" ? allocationLines({ duration, args, output }) : cpuLines({ duration, args, event, callGraph, output })),
    `chmod 666 ${shellQuote(toolchain.toWslPath(output))} ${shellQuote(toolchain.toWslPath(output.replace(/\.txt$/, ".dis")))} || true`,
    `echo "[djinn] done"`,
  ];
  return lines.join("\n") + "\n";
}

function sourcesFor(target) {
  const isDirectory = fs.statSync(target).isDirectory();
  const source = isDirectory && fs.existsSync(path.join(target, "src")) ? path.join(target, "src") : target;
  const files = isDirectory ? build.sourcesOf(source) : [target];
  return files.map((file) => toolchain.toWslPath(file));
}

function runnerFor(overrides = {}) {
  const settings = toolchain.settings();
  const type = overrides.type || (process.platform === "win32" ? "wsl" : "native");
  return {
    type,
    distro: overrides.distro || settings.get("perf.distro") || "",
    user: overrides.user || "root",
    sudo: overrides.sudo === true,
    perf: overrides.perf || "perf",
    workDir: overrides.workDir || "$HOME/.djinn-perf",
  };
}

function argumentsText(value, fallback) {
  if (Array.isArray(value)) {
    return value.map((item) => shellQuote(item)).join(" ");
  }
  return typeof value === "string" ? value : fallback || "";
}

function environmentOf(value) {
  const result = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      result[key] = String(item);
    }
  }
  return result;
}

function prepare(target, extensionPath, mode, overrides = {}) {
  const info = overrides.info;
  const settings = toolchain.settings();
  const runnerConfig = runnerFor(overrides.runner);
  if (runnerConfig.type === "wsl" && process.platform !== "win32") {
    throw new Error('The "wsl" runner only exists on Windows. Use "runner": { "type": "native" } in launch.json.');
  }
  if (runnerConfig.type === "native" && process.platform === "win32") {
    throw new Error('The "native" runner needs Linux. On Windows use the "wsl" runner.');
  }
  const requested = overrides.optimization || settings.get("perf.optimization") || "O2";
  const optimization = /^O[0-3sz]$/.test(requested) ? requested : "O2";
  const plan = build.describe(target, {});
  if (toolchain.isInsideExtension(plan.root)) {
    throw new Error(`"${plan.root}" is inside the extension's own toolchain folder. Open your project, or set "target" in launch.json.`);
  }
  const paths = {
    compiler: toolchain.linuxCompiler(),
    runtimeLib: toolchain.linuxRuntimeLib(),
    stdDir: toolchain.stdDir(info),
    runtimeDir: toolchain.runtimeDir(info),
    report: toolchain.allocationReport(),
  };
  const missing = [
    [paths.compiler, 'a Linux djinnc (build it on Linux or in WSL and set "djinn.perf.compiler")'],
    [paths.runtimeLib, 'a Linux libdjinn_runtime.a (tools/build_runtime.sh on Linux, then set "djinn.perf.runtimeLib")'],
    [paths.stdDir, 'the standard library sources ("djinn.stdDir")'],
    [paths.runtimeDir, 'the runtime sources ("djinn.runtimeDir")'],
  ].filter(([value]) => !value);
  if (missing.length > 0) {
    throw new Error(`perf profiling needs ${missing.map(([, text]) => text).join("; ")}.`);
  }
  const directory = perfDirectory(plan.root);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = path.join(directory, `profile-${stamp}-${optimization}${mode === "pages" ? "-memory" : mode === "alloc" ? "-alloc" : ""}.txt`);
  const runner = path.join(directory, "run.sh");
  const body = script({
    distroBin: runnerConfig.workDir,
    paths,
    sources: sourcesFor(target),
    name: `${plan.name.replace(/[^A-Za-z0-9_.-]/g, "_")}_${optimization}`,
    args: argumentsText(overrides.args, settings.get("perf.arguments")),
    duration: overrides.duration !== undefined ? overrides.duration : Number(settings.get("perf.duration") || 0),
    frequency: Number(overrides.frequency || settings.get("perf.frequency") || 499),
    callGraph: (overrides.callGraph || settings.get("perf.callGraph")) === "dwarf" ? "--call-graph dwarf,16384" : "-g",
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

function wrap(runnerConfig, program, args) {
  if (runnerConfig.type === "wsl") {
    const distro = runnerConfig.distro ? ["-d", runnerConfig.distro] : [];
    return { command: "wsl", args: [...distro, "-u", runnerConfig.user, "--", program, ...args] };
  }
  return runnerConfig.sudo ? { command: "sudo", args: [program, ...args] } : { command: program, args };
}

function commandFor(runner, runnerConfig = runnerFor()) {
  return wrap(runnerConfig, "bash", [toolchain.toWslPath(runner)]);
}

function stopCommand(runnerConfig = runnerFor()) {
  return wrap(runnerConfig, "pkill", ["-INT", "-x", "perf"]);
}

module.exports = { prepare, commandFor, stopCommand };
