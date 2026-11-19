import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as toolchain from "../toolchain";
import { PerfCandidate, PerfDetection, PerfMode, PerfRunner } from "../types";

/** Runs on the Linux side (natively or in WSL) and prints `key=value` lines about perf. */
const PROBE = `#!/bin/bash
HINT="$1"
echo "kernel=$(uname -r)"
echo "user=$(id -un)"
[ -r /etc/os-release ] && echo "os=$(. /etc/os-release; echo "$ID")"
pick=""
for c in "$HINT" perf /usr/bin/perf /usr/sbin/perf /usr/local/bin/perf $(ls -d /usr/lib/linux-tools*/*/perf /usr/lib/linux-tools/*/perf /usr/lib/linux-tools-*/perf 2>/dev/null | sort -r); do
  [ -n "$c" ] || continue
  p=$(command -v "$c" 2>/dev/null) || continue
  if "$p" --version >/dev/null 2>&1; then pick="$p"; break; else echo "broken=$p"; fi
done
echo "perf=$pick"
if [ -n "$pick" ]; then
  echo "version=$("$pick" --version 2>/dev/null)"
  "$pick" stat -e cpu-clock true >/dev/null 2>&1 && echo cpu=1 || echo cpu=0
  "$pick" stat -e page-faults true >/dev/null 2>&1 && echo pages=1 || echo pages=0
  "$pick" probe -l >/dev/null 2>&1 && echo probe=1 || echo probe=0
fi
echo "paranoid=$(cat /proc/sys/kernel/perf_event_paranoid 2>/dev/null)"
command -v python3 >/dev/null 2>&1 && echo python3=1 || echo python3=0
command -v objdump >/dev/null 2>&1 && echo objdump=1 || echo objdump=0
`;

const INSTALL_HINTS: Record<string, string> = {
  ubuntu: "sudo apt update && sudo apt install -y linux-tools-generic linux-tools-common",
  debian: "sudo apt update && sudo apt install -y linux-perf",
  fedora: "sudo dnf install -y perf",
  arch: "sudo pacman -S perf",
  opensuse: "sudo zypper install perf",
  alpine: "sudo apk add perf",
};

interface Run {
  code: number;
  stdout: Buffer;
  stderr: string;
}

function run(command: string, args: string[], timeout = 30000): Promise<Run> {
  return new Promise((resolve) => {
    cp.execFile(command, args, { encoding: "buffer", timeout, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException).code === "number" ? ((error as NodeJS.ErrnoException).code as unknown as number) : -1) : 0;
      resolve({ code, stdout, stderr: stderr.toString("utf8") });
    });
  });
}

/** `wsl -l -q` prints UTF-16; the first name is the default distribution. */
async function wslDistros(): Promise<string[] | undefined> {
  const result = await run("wsl", ["-l", "-q"], 10000);
  if (result.code !== 0) {
    return undefined;
  }
  return result.stdout
    .toString("utf16le")
    .replace(/\0/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^docker-desktop/i.test(line));
}

function parseProbe(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0 && /^[a-z0-9]+$/.test(line.slice(0, at))) {
      values[line.slice(0, at)] = line.slice(at + 1).trim();
    }
  }
  return values;
}

function probeFile(): string {
  const file = path.join(os.tmpdir(), "djinn-perf-probe.sh");
  fs.writeFileSync(file, PROBE.replace(/\r\n/g, "\n"), { encoding: "utf8" });
  return file;
}

async function inspect(runner: PerfRunner, label: string, hint: string): Promise<PerfCandidate> {
  const file = probeFile();
  const script = toolchain.toWslPath(file);
  const wsl = runner.type === "wsl";
  const distro = runner.distro ? ["-d", runner.distro] : [];
  const result = wsl
    ? await run("wsl", [...distro, "-u", runner.user, "--", "bash", script, hint])
    : await run("bash", [script, hint]);
  const values = parseProbe(result.stdout.toString("utf8"));
  const issues: string[] = [];
  const perf = values.perf || "";
  const cpu = values.cpu === "1";
  const pages = values.pages === "1";
  const probe = values.probe === "1";
  const python3 = values.python3 === "1";
  const objdump = values.objdump === "1";
  const paranoid = values.paranoid === "" || values.paranoid === undefined ? undefined : Number(values.paranoid);
  if (result.code !== 0 && !values.kernel) {
    issues.push(`could not run in ${label}${result.stderr ? `: ${result.stderr.trim().split("\n")[0]}` : ""}`);
  } else if (!perf) {
    const wrapper = values.broken ? ` (${values.broken} is the distro's wrapper, which fails for kernel ${values.kernel})` : "";
    issues.push(`perf is not installed${wrapper}`);
    if (/microsoft/i.test(values.kernel || "")) {
      issues.push("WSL kernels have no matching linux-tools package: install linux-tools-generic and point djinn.perf.path at /usr/lib/linux-tools/<version>-generic/perf");
    }
  } else {
    if (!cpu) {
      issues.push("perf cannot sample the CPU here (cpu-clock event failed)");
    }
    if (!pages) {
      issues.push("perf cannot count page faults here");
    }
    if (paranoid !== undefined && paranoid > 1 && runner.user !== "root" && !runner.sudo) {
      issues.push(`kernel.perf_event_paranoid is ${paranoid}: run as root or lower it (sudo sysctl kernel.perf_event_paranoid=1)`);
    }
    if (!objdump) {
      issues.push("objdump is missing (binutils): the assembly view will be empty");
    }
  }
  const allocations = Boolean(perf) && probe && python3;
  if (perf && !probe) {
    issues.push("allocation profiling needs uprobes (perf probe failed): memory page profiling still works");
  } else if (perf && !python3) {
    issues.push("allocation profiling needs python3 on the Linux side");
  }
  return {
    label,
    runner: { ...runner, perf: perf || runner.perf },
    version: values.version,
    kernel: values.kernel,
    os: values.os,
    found: Boolean(perf),
    cpu: Boolean(perf) && cpu,
    pages: Boolean(perf) && pages,
    allocations,
    paranoid,
    issues,
    install: INSTALL_HINTS[values.os || ""] || (perf ? undefined : "Install perf with your distribution's package manager (package name: perf, linux-tools or linux-perf)"),
  };
}

