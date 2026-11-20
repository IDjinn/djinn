import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as build from "./build";
import * as sdk from "./androidsdk";
import * as toolchain from "./toolchain";
import { LaunchConfig, ServerInfo } from "./types";

interface Tools {
  sdk?: string;
  ndk?: string;
  adb: string;
  emulator: string;
}

/** An app started on a device: what to stop and what to clean up when it ends. */
interface Session {
  serial: string;
  adb: string;
  package: string;
  log?: cp.ChildProcess;
  server?: cp.ChildProcess;
}

export type AndroidMode = "build" | "run" | "debug";

/**
 * Run and debug of Djinn UI apps on Android devices and emulators: device choice, the build (tools/android_build.sh), install,
 * start, the app's log, a native debugger through lldb-server, screenshots and a setup check.
 */
export class Android {
  private readonly channel = vscode.window.createOutputChannel("Djinn Android");
  private session: Session | undefined;

  constructor(private readonly getInfo: () => Promise<ServerInfo | undefined>) {}

  register(): vscode.Disposable[] {
    return [
      this.channel,
      vscode.commands.registerCommand("djinn.android.selectDevice", () => this.selectDevice()),
      vscode.commands.registerCommand("djinn.android.run", () => this.launch({ platform: "android", mode: "run" })),
      vscode.commands.registerCommand("djinn.android.debug", () => this.launch({ platform: "android", mode: "debug" })),
      vscode.commands.registerCommand("djinn.android.stop", () => this.stopApp()),
      vscode.commands.registerCommand("djinn.android.screenshot", () => this.screenshot()),
      vscode.commands.registerCommand("djinn.android.doctor", () => this.doctor()),
      vscode.debug.onDidTerminateDebugSession((debugSession) => {
        if (debugSession.configuration && debugSession.configuration.djinnAndroid) {
          void this.stopApp();
        }
      }),
      vscode.tasks.registerTaskProvider("djinn-android", this.taskProvider()),
    ];
  }

  private tools(): Tools {
    const settings = toolchain.settings();
    const root = sdk.sdkPath(settings.get<string>("android.sdk"));
    return { sdk: root, ndk: sdk.ndkPath(root, settings.get<string>("android.ndk")), adb: sdk.adbPath(root), emulator: sdk.emulatorPath(root) };
  }

  private log(text: string): void {
    this.channel.append(text.endsWith("\n") ? text : `${text}\n`);
  }

  // ---- devices ---------------------------------------------------------------------------------------------------------

