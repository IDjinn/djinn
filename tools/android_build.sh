#!/usr/bin/env bash
# Builds a Djinn UI app for Android: the libraries for the target (ui, android), the app as a shared library and, with
# --apk, a signed APK. The macros library runs on the host (procedural macros run in the JIT), everything else is built
# for the Android triple.
# usage: android_build.sh <app dir> --out <dir> [--abi arm64-v8a|x86_64] [--api 26] [--apk] [--debug] [--package id] [--label name]
# environment: DJINN_NDK (or ANDROID_NDK_HOME), ANDROID_HOME for the APK, DJINNC (default: djinnc on PATH),
#   DJINN_HOST_RUNTIME_LIB (the host runtime library, default: the install's lib/), DJINN_ANDROID_RUNTIME_LIB (the target
#   runtime, default: built here with tools/build_runtime.sh --android).
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
app="" out="" abi="arm64-v8a" api=26 apk=0 debug=0 package="dev.djinn.app" label="Djinn app"
while [ $# -gt 0 ]; do
    case "$1" in
        --out) out="$2"; shift 2 ;;
        --abi) abi="$2"; shift 2 ;;
        --api) api="$2"; shift 2 ;;
        --apk) apk=1; shift ;;
        --debug) debug=1; shift ;;
        --package) package="$2"; shift 2 ;;
        --label) label="$2"; shift 2 ;;
        -*) echo "android_build: unknown option $1"; exit 2 ;;
        *) app="$1"; shift ;;
    esac
done
if [ -z "$app" ] || [ -z "$out" ]; then
    echo "usage: android_build.sh <app dir> --out <dir> [--abi arm64-v8a|x86_64] [--api 26] [--apk] [--debug] [--package id] [--label name]"
    exit 2
fi
export DJINN_NDK="${DJINN_NDK:-${ANDROID_NDK_HOME:-}}"
[ -n "$DJINN_NDK" ] || { echo "android_build: set DJINN_NDK (or ANDROID_NDK_HOME); tools/android_doctor.sh checks the setup"; exit 1; }

case "$abi" in
    arm64-v8a) triple="aarch64-linux-android$api" ;;
    x86_64) triple="x86_64-linux-android$api" ;;
    *) echo "android_build: unknown ABI $abi"; exit 2 ;;
esac
djinnc="${DJINNC:-djinnc}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
libs="$out/libs"
mkdir -p "$libs/$triple"

host_runtime="${DJINN_HOST_RUNTIME_LIB:-}"
if [ -z "$host_runtime" ]; then
    install_root="$(cd "$(dirname "$(command -v "$djinnc")")/.." && pwd)"
    for candidate in "$install_root/lib/djinn_runtime.lib" "$install_root/lib/libdjinn_runtime.a"; do
        [ -f "$candidate" ] && host_runtime="$candidate" && break
    done
fi
[ -n "$host_runtime" ] || { echo "android_build: set DJINN_HOST_RUNTIME_LIB"; exit 1; }

if [ -z "${DJINN_ANDROID_RUNTIME_LIB:-}" ]; then
    bash "$root/tools/build_runtime.sh" --android "$abi" --out "$out/runtime-$abi" > /dev/null
    export DJINN_ANDROID_RUNTIME_LIB="$out/runtime-$abi/libdjinn_runtime.a"
fi

cd "$root"
flags=(--lib-dir "$libs" --std-dir "$root/std" --runtime-dir "$root/runtime" --runtime-lib "$host_runtime")
for lib in ui_macros spirv; do
    "$djinnc" "libs/$lib" -o "$libs/$lib.djlib" "${flags[@]}" > "$out/host-$lib.log" 2>&1 || { cat "$out/host-$lib.log"; exit 1; }
done
# spirv is built for the target after vulkan: while vulkan expands spirv!, the host build of it must be the one found
rm -f "$libs/$triple/spirv.djlib"
for lib in ui vulkan spirv android; do
    "$djinnc" "libs/$lib" -o "$libs/$triple/$lib.djlib" "${flags[@]}" --target "$triple" > "$out/$lib.log" 2>&1 || { cat "$out/$lib.log"; exit 1; }
done
name="$(basename "$app")"
so="$out/lib$name.so"
debug_flags=()
[ "$debug" = 1 ] && debug_flags=(-g -O0)
"$djinnc" "$app" -o "$so" "${flags[@]}" --target "$triple" ${debug_flags[@]+"${debug_flags[@]}"} > "$out/app.log" 2>&1 || { cat "$out/app.log"; exit 1; }
echo "$so"
if [ "$apk" = 1 ]; then
    bash "$root/tools/android_apk.sh" --lib "$so" --abi "$abi" --out "$out/$name-$abi.apk" --package "$package" --label "$label" --min-api "$api" $([ "$debug" = 1 ] && echo --debuggable)
fi