function baseRunner(type: "wsl" | "native", distro: string, perf: string): PerfRunner {
  const user = toolchain.settings().get<string>("perf.user") || (type === "wsl" ? "root" : "");
  return { type, distro, user, sudo: false, perf, workDir: "$HOME/.djinn-perf" };
}

/** Looks for a usable perf: on Linux the host, on Windows every WSL distribution. Honors `djinn.perf.runner`, `distro` and `path`. */
export async function detect(): Promise<PerfDetection> {
  const config = toolchain.settings();
  const wanted = config.get<string>("perf.runner") || "auto";
  const hint = config.get<string>("perf.path") || "";
  const preferred = config.get<string>("perf.distro") || "";
  const candidates: PerfCandidate[] = [];
  const problems: string[] = [];
  if (process.platform === "win32") {
    if (wanted === "native") {
      problems.push('djinn.perf.runner is "native", which needs Linux. Use "wsl" or "auto" on Windows.');
    } else {
      const distros = await wslDistros();
      if (!distros) {
        problems.push("WSL is not available. Install it with `wsl --install` (a restart may be needed), then run Djinn: Detect perf setup again.");
      } else if (distros.length === 0) {
        problems.push("WSL has no Linux distribution. Install one with `wsl --install -d Ubuntu`.");
      } else {
        const ordered = preferred ? [preferred, ...distros.filter((name) => name !== preferred)] : distros;
        for (const name of ordered) {
          candidates.push(await inspect(baseRunner("wsl", name, hint || "perf"), `WSL: ${name}`, hint));
        }
      }
    }
  } else if (process.platform === "darwin") {
    problems.push("perf needs Linux. On macOS use a Linux machine or container.");
  } else if (wanted === "wsl") {
    problems.push('djinn.perf.runner is "wsl", which only exists on Windows.');
  } else {
    candidates.push(await inspect(baseRunner("native", "", hint || "perf"), "This machine (native)", hint));
  }
  const usable = candidates.filter((candidate) => candidate.found && candidate.cpu);
  return { candidates, best: usable[0], problems, at: Date.now() };
}

let cached: PerfDetection | undefined;
const FRESH_MS = 5 * 60 * 1000;

/** `detect()` with a short-lived cache; `force` or a settings change refreshes it. */
export async function detectCached(force = false): Promise<PerfDetection> {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) {
    return cached;
  }
  cached = await detect();
  return cached;
}

export function forget(): void {
  cached = undefined;
}

/** Why `mode` cannot run on `candidate`, or undefined when it can. */
export function unsupported(candidate: PerfCandidate, mode: PerfMode): string | undefined {
  if (!candidate.found) {
    return candidate.issues[0] || "perf is not installed";
  }
  if (mode === "cpu" && !candidate.cpu) {
    return "perf cannot sample the CPU here";
  }
  if (mode === "pages" && !candidate.pages) {
    return "perf cannot count page faults here";
  }
  if (mode === "alloc" && !candidate.allocations) {
    return candidate.issues.find((issue) => issue.startsWith("allocation profiling")) || "allocation profiling is not available here";
  }
  return undefined;
}

/** A readable report of everything detection found, for the output channel. */
export function describe(detection: PerfDetection): string[] {
  const lines: string[] = [];
  for (const problem of detection.problems) {
    lines.push(`! ${problem}`);
  }
  for (const candidate of detection.candidates) {
    const mark = candidate === detection.best ? "*" : " ";
    lines.push(`${mark} ${candidate.label}`);
    lines.push(`    perf:        ${candidate.found ? `${candidate.runner.perf} (${candidate.version || "unknown version"})` : "not found"}`);
    if (candidate.kernel) {
      lines.push(`    kernel:      ${candidate.kernel}${candidate.os ? `  (${candidate.os})` : ""}`);
    }
    lines.push(`    cpu samples: ${candidate.cpu ? "yes" : "no"}   page faults: ${candidate.pages ? "yes" : "no"}   allocations: ${candidate.allocations ? "yes" : "no"}`);
    for (const issue of candidate.issues) {
      lines.push(`    - ${issue}`);
    }
    if (!candidate.found && candidate.install) {
      lines.push(`    install:     ${candidate.install}`);
    }
  }
  if (!detection.best) {
    lines.push("No usable perf found.");
  }
  return lines;
}
