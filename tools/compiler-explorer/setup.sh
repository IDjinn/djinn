#!/usr/bin/env bash
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
ce="${CE_DIR:-$root/build/compiler-explorer}"
pinned="${CE_COMMIT:-main}"
ext=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) ext=".exe" ;; esac

if [ ! -d "$ce/.git" ]; then
    git clone https://github.com/compiler-explorer/compiler-explorer "$ce"
fi
git -C "$ce" fetch --quiet origin "$pinned"
git -C "$ce" checkout --quiet --force FETCH_HEAD

node "$here/apply.mjs" "$ce" "$here/files"

compiler="${DJINNC:-}"
if [ -z "$compiler" ]; then
    compiler="$(ls -t "$root/build/bootstrap/stage2/djinnc$ext" "$root/build/bootstrap_run/stage2/djinnc$ext" "$root/build/bsa/stage2/djinnc$ext" "$root/djinnc/build/djinnc$ext" 2>/dev/null | head -n 1 || true)"
fi
[ -n "$compiler" ] && [ -f "$compiler" ] || { echo "djinnc not found: run tools/bootstrap.sh or set DJINNC" >&2; exit 1; }
compiler="$(cd "$(dirname "$compiler")" && pwd -W 2>/dev/null || pwd)/$(basename "$compiler")"
runtime="$(cd "$root/runtime" && pwd -W 2>/dev/null || pwd)"

cat > "$ce/etc/config/djinn.local.properties" <<PROPS
compiler.djinnc.exe=$compiler
compiler.djinnc.options=--runtime-dir $runtime
PROPS

(cd "$ce" && npm install)
echo "ready: tools/compiler-explorer/run.sh"
