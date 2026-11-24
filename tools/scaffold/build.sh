#!/usr/bin/env bash
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
djinnc="${1:-${DJINNC:-djinnc}}"
runtime="${2:-$here/../../runtime}"
runtime_lib="${3:?usage: build.sh <djinnc> <runtime dir> <runtime lib>}"
out="$here/build/djinn-scaffold"
extra=()
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) out="$out.exe";; *) extra=(--link-arg -lm);; esac
mkdir -p "$here/build"
"$djinnc" "$here" -o "$out" --runtime-dir "$runtime" --runtime-lib "$runtime_lib" "${extra[@]}"
echo "built $out"
