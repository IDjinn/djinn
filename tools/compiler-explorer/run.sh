#!/usr/bin/env bash
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
ce="${CE_DIR:-$root/build/compiler-explorer}"
[ -d "$ce/node_modules" ] || { echo "run tools/compiler-explorer/setup.sh first" >&2; exit 1; }

export DJINN_STD_DIR="${DJINN_STD_DIR:-$root/std}"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        if [ -z "${LIB:-}" ]; then
            msvc="$(ls -d "/c/Program Files/Microsoft Visual Studio/"*/*/VC/Tools/MSVC/* "/c/Program Files (x86)/Microsoft Visual Studio/"*/*/VC/Tools/MSVC/* 2>/dev/null | sort -V | tail -n 1)"
            sdk="$(ls -d "/c/Program Files (x86)/Windows Kits/10/Lib/"*/ 2>/dev/null | sort -V | tail -n 1)"
            if [ -n "$msvc" ] && [ -n "$sdk" ]; then
                export LIB="$(cygpath -w "$msvc/lib/x64");$(cygpath -w "${sdk}ucrt/x64");$(cygpath -w "${sdk}um/x64")"
            fi
        fi
        ;;
esac

cd "$ce"
exec npm run dev -- --language djinn "$@"
