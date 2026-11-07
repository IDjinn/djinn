#!/usr/bin/env bash
set -eu
seed="${1:?usage: unit_ctest.sh <seed djinnc>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit"
mkdir -p "$out"
cd "$root"
bash tools/build_runtime.sh --out "$out/runtime"
runtime_lib="$out/runtime/djinn_runtime.lib"
[ -f "$runtime_lib" ] || runtime_lib="$out/runtime/libdjinn_runtime.a"
flags=(--runtime-dir runtime --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
bash tools/seed_source.sh "$out/seed_src"
"$seed" "$out/seed_src" -o "$out/djinnc_seeded" "${flags[@]}"
"$out/djinnc_seeded" djinnc -o "$out/djinnc" "${flags[@]}"
bash tests/djinnc/unit.sh "$out/djinnc" "$runtime_lib"