  /** Lets the user pick an attached device or start a virtual one; the choice is stored in djinn.android.device. */
  async selectDevice(): Promise<sdk.Device | undefined> {
    const tools = this.tools();
    const [attached, names] = await Promise.all([sdk.devices(tools.adb), sdk.avds(tools.emulator)]);
    const running = new Set<string>();
    for (const device of attached) {
      const name = device.emulator ? await sdk.avdOf(tools.adb, device.serial) : undefined;
      if (name) {
        running.add(name);
      }
    }
    type Item = vscode.QuickPickItem & { device?: sdk.Device; avd?: string };
    const items: Item[] = attached.map((device) => ({
      label: `$(device-mobile) ${device.model || device.serial}`,
      description: `${device.serial} · ${device.state}`,
      device,
    }));
    for (const name of names.filter((candidate) => !running.has(candidate))) {
      items.push({ label: `$(play) ${name}`, description: "virtual device (starts the emulator)", avd: name });
    }
    if (items.length === 0) {
      vscode.window.showWarningMessage("No Android device found. Attach one with USB debugging or create a virtual device in Android Studio (Djinn: Android Doctor shows what is missing).");
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(items, { placeHolder: "Android device to run on" });
    if (!picked) {
      return undefined;
    }
    let device = picked.device;
    if (!device && picked.avd) {
      device = await this.startAvd(tools, picked.avd);
    }
    if (device) {
      await this.remember(device.serial);
    }
    return device;
  }

  private async remember(serial: string): Promise<void> {
    const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await toolchain.settings().update("android.device", serial, target);
  }

  private startAvd(tools: Tools, name: string): Promise<sdk.Device | undefined> {
    return Promise.resolve(
      vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Starting the emulator ${name}` }, async () => {
        const before = new Set((await sdk.devices(tools.adb)).map((device) => device.serial));
        const child = cp.spawn(tools.emulator, ["-avd", name], { detached: true, stdio: "ignore", windowsHide: false });
        child.on("error", (error) => this.log(`emulator: ${error.message}`));
        child.unref();
        const deadline = Date.now() + 120000;
        let found: sdk.Device | undefined;
        while (!found && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          found = (await sdk.devices(tools.adb)).find((device) => device.emulator && !before.has(device.serial));
        }
        if (!found) {
          vscode.window.showErrorMessage(`The emulator ${name} did not appear in adb within two minutes.`);
          return undefined;
        }
        if (!(await sdk.waitForBoot(tools.adb, found.serial, 240))) {
          vscode.window.showErrorMessage(`The emulator ${name} did not finish booting.`);
          return undefined;
        }
        return found;
      })
    );
  }

  /** The device to use: the launch configuration's, else the stored choice, else the only attached one, else ask. */
  private async resolveDevice(tools: Tools, wanted?: string): Promise<sdk.Device | undefined> {
    const attached = (await sdk.devices(tools.adb)).filter((device) => device.state === "device");
    const serial = wanted === "ask" ? "" : wanted || toolchain.settings().get<string>("android.device") || "";
    const chosen = serial ? attached.find((device) => device.serial === serial) : undefined;
    if (chosen) {
      return chosen;
    }
    if (!serial && attached.length === 1) {
      return attached[0];
    }
    return this.selectDevice();
  }

  // ---- build -----------------------------------------------------------------------------------------------------------

  private bash(): string {
    const configured = toolchain.settings().get<string>("android.bash");
    if (configured) {
      return configured;
    }
    if (process.platform === "win32") {
      const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")].filter((root): root is string => Boolean(root));
      for (const root of roots) {
        const candidate = path.join(root, "Git", "bin", "bash.exe");
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return "bash";
  }

  private script(name: string): string | undefined {
    const configured = toolchain.settings().get<string>("android.toolsDir");
    const candidates = [
      configured ? path.join(configured, name) : undefined,
      toolchain.repoRoot() ? path.join(toolchain.repoRoot() as string, "tools", name) : undefined,
      toolchain.installed("tools", name),
      toolchain.installed("optional", "android", "tools", name),
    ];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate));
  }

  private environment(tools: Tools): Record<string, string> {
    const env = toolchain.environment();
    if (tools.sdk) {
      env.ANDROID_HOME = tools.sdk;
    }
    if (tools.ndk) {
      env.DJINN_NDK = tools.ndk;
    }
    return env;
  }

  /** Builds the app and its APK for an ABI (debuggable with debug info when `debug`). Returns the APK. */
  private async buildApp(target: string, abi: sdk.Abi, app: sdk.AndroidApp, debug: boolean, tools: Tools): Promise<string | undefined> {
    const script = this.script("android_build.sh");
    const compiler = toolchain.compiler(await this.getInfo());
    const hostRuntime = toolchain.runtimeLib();
    if (!script) {
      vscode.window.showErrorMessage("tools/android_build.sh was not found (a Djinn checkout or an installed toolchain with the Android tools). Set djinn.android.toolsDir.");
      return undefined;
    }
    if (!tools.ndk) {
      vscode.window.showErrorMessage("The Android NDK was not found. Install it from Android Studio's SDK Manager or set djinn.android.ndk.");
      return undefined;
    }
    if (!compiler || !hostRuntime) {
      vscode.window.showErrorMessage("djinnc or its runtime library was not found. Set djinn.compilerPath and djinn.runtimeLib.");
      return undefined;
    }
    const name = path.basename(target, ".djinn");
    const out = path.join(target, "build", "android", abi);
    const args = [script.replace(/\\/g, "/"), target.replace(/\\/g, "/"), "--out", out.replace(/\\/g, "/"), "--abi", abi, "--apk", "--package", app.package, "--label", app.label, "--api", String(app.minApi)];
    if (debug) {
      args.push("--debug");
    }
    this.log(`> building ${name} for ${abi}${debug ? " (debug)" : ""}`);
    const env = { ...this.environment(tools), DJINNC: compiler, DJINN_HOST_RUNTIME_LIB: hostRuntime };
    const result = await sdk.exec(this.bash(), args, { env, cwd: target }, (text) => this.channel.append(text));
    if (result.code !== 0) {
      this.channel.show(true);
      vscode.window.showErrorMessage("The Android build failed. See the Djinn Android output.");
      return undefined;
    }
    const apk = path.join(out, `${path.basename(target)}-${abi}.apk`);
    return fs.existsSync(apk) ? apk : undefined;
  }

  // ---- run and debug ---------------------------------------------------------------------------------------------------

  /** Builds, installs and starts the app; `mode` run streams its log, debug attaches lldb. */
  async launch(config: LaunchConfig, explicitTarget?: string): Promise<void> {
    const mode = (config.mode === "build" || config.mode === "debug" ? config.mode : "run") as AndroidMode;
    const target = toolchain.resolveTarget(explicitTarget || config.target);
    if (!target || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      vscode.window.showWarningMessage("Open the Djinn app's project folder (with a djinn.proj) first.");
      return;
    }
    const plan = build.describe(target);
    if (plan.isLibrary) {
      vscode.window.showWarningMessage("This project is a library (.djlib): it has no entry point to run on a device.");
      return;
    }
    await vscode.window.activeTextEditor?.document.save();
    const tools = this.tools();
    this.channel.show(true);
    if (!tools.sdk) {
      vscode.window.showErrorMessage("The Android SDK was not found. Set djinn.android.sdk or ANDROID_HOME (Djinn: Android Doctor).");
      return;
    }
    const buildOnly = mode === "build" && Boolean(config.abi);
    const device = buildOnly ? undefined : await this.resolveDevice(tools, config.device);
    if (!device && !buildOnly) {
      return;
    }
    const abi = ((config.abi as sdk.Abi | undefined) || (toolchain.settings().get<string>("android.abi") as sdk.Abi | "") || (device ? await sdk.abiOf(tools.adb, device.serial) : undefined)) as sdk.Abi | undefined;
    if (!abi) {
      vscode.window.showErrorMessage("The device runs neither arm64-v8a nor x86_64.");
      return;
    }
    const manifest = path.join(target, "djinn.proj");
    const app = sdk.appOf(fs.existsSync(manifest) ? fs.readFileSync(manifest, "utf8") : undefined, plan.name);
    if (config.package) {
      app.package = config.package;
    }
    const apk = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Building ${plan.name} for Android` }, () =>
      this.buildApp(target, abi, app, mode === "debug", tools)
    );
    if (!apk || mode === "build" || !device) {
      if (apk) {
        this.log(`built ${apk}`);
      }
      return;
    }
    await this.stopApp();
    this.log(`> installing on ${device.model || device.serial}`);
    const installed = await sdk.install(tools.adb, device.serial, apk, (text) => this.channel.append(text));
    if (installed.code !== 0 || !/Success/.test(installed.out)) {
      vscode.window.showErrorMessage("adb install failed. See the Djinn Android output.");
      return;
    }
    this.log(`> starting ${app.package}`);
    const started = await sdk.start(tools.adb, device.serial, app.package, false);
    this.channel.append(started.out);
    const pid = await sdk.waitForPid(tools.adb, device.serial, app.package, 15);
    if (!pid) {
      vscode.window.showErrorMessage("The app did not start (no process). See the Djinn Android output and `adb logcat`.");
      return;
    }
    const session: Session = { serial: device.serial, adb: tools.adb, package: app.package };
    this.session = session;
    session.log = sdk.logcat(tools.adb, device.serial, pid, (text) => this.channel.append(text));
    this.log(`> running as pid ${pid}; Djinn: Stop Android App ends it`);
    if (mode === "debug") {
      await this.attach(session, tools, abi, pid, path.join(target, "build", "android", abi), config);
    }
  }

