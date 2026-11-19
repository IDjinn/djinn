import { AllocationMetric, MemoryUnit } from "../types";

/** One decoded instruction of a disassembled function, with the source line it came from. */
export interface Instruction {
  offset: number;
  text: string;
  file?: string;
  line?: number;
}

export interface DisassembledFunction {
  start: number;
  instructions: Map<number, string>;
  list: Instruction[];
}

export interface OperationDetail {
  count: number;
  text: string;
}

/** Samples attributed to one source line, split by what the line was doing. */
export interface LineStat {
  count: number;
  details: Map<string, OperationDetail>;
}

export interface FunctionLineStat extends LineStat {
  file: string;
  line: number;
}

export interface FunctionEntry {
  name: string;
  count: number;
  file: string;
  line: number;
  lines: Map<number, FunctionLineStat>;
  sortedLines: FunctionLineStat[];
  project: boolean;
}

export interface RuntimeEntry {
  name: string;
  count: number;
}

export interface ProfileModel {
  memory: MemoryUnit;
  total: number;
  kernelOnly: number;
  runtimeCount: number;
  functions: FunctionEntry[];
  runtime: RuntimeEntry[];
  /** file -> line -> stat */
  lines: Map<string, Map<number, LineStat>>;
  /** function symbol -> instruction offset -> samples */
  instructionCounts: Map<string, Map<number, number>>;
  disassembly: Map<string, DisassembledFunction>;
  projectRoot?: string;
}

export interface ParseOptions {
  projectRoot?: string;
  disassembly?: string;
  metric?: AllocationMetric;
  memory?: MemoryUnit;
}

export interface Frame {
  address: string;
  symbol: string;
  physical: string;
  offset?: number;
  kernel: boolean;
  file?: string;
  line?: number;
}

export interface HeatLevel {
  minimum: number;
  alpha: number;
}

/** A node of the function tree built from `a::b::c` symbol names. */
export interface TreeNode {
  name: string;
  count: number;
  children: Map<string, TreeNode>;
  entry?: FunctionEntry;
}
