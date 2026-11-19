import * as fs from "fs";
import * as path from "path";
import * as profile from "./profile";

interface Run {
  file: string;
  label: string;
  model: profile.ProfileModel;
}

export interface TableOptions {
  projectOnly?: boolean;
  limit?: number;
}

export function levelOf(file: string): string {
  const match = /-(O[0-3sz])(?:-[a-z]+)?\.txt$/.exec(file);
  return match ? match[1] : path.basename(file, ".txt").replace(/^profile-/, "");
}

function load(file: string, projectRoot: string | undefined): Run {
  const model = profile.parse(fs.readFileSync(file, "utf8"), { projectRoot });
  return { file, label: levelOf(file), model };
}

function ratio(first: number, last: number): string {
  if (!first || !last) {
    return "-";
  }
  return `${(last / first).toFixed(2)}x`;
}

/** A text table of per-function sample counts for profiles recorded at different optimization levels. */
export function table(files: string[], projectRoot: string | undefined, options: TableOptions = {}): string {
  const runs = files.map((file) => load(file, projectRoot));
  const names = new Map<string, number>();
  for (const run of runs) {
    for (const entry of run.model.functions) {
      if (options.projectOnly && !entry.project) {
        continue;
      }
      names.set(entry.name, Math.max(names.get(entry.name) || 0, entry.count));
    }
  }
  const ordered = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, options.limit || 40).map(([name]) => name);
  const width = Math.min(60, Math.max(8, ...ordered.map((name) => name.length)));
  const clip = (text: string): string => (text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width));

  const lines: string[] = [];
  lines.push("Optimization comparison (CPU samples per function; same wall time per run)");
  lines.push("");
  lines.push(`${"function".padEnd(width)}  ${runs.map((run) => `${run.label.padStart(9)} ${"%".padStart(6)}`).join("  ")}  ${`${runs[runs.length - 1].label}/${runs[0].label}`.padStart(9)}`);
  lines.push("-".repeat(lines[lines.length - 1].length));
  for (const name of ordered) {
    const counts = runs.map((run) => {
      const entry = run.model.functions.find((candidate) => candidate.name === name);
      return entry ? entry.count : 0;
    });
    const cells = runs.map((run, index) => {
      if (counts[index] === 0) {
        return `${"-".padStart(9)} ${"".padStart(6)}`;
      }
      return `${String(counts[index]).padStart(9)} ${((counts[index] / run.model.total) * 100).toFixed(1).padStart(6)}`;
    });
    lines.push(`${clip(name)}  ${cells.join("  ")}  ${ratio(counts[0], counts[counts.length - 1]).padStart(9)}`);
  }
  lines.push("");
  lines.push(`${"total samples".padEnd(width)}  ${runs.map((run) => `${String(run.model.total).padStart(9)} ${"".padStart(6)}`).join("  ")}`);
  lines.push("");
  lines.push("A dash means the function has no samples at that level: it was inlined into its caller, optimized away, or never ran.");
  lines.push("Samples measure CPU time, not work done. For a program that loops forever, a faster level just runs more cycles in the same time,");
  lines.push("so the totals match. For a real speed-up, give the program a finite workload (djinn.perf.arguments), leave djinn.perf.duration at 0");
  lines.push("so each level runs to completion, and compare the total samples: fewer samples for the same work means faster code.");
  return lines.join("\n") + "\n";
}
