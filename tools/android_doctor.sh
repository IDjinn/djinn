#!/usr/bin/env bash
# Checks the Android build and run setup and says what is missing. Exit 0 when everything needed is present.
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$sdk" ]; then
    for guess in "$LOCALAPPDATA/Android/Sdk" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
        [ -d "$guess" ] && sdk="$guess" && break
    done
fi
ndk="${DJINN_NDK:-${ANDROID_NDK_HOME:-}}"
if [ -z "$ndk" ] && [ -n "$sdk" ] && [ -d "$sdk/ndk" ]; then
    ndk="$(ls -d "$sdk"/ndk/*/ 2>/dev/null | sort | tail -1)"
    ndk="${ndk%/}"
fi
missing=0
check() { # name, ok, hint
    if [ "$2" = 1 ]; then echo "ok      $1"; else echo "MISSING $1: $3"; missing=1; fi
}
check "sdk ($sdk)" "$([ -n "$sdk" ] && [ -d "$sdk" ] && echo 1 || echo 0)" "install the Android SDK and set ANDROID_HOME"
check "ndk ($ndk)" "$([ -n "$ndk" ] && [ -d "$ndk/toolchains/llvm" ] && echo 1 || echo 0)" "sdkmanager \"ndk;27.2.12479018\" and set DJINN_NDK (or ANDROID_NDK_HOME)"
adb="$(command -v adb || true)"
[ -z "$adb" ] && [ -n "$sdk" ] && [ -x "$sdk/platform-tools/adb" -o -x "$sdk/platform-tools/adb.exe" ] && adb="$sdk/platform-tools/adb"
check "adb" "$([ -n "$adb" ] && echo 1 || echo 0)" "install platform-tools and add it to PATH"
build_tools=""
[ -n "$sdk" ] && build_tools="$(ls -d "$sdk"/build-tools/*/ 2>/dev/null | sort | tail -1)"
check "build-tools (aapt2, apksigner)" "$([ -n "$build_tools" ] && echo 1 || echo 0)" "sdkmanager \"build-tools;36.0.0\""
if [ -n "$adb" ]; then
    devices="$("$adb" devices 2>/dev/null | tail -n +2 | grep -c "device$" || true)"
    check "device or emulator" "$([ "${devices:-0}" -gt 0 ] && echo 1 || echo 0)" "connect a device with USB debugging or start an AVD (emulator -avd <name>)"
fi
exit $missing
