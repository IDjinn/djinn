#!/usr/bin/env bash
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
djinnc="${1:-${DJINNC:-djinnc}}"
runtime="${2:-$here/../runtime}"
mkdir -p "$here/build"
out="$here/build/djinn-lsp"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) out="$out.exe";; esac
"$djinnc" "$here" -o "$out" --runtime-dir "$runtime"
echo "built $out"