  /** Starts lldb-server in the app's sandbox, forwards it and attaches the LLDB debugger (the CodeLLDB extension) to the process. */
  private async attach(session: Session, tools: Tools, abi: sdk.Abi, pid: number, outDir: string, config: LaunchConfig): Promise<void> {
    const server = sdk.lldbServerPath(tools.ndk, abi);
    if (!server) {
      vscode.window.showErrorMessage("lldb-server was not found in the NDK (toolchains/llvm/prebuilt/*/lib/clang/*/lib/linux/<arch>/).");
      return;
    }
    const { adb, serial } = session;
    const pkg = session.package;
    // an lldb-server left by an earlier session keeps its file busy
    await sdk.exec(adb, ["-s", serial, "shell", "run-as", pkg, "pkill", "lldb-server"]);
    const steps: string[][] = [
      ["push", server, "/data/local/tmp/lldb-server"],
      ["shell", "run-as", pkg, "cp", "/data/local/tmp/lldb-server", "lldb-server"],
      ["shell", "run-as", pkg, "chmod", "700", "lldb-server"],
    ];
    for (const step of steps) {
      const result = await sdk.exec(adb, ["-s", serial, ...step]);
      if (result.code !== 0 || /not debuggable|Unknown package/i.test(result.out)) {
        this.log(result.out);
        vscode.window.showErrorMessage("Could not put lldb-server in the app (the APK must be debuggable: a debug build).");
        return;
      }
    }
    // lldb-server listens on an abstract socket; the LLDB android platform forwards it through adb itself
    const socket = `${pkg}-0/platform.sock`;
    await sdk.exec(adb, ["-s", serial, "shell", "run-as", pkg, "pkill", "lldb-server"]);
    session.server = cp.spawn(adb, ["-s", serial, "shell", "run-as", pkg, "./lldb-server", "platform", "--server", "--listen", `unix-abstract:///${socket}`], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    session.server.stderr?.on("data", (chunk: Buffer) => this.channel.append(chunk.toString()));
    await new Promise((resolve) => setTimeout(resolve, 800));
    const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
      type: "lldb",
      request: "attach",
      name: config.name || "Djinn: Debug on Android",
      pid,
      djinnAndroid: true,
      initCommands: [
        "platform select remote-android",
        `platform connect unix-abstract-connect://${serial}/${socket}`,
        // ART raises these signals itself (implicit null checks, thread control): they are not stops
        "process handle SIGSEGV SIGBUS SIGPWR SIGCHLD SIGUSR1 SIGUSR2 SIGXCPU SIGSYS -p true -s false -n false",
        `settings set target.exec-search-paths "${outDir.replace(/\\/g, "/")}"`,
      ],
    });
    if (!started) {
      vscode.window.showErrorMessage('Could not start the LLDB debugger. Install the "CodeLLDB" extension (vadimcn.vscode-lldb).');
    }
  }

  async stopApp(): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    this.session = undefined;
    session.log?.kill();
    if (session.server) {
      session.server.kill();
      // killing the local adb does not end the process on the device
      await sdk.exec(session.adb, ["-s", session.serial, "shell", "run-as", session.package, "pkill", "lldb-server"]);
    }
    await sdk.stop(session.adb, session.serial, session.package);
    this.log(`> stopped ${session.package}`);
  }

  // ---- screenshot, doctor, tasks ---------------------------------------------------------------------------------------

  async screenshot(): Promise<void> {
    const tools = this.tools();
    const device = await this.resolveDevice(tools);
    if (!device) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const directory = path.join(folder, "build", "android", "screenshots");
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
    if (await sdk.screenshot(tools.adb, device.serial, file)) {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file));
    } else {
      vscode.window.showErrorMessage("adb could not take a screenshot.");
    }
  }

  /** Reports what the Android setup has and what is missing, with the step that fixes each. */
  async doctor(): Promise<void> {
    const tools = this.tools();
    const report: string[] = [];
    const row = (ok: boolean, what: string, detail: string): void => {
      report.push(`${ok ? "ok     " : "MISSING"} ${what}: ${detail}`);
    };
    row(Boolean(tools.sdk), "Android SDK", tools.sdk || "set djinn.android.sdk or ANDROID_HOME (Android Studio installs it)");
    row(Boolean(tools.ndk), "Android NDK", tools.ndk || "Android Studio > SDK Manager > SDK Tools > NDK (Side by side)");
    const adbVersion = await sdk.exec(tools.adb, ["version"]);
    row(adbVersion.code === 0, "adb", adbVersion.code === 0 ? adbVersion.out.split(/\r?\n/)[0] : "install platform-tools (SDK Manager)");
    if (tools.sdk) {
      const buildTools = path.join(tools.sdk, "build-tools");
      const versions = fs.existsSync(buildTools) ? fs.readdirSync(buildTools).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
      row(versions.length > 0, "build-tools (aapt2, zipalign, apksigner)", versions.length ? versions[versions.length - 1] : "SDK Manager > SDK Tools > Android SDK Build-Tools");
    }
    const abis: sdk.Abi[] = ["arm64-v8a", "x86_64"];
    for (const abi of abis) {
      const lldb = sdk.lldbServerPath(tools.ndk, abi);
      row(Boolean(lldb), `lldb-server (${abi})`, lldb || "only needed to debug: ships with the NDK");
    }
    const script = this.script("android_build.sh");
    row(Boolean(script), "tools/android_build.sh", script || "needs a Djinn checkout or the toolchain's Android tools (djinn.android.toolsDir)");
    const bash = await sdk.exec(this.bash(), ["--version"]);
    row(bash.code === 0, "bash", bash.code === 0 ? bash.out.split(/\r?\n/)[0] : "install Git for Windows (Git Bash) or set djinn.android.bash");
    const keytool = await sdk.exec("keytool", ["-help"]);
    row(keytool.code === 0 || /keytool/i.test(keytool.out), "JDK keytool", keytool.code === 0 ? "found" : "install a JDK (the APK is signed with a debug key)");
    const compiler = toolchain.compiler(await this.getInfo());
    row(Boolean(compiler), "djinnc", compiler || "install the toolchain (Djinn: Install)");
    row(Boolean(toolchain.runtimeLib()), "host runtime library", toolchain.runtimeLib() || "needed for procedural macros during the build");
    const attached = await sdk.devices(tools.adb);
    row(attached.some((device) => device.state === "device"), "device", attached.length ? attached.map((device) => `${device.model || device.serial} (${device.state})`).join(", ") : "attach one with USB debugging or start an AVD (Djinn: Select Android Device)");
    const names = await sdk.avds(tools.emulator);
    report.push(`        virtual devices: ${names.length ? names.join(", ") : "none (Android Studio > Device Manager)"}`);
    this.channel.clear();
    this.log(report.join("\n"));
    this.channel.show(true);
    const missing = report.filter((line) => line.startsWith("MISSING")).length;
    if (missing === 0) {
      vscode.window.showInformationMessage("Android setup: everything needed was found.");
    } else {
      vscode.window.showWarningMessage(`Android setup: ${missing} item(s) missing. See the Djinn Android output.`);
    }
  }

  private taskProvider(): vscode.TaskProvider {
    const commands = ["build", "run", "debug"] as const;
    const make = (definition: vscode.TaskDefinition & { command: string; target?: string }, scope: vscode.WorkspaceFolder | vscode.TaskScope, name: string): vscode.Task => {
      const execution = new vscode.CustomExecution(async () => {
        const writer = new vscode.EventEmitter<string>();
        const closed = new vscode.EventEmitter<number | void>();
        return {
          onDidWrite: writer.event,
          onDidClose: closed.event,
          open: async () => {
            writer.fire(`djinn android ${definition.command}: see the Djinn Android output\r\n`);
            await this.launch({ platform: "android", mode: definition.command, target: definition.target });
            closed.fire(0);
          },
          close: () => undefined,
        } as vscode.Pseudoterminal;
      });
      return new vscode.Task(definition, scope, name, "djinn-android", execution);
    };
    return {
      provideTasks: () => commands.map((command) => make({ type: "djinn-android", command }, vscode.TaskScope.Workspace, `djinn android ${command}`)),
      resolveTask: (task) => {
        const definition = task.definition as vscode.TaskDefinition & { command: string; target?: string };
        return make(definition, task.scope || vscode.TaskScope.Workspace, task.name || `djinn android ${definition.command}`);
      },
    };
  }
}
