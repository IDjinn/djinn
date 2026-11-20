#!/usr/bin/env bash
# Android targets: a program is built for aarch64 and x86_64 Android with the NDK and, when an emulator or device is
# connected through adb, run there. Needs the NDK (DJINN_NDK or ANDROID_NDK_HOME); without it the test is skipped.
set -eu
compiler="${1:?usage: android.sh <djinnc> [runtime dir]}"
runtime="${2:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/android"
rm -rf "$out"
mkdir -p "$out"
cd "$root"

fail() { echo "FAIL android: $1"; exit 1; }

export DJINN_NDK="${DJINN_NDK:-${ANDROID_NDK_HOME:-}}"
if [ -z "$DJINN_NDK" ] || [ ! -d "$DJINN_NDK" ]; then
    echo "SKIP android (needs the NDK: DJINN_NDK or ANDROID_NDK_HOME)"
    exit 0
fi

cat > "$out/hello.djinn" <<'SRC'
extern "C" { i32 puts(ptr<i8> s); }
i32 main() { unsafe { puts("hello android"); } return 0; }
SRC

adb_tool="$(command -v adb || true)"
for abi in arm64-v8a x86_64; do
    bash tools/build_runtime.sh --android "$abi" --out "$out/rt-$abi" > /dev/null || fail "runtime for $abi"
    case "$abi" in arm64-v8a) triple=aarch64-linux-android26 ;; x86_64) triple=x86_64-linux-android26 ;; esac
    "$compiler" "$out/hello.djinn" --target "$triple" --runtime-dir "$runtime" --runtime-lib "$out/rt-$abi/libdjinn_runtime.a" \
        -o "$out/hello-$abi" > /dev/null || fail "build for $triple"
    [ -s "$out/hello-$abi" ] || fail "no output for $triple"
    if [ -n "$adb_tool" ] && "$adb_tool" get-state > /dev/null 2>&1 \
        && "$adb_tool" shell getprop ro.product.cpu.abilist | grep -q "$abi"; then
        local_file="$out/hello-$abi"
        if command -v cygpath > /dev/null 2>&1; then local_file="$(cygpath -m "$local_file")"; fi
        MSYS_NO_PATHCONV=1 "$adb_tool" push "$local_file" /data/local/tmp/djinn-hello > /dev/null
        got="$(MSYS_NO_PATHCONV=1 "$adb_tool" shell "chmod +x /data/local/tmp/djinn-hello && /data/local/tmp/djinn-hello" | tr -d '\r')"
        [ "$got" = "hello android" ] || fail "$abi printed '$got'"
        echo "ok android $abi (ran on device)"
    else
        echo "ok android $abi (built, no device)"
    fi
done
