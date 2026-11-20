// Exercises the extension's Android helpers (out/androidsdk.js, built with `npm run compile`) against a real device or emulator:
// device and ABI detection, the djinn.proj `android:` section, install, start, the app's log, a screenshot and stop. It does not
// start the VS Code UI. With --build it first builds the app the way the extension does (tools/android_build.sh --debug).
//   node scripts/android_smoke.js <app project dir> [--build] [--abi x86_64|arm64-v8a]
// environment (for --build): DJINNC, DJINN_HOST_RUNTIME_LIB, DJINN_NDK, ANDROID_HOME (see tools/android_doctor.sh)
const fs = require("fs");
const os = require("os");
const path = require("path");
const sdk = require("../out/androidsdk.js");

const args = process.argv.slice(2);
const project = path.resolve(args.find((arg) => !arg.startsWith("--")) || "");
const wantBuild = args.includes("--build");
const abiArg = args.includes("--abi") ? args[args.indexOf("--abi") + 1] : undefined;
let failures = 0;
const check = (ok, what, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};

(async () => {
  const root = sdk.sdkPath();
  check(Boolean(root), "sdk", root);
  const ndk = sdk.ndkPath(root);
  check(Boolean(ndk), "ndk", ndk);
  const adb = sdk.adbPath(root);
  const emulator = sdk.emulatorPath(root);
  const attached = (await sdk.devices(adb)).filter((device) => device.state === "device");
  check(attached.length > 0, "devices", attached.map((device) => `${device.serial} ${device.model}`).join(", "));
  const names = await sdk.avds(emulator);
  console.log(`     avds: ${names.join(", ") || "none"}`);
  if (attached.length === 0) {
    process.exit(1);
  }
  const device = attached[0];
  const abi = abiArg || (await sdk.abiOf(adb, device.serial));
  check(Boolean(abi), "abi", abi);
  if (device.emulator) {
    check(Boolean(await sdk.avdOf(adb, device.serial)), "avd name", await sdk.avdOf(adb, device.serial));
  }
  check(Boolean(sdk.lldbServerPath(ndk, abi)), "lldb-server", sdk.lldbServerPath(ndk, abi));

  const manifest = path.join(project, "djinn.proj");
  const app = sdk.appOf(fs.existsSync(manifest) ? fs.readFileSync(manifest, "utf8") : undefined, path.basename(project));
  console.log(`     app: ${JSON.stringify(app)}`);
  check(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(app.package), "package id", app.package);
  const fallback = sdk.appOf(undefined, "My Cool App");
  check(fallback.package === "dev.djinn.my_cool_app" && fallback.label === "My Cool App" && fallback.minApi === 26, "defaults without an android: section", JSON.stringify(fallback));

  const out = path.join(project, "build", "android", abi);
  if (wantBuild) {
    const script = path.resolve(__dirname, "..", "..", "android_build.sh").replace(/\\/g, "/");
    const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
    const result = await sdk.exec(
      bash,
      [script, project.replace(/\\/g, "/"), "--out", out.replace(/\\/g, "/"), "--abi", abi, "--apk", "--package", app.package, "--label", app.label, "--api", String(app.minApi), "--debug"],
      { env: process.env, cwd: project },
      (text) => process.stdout.write(text)
    );
    check(result.code === 0, "build");
  }
  const apk = path.join(out, `${path.basename(project)}-${abi}.apk`);
  check(fs.existsSync(apk), "apk", apk);
  if (!fs.existsSync(apk)) process.exit(1);

  const installed = await sdk.install(adb, device.serial, apk);
  check(installed.code === 0 && /Success/.test(installed.out), "install", installed.out.trim().split(/\r?\n/).pop());
  await sdk.stop(adb, device.serial, app.package);
  const started = await sdk.start(adb, device.serial, app.package, false);
  check(started.code === 0 && /Status: ok|Starting/.test(started.out), "start");
  const pid = await sdk.waitForPid(adb, device.serial, app.package, 15);
  check(Boolean(pid), "pid", String(pid));
  let log = "";
  const child = sdk.logcat(adb, device.serial, pid, (text) => (log += text));
  await new Promise((resolve) => setTimeout(resolve, 5000));
  child.kill();
  check(/android: (drawing with|first frame)/.test(log) || /djinn/.test(log), "app log streamed", log.split(/\r?\n/).filter(Boolean).slice(-2).join(" | "));
  const shot = path.join(os.tmpdir(), "djinn-android-smoke.png");
  check(await sdk.screenshot(adb, device.serial, shot) && fs.statSync(shot).size > 1000, "screenshot", shot);
  await sdk.stop(adb, device.serial, app.package);
  check((await sdk.pidOf(adb, device.serial, app.package)) === undefined, "stopped");
  console.log(failures === 0 ? "all ok" : `${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();
