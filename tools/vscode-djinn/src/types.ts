// Types shared across the extension.

/** What `djinn/info` returns from the language server. */
export interface ServerInfo {
  compiler: string;
  runtimeDir: string;
  stdDir: string;
  units: number;
}

export type BuildMode = "build" | "run" | "check";

export interface ProjectManifest {
  dir: string;
  name?: string;
  outputFile?: string;
  outputDirectory?: string;
  libraryMode: boolean;
  usesStdLib: boolean;
}

export interface BuildOptions {
  mode?: BuildMode;
  debug?: boolean;
  info?: ServerInfo;
}

export interface BuildPlan {
  isDirectory: boolean;
  project?: ProjectManifest;
  root: string;
  name: string;
  outputDirectory: string;
  /** The file the build produces: an executable, or a `.djlib` for a library project. */
  program: string;
  isLibrary: boolean;
}

export interface PerfRunner {
  type: "wsl" | "native";
  distro: string;
  user: string;
  sudo: boolean;
  perf: string;
  workDir: string;
}

export type PerfMode = "cpu" | "alloc" | "pages";

/** One place perf can run (the host, or a WSL distribution) and what it can do there. */
export interface PerfCandidate {
  label: string;
  runner: PerfRunner;
  version?: string;
  kernel?: string;
  os?: string;
  found: boolean;
  cpu: boolean;
  pages: boolean;
  allocations: boolean;
  paranoid?: number;
  issues: string[];
  install?: string;
}

export interface PerfDetection {
  candidates: PerfCandidate[];
  /** The first candidate that can sample the CPU. */
  best?: PerfCandidate;
  problems: string[];
  at: number;
}
export type AllocationMetric = "alloc" | "live" | "peak" | "count";
export type MemoryUnit = false | true | "bytes" | "count";

export interface PerfOverrides {
  target?: string;
  args?: string | string[];
  env?: Record<string, unknown>;
  cwd?: string;
  frequency?: number;
  callGraph?: string;
  runner?: Partial<PerfRunner>;
  optimization?: string;
  duration?: number;
  /** Load the profile into the views when the run ends (default true). */
  load?: boolean;
  info?: ServerInfo;
}

/** The `profile` block of a `djinn` launch configuration with `"mode": "profile"`. */
export interface ProfileSettings {
  kind?: "cpu" | "allocations" | "pages";
  frequency?: number;
  callGraph?: string;
  runner?: Partial<PerfRunner>;
  metric?: AllocationMetric;
  duration?: number | string;
  levels?: string[];
  optimization?: string;
}

export interface LaunchConfig {
  type?: string;
  request?: string;
  name?: string;
  mode?: string;
  target?: string;
  args?: string[];
  env?: Record<string, unknown>;
  cwd?: string;
  program?: string;
  build?: boolean;
  stopAtEntry?: boolean;
  console?: string;
  MIMode?: string;
  profile?: ProfileSettings;
  /** "android" builds the project for a device and installs it; anything else is the host. */
  platform?: string;
  /** Android: the adb serial (or "ask"); defaults to djinn.android.device. */
  device?: string;
  /** Android: arm64-v8a or x86_64; defaults to what the device runs. */
  abi?: string;
  /** Android: the application id; defaults to the `android:` section of djinn.proj. */
  package?: string;
}
