import * as path from "path";
import { HeatLevel, ProfileModel } from "./types";

/** Heat levels shared by the source hints and the assembly view, hottest first. */
export const LEVELS: HeatLevel[] = [
  { minimum: 0.25, alpha: 0.3 },
  { minimum: 0.1, alpha: 0.22 },
  { minimum: 0.03, alpha: 0.15 },
  { minimum: 0.01, alpha: 0.09 },
  { minimum: 0, alpha: 0.05 },
];

/** A sample count formatted for the model's unit: samples, allocations, or bytes. */
export function amount(model: Pick<ProfileModel, "memory">, count: number): string {
  if (!model.memory) {
    return `${count}`;
  }
  if (model.memory === "count") {
    return `${count} allocs`;
  }
  const bytes = model.memory === "bytes" ? count : count * 4096;
  if (bytes >= 1073741824) {
    return `${(bytes / 1073741824).toFixed(2)} GB`;
  }
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

/** A comparable form of a file path (std files from any install map to the same key). */
export function normalize(file: string): string {
  const lower = path.normalize(file).toLowerCase().replace(/\\/g, "/");
  const marker = "/toolchain/std/";
  const at = lower.lastIndexOf(marker);
  if (at >= 0) {
    return `<std>/${lower.slice(at + marker.length)}`;
  }
  return path.normalize(file).toLowerCase();
}

export function isProjectFile(model: ProfileModel, file: string): boolean {
  return !model.projectRoot || normalize(file).startsWith(model.projectRoot);
}
