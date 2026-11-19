import * as toolchain from "../toolchain";
import { PerfMode } from "../types";

export function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export interface ScriptPaths {
  compiler: string;
  runtimeLib: string;
  stdDir: string;
  runtimeDir: string;
  report: string;
}

export interface ScriptOptions {
  distroBin: string;
  paths: ScriptPaths;
  sources: string[];
  name: string;
  args: string;
  duration: number;
  frequency: number;
  output: string;
  callGraph: string;
  mode: PerfMode;
  optimization: string;
  perfBin: string;
  env: Record<string, string>;
  cwd?: string;
  /** Libraries the project lists in djinn.proj (without std), and the folder holding their sources. */
  libs?: string[];
  libsDir?: string;
}

interface RecordOptions {
  duration: number;
  args: string;
  output: string;
}

function cpuLines(options: RecordOptions & { event: string; callGraph: string }): string[] {
  const { duration, args, event, callGraph, output } = options;
  const record =
    duration > 0
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

function allocationLines(options: RecordOptions): string[] {
  const { duration, args, output } = options;
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
  const record =
    duration > 0
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

/** Builds std and the libraries of the project for Linux into $WORK/libs, in the order the project lists them. */
function libraryLines(libs: string[], libsDir: string | undefined): string[] {
  if (libs.length === 0 || !libsDir) {
    return [];
  }
  const flags = '--runtime-dir "$RUNTIME_DIR" --runtime-lib "$HOME_DIR/bin/libdjinn_runtime.a"';
  const fail = (what: string): string => `{ echo "[djinn] could not build ${what} for Linux:"; grep -v -E '^djinnc: (lexed|parsed|generated|compiling|wrote)' "$WORK/lib.log"; exit 1; }`;
  return [
    `echo "[djinn] building std and ${libs.join(", ")} for Linux"`,
    `rm -rf "$WORK/libs"; mkdir -p "$WORK/libs"`,
    `mapfile -t STD_SOURCES < <(find "$STD_DIR" -name '*.djinn' | sort)`,
    `"$HOME_DIR/bin/djinnc" "\${STD_SOURCES[@]}" --library -o "$WORK/libs/std.djlib" ${flags} > "$WORK/lib.log" 2>&1 || ${fail("std")}`,
    ...libs.map((lib) => `"$HOME_DIR/bin/djinnc" ${shellQuote(toolchain.toWslPath(`${libsDir}/${lib}`))} -o "$WORK/libs/${lib}.djlib" --lib-dir "$WORK/libs" --std-dir "$STD_DIR" ${flags} > "$WORK/lib.log" 2>&1 || ${fail(lib)}`),
  ];
}

/** The bash script that compiles the program for Linux, records it with perf and converts the samples. */
export function script(options: ScriptOptions): string {
  const { distroBin, paths, sources, name, args, duration, frequency, output, callGraph, mode, optimization, perfBin, env, cwd, libs = [], libsDir } = options;
  const event = mode === "pages" ? "-e page-faults -c 1" : `-e cpu-clock -F ${frequency}`;
  const stopNote = duration > 0 ? `, stops after ${duration}s` : ", until the program exits or you run Djinn: Stop profiling";
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
    ...libraryLines(libs, libsDir),
    `"$HOME_DIR/bin/djinnc" ${sources.map(shellQuote).join(" ")} -o "$WORK/app" -g -${optimization} ${libs.length > 0 ? '--lib-dir "$WORK/libs" --std-dir "$STD_DIR"' : '--std --std-dir "$STD_DIR"'} --runtime-dir "$RUNTIME_DIR" --runtime-lib "$HOME_DIR/bin/libdjinn_runtime.a" > "$WORK/build.log" 2>&1 && BUILD=0 || BUILD=$?`,
    `if [ "$BUILD" != 0 ] || [ ! -x "$WORK/app" ]; then echo "[djinn] the Linux build failed (djinnc exit code $BUILD). Compiler: $HOME_DIR/bin/djinnc. Full output:"; grep -v -E '^djinnc: (lexed|parsed|generated)' "$WORK/build.log" || true; echo "[djinn] log: $WORK/build.log"; exit 1; fi`,
    `echo "[djinn] recording with perf (${frequency} Hz${stopNote})"`,
    `rm -f "$WORK/perf.data"`,
    ...Object.entries(env).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    ...(cwd ? [`cd ${shellQuote(toolchain.toWslPath(cwd))}`] : []),
    ...(mode === "alloc" ? allocationLines({ duration, args, output }) : cpuLines({ duration, args, event, callGraph, output })),
    `chmod 666 ${shellQuote(toolchain.toWslPath(output))} ${shellQuote(toolchain.toWslPath(output.replace(/\.txt$/, ".dis")))} || true`,
    `echo "[djinn] done"`,
  ];
  return lines.join("\n") + "\n";
}
