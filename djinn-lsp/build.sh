#!/usr/bin/env bash
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
djinnc="${1:-${DJINNC:-djinnc}}"
runtime="${2:-$here/../runtime}"
clang="${DJINN_CLANG:-clang}"
mkdir -p "$here/build/runtime"
out="$here/build/djinn-lsp"
lib="$here/build/runtime/libdjinn_runtime.a"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) out="$out.exe"; lib="$here/build/runtime/djinn_runtime.lib";; esac
sources="djinn_runtime scheduler io_file io_socket diagnostics threads console filesystem process int128 logger third_party/yyjson/yyjson json/djinn_json"
objects=()
for source in $sources; do
    object="$here/build/runtime/$(basename "$source").o"
    "$clang" -c -O2 -I "$runtime" "$runtime/$source.c" -o "$object"
    objects+=("$object")
done
rm -f "$lib"
llvm-ar rcs "$lib" "${objects[@]}" 2>/dev/null || ar rcs "$lib" "${objects[@]}"
"$djinnc" "$here" -o "$out" --runtime-dir "$runtime" --runtime-lib "$lib"
echo "built $out"
