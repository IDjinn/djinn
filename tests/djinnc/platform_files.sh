#!/usr/bin/env bash
set -eu
compiler="${1:?usage: platform_files.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: platform_files.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/platform_files"
rm -rf "$out"
mkdir -p "$out/src"
cd "$root"

fail() { echo "FAIL platform_files: $1"; exit 1; }

# name.<platform>.djinn replaces name.djinn on that platform; the group (desktop, mobile) and 'native' are fallbacks,
# and variants of other platforms are left out.
printf 'project: "platform_files"\nversion: "0.1.0"\n' > "$out/djinn.proj"
printf 'i32 widget() { return 1; }\n' > "$out/src/widget.djinn"
printf 'i32 widget() { return 2; }\n' > "$out/src/widget.desktop.djinn"
printf 'i32 widget() { return 3; }\n' > "$out/src/widget.web.djinn"
printf 'i32 widget() { return 4; }\n' > "$out/src/widget.android.djinn"
printf 'i32 shell() { return 10; }\n' > "$out/src/shell.djinn"
printf 'i32 shell() { return 20; }\n' > "$out/src/shell.windows.djinn"
printf 'i32 shell() { return 20; }\n' > "$out/src/shell.linux.djinn"
printf 'i32 shell() { return 30; }\n' > "$out/src/shell.native.djinn"
printf 'i32 plain() { return 100; }\n' > "$out/src/plain.djinn"
printf 'i32 main() { return widget() + shell() + plain(); }\n' > "$out/src/main.djinn"

check() {
    local triple="$1" widget="$2" shell="$3"
    "$compiler" "$out" --target "$triple" --emit-ir -o "$out/$triple" --runtime-dir "$runtime" > "$out/$triple.log" 2>&1 \
        || { cat "$out/$triple.log"; fail "$triple must compile"; }
    local ir="$out/$triple.ll"
    [ -f "$ir" ] || ir="$out/$triple"
    grep -A12 'define .*@widget()' "$ir" | grep -q "ret i32 $widget" || fail "$triple must pick widget $widget"
    grep -A12 'define .*@shell()' "$ir" | grep -q "ret i32 $shell" || fail "$triple must pick shell $shell"
}

check x86_64-pc-windows-msvc 2 20
check x86_64-unknown-linux-gnu 2 20
check x86_64-apple-darwin 2 30
check aarch64-linux-android 4 30

echo "PASS platform_files"
