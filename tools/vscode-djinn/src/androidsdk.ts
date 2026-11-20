// Android SDK and device helpers: no dependency on the vscode module so they can be exercised from a plain node script
// (tools/vscode-djinn/scripts/android_smoke.js) against a real emulator.
import * as cp from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type Abi = "arm64-v8a" | "x86_64";

export interface Device {
  serial: string;
  state: string;
  model?: string;
  emulator: boolean;
}

export interface AndroidApp {
  package: string;
  label: string;
  minApi: number;
}

export interface ExecResult {
  code: number | null;
  out: string;
}

const exeSuffix = process.platform === "win32" ? ".exe" : "";

/** Runs a command to completion. Never rejects: a command that cannot start reports code null and the reason in `out`. */
export function exec(command: string, args: string[], options: cp.SpawnOptions = {}, onOutput?: (text: string) => void): Promise<ExecResult> {
  return new Promise((resolve) => {
    let out = "";
    let child: cp.ChildProcess;
    try {
      child = cp.spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      resolve({ code: null, out: String(error) });
      return;
    }
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString();
      out += text;
      onOutput?.(text);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => resolve({ code: null, out: out + String(error) }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

function directory(candidate: string | undefined): string | undefined {
  return candidate && fs.existsSync(candidate) ? candidate : undefined;
}

/** The SDK: the configured path, ANDROID_HOME / ANDROID_SDK_ROOT, else the folder Android Studio installs to. */
export function sdkPath(configured?: string): string | undefined {
  const defaults =
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Android", "Sdk")
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Android", "sdk")
        : path.join(os.homedir(), "Android", "Sdk");
  return directory(configured) || directory(process.env.ANDROID_HOME) || directory(process.env.ANDROID_SDK_ROOT) || directory(defaults);
}

/** The NDK: the configured path, DJINN_NDK / ANDROID_NDK_HOME, else the newest one in <sdk>/ndk. */
export function ndkPath(sdk: string | undefined, configured?: string): string | undefined {
  const explicit = directory(configured) || directory(process.env.DJINN_NDK) || directory(process.env.ANDROID_NDK_HOME);
  if (explicit) {
    return explicit;
  }
  if (!sdk || !fs.existsSync(path.join(sdk, "ndk"))) {
    return undefined;
  }
  const versions = fs.readdirSync(path.join(sdk, "ndk")).filter((name) => /^\d/.test(name));
  versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const newest = versions[versions.length - 1];
  return newest ? path.join(sdk, "ndk", newest) : undefined;
}

export function adbPath(sdk: string | undefined): string {
  const candidate = sdk ? path.join(sdk, "platform-tools", `adb${exeSuffix}`) : undefined;
  return candidate && fs.existsSync(candidate) ? candidate : "adb";
}

export function emulatorPath(sdk: string | undefined): string {
  const candidate = sdk ? path.join(sdk, "emulator", `emulator${exeSuffix}`) : undefined;
  return candidate && fs.existsSync(candidate) ? candidate : "emulator";
}

/** The devices `adb devices -l` lists (attached, offline and unauthorized ones included). */
export async function devices(adb: string): Promise<Device[]> {
  const result = await exec(adb, ["devices", "-l"]);
  if (result.code !== 0) {
    return [];
  }
  const found: Device[] = [];
  for (const line of result.out.split(/\r?\n/).slice(1)) {
    const match = /^(\S+)\s+(device|offline|unauthorized|no permissions)\b(.*)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const model = /\bmodel:(\S+)/.exec(match[3]);
    found.push({ serial: match[1], state: match[2], model: model ? model[1] : undefined, emulator: match[1].startsWith("emulator-") });
  }
  return found;
}

/** The names of the virtual devices (AVDs) that can be started. */
export async function avds(emulator: string): Promise<string[]> {
  const result = await exec(emulator, ["-list-avds"]);
  if (result.code !== 0) {
    return [];
  }
  return result.out.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("INFO") && !line.includes(" "));
}

/** The AVD name an emulator instance runs. */
export async function avdOf(adb: string, serial: string): Promise<string | undefined> {
  const result = await exec(adb, ["-s", serial, "emu", "avd", "name"]);
  const name = result.out.split(/\r?\n/)[0].trim();
  return result.code === 0 && name ? name : undefined;
}

/** The ABI the app is built for on a device: its primary ABI when the SDK supports it (an x86_64 emulator also lists arm64-v8a through translation, which is slower). */
export async function abiOf(adb: string, serial: string): Promise<Abi | undefined> {
  const primary = (await exec(adb, ["-s", serial, "shell", "getprop", "ro.product.cpu.abi"])).out.trim();
  if (primary === "arm64-v8a" || primary === "x86_64") {
    return primary;
  }
  const list = (await exec(adb, ["-s", serial, "shell", "getprop", "ro.product.cpu.abilist"])).out.trim().split(",");
  if (list.includes("arm64-v8a")) {
    return "arm64-v8a";
  }
  return list.includes("x86_64") ? "x86_64" : undefined;
}

/** Waits until a device finished booting. Returns false when it did not within the time. */
export async function waitForBoot(adb: string, serial: string, seconds: number): Promise<boolean> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const result = await exec(adb, ["-s", serial, "shell", "getprop", "sys.boot_completed"]);
    if (result.out.trim() === "1") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

/** The `android:` section of djinn.proj: package, label and minimum API level (defaults when absent). */
export function appOf(projectText: string | undefined, fallbackName: string): AndroidApp {
  const section = projectText ? /^android:\s*\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m.exec(projectText) : null;
  const body = section ? section[1] : "";
  const pick = (key: string): string | undefined => {
    const match = new RegExp(`^\\s+${key}:\\s*"?([^"\\r\\n]*)"?\\s*$`, "m").exec(body);
    return match ? match[1].trim() : undefined;
  };
  const identifier = fallbackName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "app";
  return {
    package: pick("package") || `dev.djinn.${/^\d/.test(identifier) ? `app_${identifier}` : identifier}`,
    label: pick("label") || fallbackName,
    minApi: Number(pick("min-api")) || 26,
  };
}

/** lldb-server for the device's ABI, from the NDK's clang resource folder. */
export function lldbServerPath(ndk: string | undefined, abi: Abi): string | undefined {
  if (!ndk) {
    return undefined;
  }
  const prebuilt = path.join(ndk, "toolchains", "llvm", "prebuilt");
  if (!fs.existsSync(prebuilt)) {
    return undefined;
  }
  const arch = abi === "arm64-v8a" ? "aarch64" : "x86_64";
  for (const host of fs.readdirSync(prebuilt)) {
    const clang = path.join(prebuilt, host, "lib", "clang");
    if (!fs.existsSync(clang)) {
      continue;
    }
    for (const version of fs.readdirSync(clang)) {
      const candidate = path.join(clang, version, "lib", "linux", arch, "lldb-server");
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** The process id of a running app, or undefined. */
export async function pidOf(adb: string, serial: string, pkg: string): Promise<number | undefined> {
  const result = await exec(adb, ["-s", serial, "shell", "pidof", "-s", pkg]);
  const pid = Number(result.out.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** Waits for the app's process after it was started. */
export async function waitForPid(adb: string, serial: string, pkg: string, seconds: number): Promise<number | undefined> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const pid = await pidOf(adb, serial, pkg);
    if (pid) {
      return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return undefined;
}

export const ACTIVITY = "android.app.NativeActivity";

/** Installs the APK, replacing an installed copy, and starts the app (waiting for a debugger with `wait`). */
export async function install(adb: string, serial: string, apk: string, onOutput?: (text: string) => void): Promise<ExecResult> {
  return exec(adb, ["-s", serial, "install", "-r", "-t", apk], {}, onOutput);
}

export async function start(adb: string, serial: string, pkg: string, wait: boolean): Promise<ExecResult> {
  await exec(adb, ["-s", serial, "shell", "am", "force-stop", pkg]);
  const args = ["-s", serial, "shell", "am", "start", "-W"];
  if (wait) {
    args.push("-D");
  }
  args.push("-n", `${pkg}/${ACTIVITY}`);
  return exec(adb, args);
}

export async function stop(adb: string, serial: string, pkg: string): Promise<void> {
  await exec(adb, ["-s", serial, "shell", "am", "force-stop", pkg]);
}

/** Streams the app's log (adb logcat for its pid, the "djinn" tag and crashes). Returns the process so the caller can kill it. */
export function logcat(adb: string, serial: string, pid: number, onOutput: (text: string) => void): cp.ChildProcess {
  const child = cp.spawn(adb, ["-s", serial, "logcat", `--pid=${pid}`, "-v", "time"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child.stdout?.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => onOutput(chunk.toString()));
  return child;
}

/** A PNG of the device screen. */
export function screenshot(adb: string, serial: string, file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = cp.spawn(adb, ["-s", serial, "exec-out", "screencap", "-p"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const out = fs.createWriteStream(file);
    child.stdout?.pipe(out);
    child.on("error", () => resolve(false));
    child.on("close", (code) => out.end(() => resolve(code === 0)));
  });
}
