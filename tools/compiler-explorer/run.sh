#!/usr/bin/env bash
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
ce="${CE_DIR:-$root/build/compiler-explorer}"
[ -d "$ce/node_modules" ] || { echo "run tools/compiler-explorer/setup.sh first" >&2; exit 1; }

export DJINN_STD_DIR="${DJINN_STD_DIR:-$root/std}"
cd "$ce"
exec npm run dev -- --language djinn "$@"
