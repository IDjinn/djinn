#!/usr/bin/env bash
set -eu
compiler="${1:?usage: unit.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: unit.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit"
mkdir -p "$out/libs"
cd "$root"
flags=(--lib-dir "$out/libs" --std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac
bash "$root/tools/build_std.sh" "$compiler" "$out/libs/std.djlib" --runtime-dir "$runtime" --runtime-lib "$runtime_lib" ${DJINN_USE_LLD:+--lld}
"$compiler" libs/testing -o "$out/libs/testing.djlib" "${flags[@]}"
"$compiler" test libs/testing -o "$out/testing_tests$exe" "${flags[@]}"
"$compiler" test djinnc -o "$out/djinnc_tests$exe" "${flags[@]}"
bash tests/djinnc/graph.sh "$compiler" "$runtime_lib" "$runtime"
bash tests/djinnc/ieee754.sh "$compiler" "$runtime_lib" "$runtime"
bash tests/djinnc/jit_panic.sh "$compiler" "$runtime_lib" "$runtime"
bash tests/djinnc/obligations.sh "$compiler" "$runtime_lib" "$runtime"
