# Android roadmap

Native Android for Djinn and the `libs/ui` framework: the same `html!`/`css!` source and kit as web and Windows, drawn by the
framework's own renderer (Vulkan), with the NDK only where the platform is irreplaceable (lifecycle, touch, IME, clipboard,
insets, fonts, accessibility). Feasibility study: the display list, layout, style and reactive core are about 85% reusable;
the risk is the compiler/runtime, not the UI.

## Environment

- Android SDK (`platform-tools`, `emulator`, a system image) and the NDK r27+ (`DJINN_NDK` or `ANDROID_NDK_HOME`).
- Targets: `aarch64-linux-android<api>` (devices) and `x86_64-linux-android<api>` (emulator), default API 26.
- `bash tools/build_runtime.sh --android <arm64-v8a|x86_64> --out <dir>` builds the runtime with the NDK.
- `djinnc app --target aarch64-linux-android26 --runtime-lib <lib> -o app` links with the NDK clang; an output ending in
  `.so` is a shared library. Releases carry `lib/android/<abi>/libdjinn_runtime.a` (found automatically).
- `tests/djinnc/android.sh <djinnc>` builds for both ABIs and runs on a connected device or emulator (skips without the NDK).

## Phases

| # | Phase | State |
|---|---|---|
| 0 | Compile proof: AArch64 backend, data layout, NDK link, Bionic runtime, hello runs on the emulator (x86_64 and arm64) | done |
| 0a | Release: Android runtime for both ABIs in the Linux and Windows packages | done |
| 0b | Performance prerequisites: bucket style rules by rightmost key, find the ~11 KB/node retention, dirty tracking / retained display lists | open |
| 1 | `.so` entry point and software host: `NativeActivity` through `android_native_app_glue` (`runtime/android/android_host.c`), `libs/android` (`AndroidHost.run`, fonts), system fonts through stb_truetype (instead of FreeType), `SoftRaster` blit to `ANativeWindow`, touch as mouse (tap, drag scroll), APK without Gradle (`tools/android_apk.sh`, `tools/android_build.sh`), `examples/android-hello` runs on the emulator | done |
| 2 | Vulkan: `libs/vulkan` platform files (`platform.windows/android.djinn`: surface, loader), `VK_KHR_android_surface`, surface format chosen from the surface (B8G8R8A8 or R8G8B8A8), `VkApplicationInfo` (the Android loader lists no device without it), surface recreated with the window (home/back), rotation through identity `preTransform` (the compositor rotates). Runs on the emulator (SwiftShader). Left: pre-rotated swapchain, frame-time numbers on a real device | done (emulator) |
| 3 | Input and environment: touch (tap, drag, fling, long press as `contextmenu`), hardware and soft keyboard keys (US layout) into `Input.press`/`Input.typed`, soft keyboard shown for editable controls, window insets (system bars, cutout, keyboard) through JNI, dark mode, density, `pointer: coarse`. Left: IME composition (text input connection, other layouts), multiline edit (a `libs/ui` feature, not Android specific), multi-touch gestures | done (emulator) |
| 4 | Product: APK packaging (`aapt2` + `apksigner`, no Gradle), clipboard, VS Code run/debug (device picker, build, install, log, lldb-server attach, screenshot, doctor, `djinn-android` tasks; `android:` section in `djinn.proj`). Release: an `android` installer component (per-triple libraries, host macro libraries, build/APK scripts; `android_build.sh` uses the prebuilt libraries of an install). Left: run that packaging in CI (written, not run), `[Platform(android)]` in the kit, headless screenshot tests, emulator in CI | in progress (emulator) |
| 5 | Advanced: shaping, images/gradients/shadows in the display list, accessibility, iOS reusing the structure | open |

Open decisions: minimum API (26), arm64 first with x86_64 for the emulator, toolchain-only packaging vs. Gradle, stb_truetype (public domain, one header) instead of FreeType for fonts.

## Run and debug from the VS Code extension

Status: implemented in `tools/vscode-djinn/src/android.ts` (+ `androidsdk.ts`, `scripts/android_smoke.js`). The smoke script (device, ABI,
build, install, start, log, screenshot, stop) passes on the emulator. The debugger flow was checked with the NDK's `lldb` against
the emulator: attach through `unix-abstract-connect://<serial>/<socket>`, the app's `.so` is matched through `exec-search-paths`,
breakpoints on `main.djinn` lines resolve (`hello::Counter.render`, the lambdas) and a breakpoint hit stops the app thread. The
CodeLLDB attach itself (the `lldb` debug type the extension starts) and the VS Code UI were not exercised. Android debug builds need
DWARF: djinnc emitted CodeView flags when cross-compiling from Windows, now DWARF for Android targets.

The extension (`tools/vscode-djinn`) already has the `djinn` debug type (build, run, profile, native debugger launch) and tasks.
Android adds a `platform: "android"` launch configuration so an app is one F5 away:

1. **Devices**: a `Djinn: Select Android Device` command lists `adb devices` and AVDs (`emulator -list-avds`), can start an AVD,
   and stores the choice (`djinn.android.device`). Settings: `djinn.android.sdk`, `djinn.android.ndk`, `djinn.android.abi`
   (default: the device's first ABI).
2. **Build**: the launch config builds with `--target <abi triple>` (`-g` for debug) and the Android runtime; the output is the
   `.so` (and, from phase 4, the APK) in `build/android/<abi>/`.
3. **Run** (`mode: run`): install (`adb install -r`), start (`am start -n <package>/android.app.NativeActivity`), and stream
   `adb logcat --pid` into an output channel; stop kills the app (`am force-stop`).
4. **Debug** (`mode: debug`): push `lldb-server` from the NDK, start it on the device (`adb forward`), start the app waiting
   for the debugger (`am start -D`), and attach with the native debugger (`type: lldb` or `cppdbg` with `miDebuggerServerAddress`)
   using the unstripped `.so` and the source map, so Djinn lines and breakpoints work.
5. **Tasks**: `djinn-android` task type (build, install, run, logcat) so the steps can be chained in `tasks.json`.
6. **Hot path to feedback**: a `Djinn: Android Screenshot` command (`adb exec-out screencap`) next to the preview, and the
   existing profiling flow reused with Perfetto/`simpleperf` instead of `perf`.
7. **Checks**: a `Djinn: Doctor` entry for Android that reports missing SDK/NDK/adb/device and the exact install steps.

Prerequisite in the compiler: debug info (`-g`) for Android targets keeps DWARF in the `.so` (phase 1), and the app package name
and activity come from `djinn.proj` (`android:` section: package, label, min API, permissions).

## Text input: controlled fields

A field bound to a signal (`Field value={signal}` echoed elsewhere) does not show the controlled-input problems of bridged
frameworks: `Edit` keeps the caret outside the value, the echo of the signal into the field (`Dom.set_attr` with identical text)
is a no-op, and `render()` runs once (signals update the nodes), so a key press never recreates the field. Checked on the
emulator with `examples/android-hello`: 36 characters typed at once arrive in order, ten left-arrow presses and an insertion put
the text at the caret, and the echo equals the field. Not covered: soft keyboard composition (no text input connection yet),
a signal that rewrites what was typed (the caret is clamped, not remapped), and typing latency on a large page (every key repaints
the tree until dirty tracking exists, Phase 0b).
