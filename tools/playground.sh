#!/usr/bin/env bash
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
ext=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ext=".exe" ;; esac

compiler="${DJINNC:-}"
if [ -z "$compiler" ]; then
    compiler="$(ls -t "$root/build/bootstrap/stage2/djinnc$ext" "$root/build/bsa/stage2/djinnc$ext" "$root/djinnc/build/djinnc$ext" 2>/dev/null | head -n 1 || true)"
fi
[ -n "$compiler" ] && [ -f "$compiler" ] || { echo "djinnc not found: run tools/bootstrap.sh or set DJINNC" >&2; exit 1; }

runtime="${DJINN_RUNTIME_DIR:-$root/cmake-build-debug-visual-studio/runtime}"
[ -d "$runtime" ] || runtime="$root/runtime"
out="$root/playground/build/playground$ext"
mkdir -p "$root/playground/build"

"$compiler" "$root/playground/main.djinn" -o "$out" --runtime-dir "$runtime" "$@"
"$out"
code=$?
echo "exit code: $code"
exit $code
