#!/usr/bin/env bash
set -eu

usage() {
    echo "usage: build_runtime.sh [--out <dir>] [--android <abi>]"
    echo "  --android <abi>: cross-compile for Android with the NDK (DJINN_NDK or ANDROID_NDK_HOME); abi is arm64-v8a or x86_64"
    echo "builds the release runtime library (djinn_runtime.lib on Windows, libdjinn_runtime.a elsewhere)"
    echo "environment: DJINN_CLANG (default clang), DJINN_AR (default llvm-lib on Windows, llvm-ar elsewhere)"
    exit 2
}

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/build/runtime"
android=""

while [ $# -gt 0 ]; do
    case "$1" in
        --out) out="$2"; shift 2 ;;
        --android) android="$2"; shift 2 ;;
        *) usage ;;
    esac
done

clang="${DJINN_CLANG:-clang}"
flags=(-c -O2 -I "$root/runtime")
if [ -n "$android" ]; then
    # Bionic through the NDK: the NDK clang wrapper already carries the triple and the sysroot.
    ndk="${DJINN_NDK:-${ANDROID_NDK_HOME:-}}"
    api="${DJINN_ANDROID_API:-26}"
    if [ -z "$ndk" ]; then echo "build_runtime: set DJINN_NDK or ANDROID_NDK_HOME"; exit 2; fi
    case "$android" in
        arm64-v8a) triple="aarch64-linux-android$api" ;;
        x86_64) triple="x86_64-linux-android$api" ;;
        *) echo "build_runtime: unknown Android ABI '$android'"; exit 2 ;;
    esac
    ndk_bin="$(ls -d "$ndk"/toolchains/llvm/prebuilt/*/bin | head -1)"
    clang="$ndk_bin/$triple-clang"
    windows=0
    flags+=(-std=c2x -fPIC)
    archive="$out/libdjinn_runtime.a"
    archiver="${DJINN_AR:-$ndk_bin/llvm-ar}"
else
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        windows=1
        flags+=(-std=c17 -fms-runtime-lib=dll)
        archive="$out/djinn_runtime.lib"
        archiver="${DJINN_AR:-llvm-lib}"
        ;;
    *)
        windows=0
        flags+=(-std=c2x -fPIC)
        archive="$out/libdjinn_runtime.a"
        archiver="${DJINN_AR:-llvm-ar}"
        ;;
esac
fi

mkdir -p "$out"
rm -f "$archive"
for name in runtime_all logger; do
    "$clang" "${flags[@]}" "$root/runtime/$name.c" -o "$out/$name.o"
done
"$clang" "${flags[@]}" "$root/runtime/tier.c" -o "$out/tier.o"
"$clang" "${flags[@]}" "$root/runtime/third_party/yyjson/yyjson.c" -o "$out/yyjson.o"
"$clang" "${flags[@]}" "$root/runtime/json/djinn_json.c" -o "$out/djinn_json.o"

if [ "$windows" = 1 ]; then
    "$archiver" "-out:$archive" "$out/runtime_all.o" "$out/logger.o" "$out/yyjson.o" "$out/djinn_json.o" "$out/tier.o"
else
    "$archiver" rcs "$archive" "$out/runtime_all.o" "$out/logger.o" "$out/yyjson.o" "$out/djinn_json.o" "$out/tier.o"
fi
echo "$archive"
