#!/usr/bin/env bash
set -eu
stage1="${1:?usage: fixpoint.sh <stage1 djinnc> <runtime dir> [runtime lib]}"
runtime="${2:?usage: fixpoint.sh <stage1 djinnc> <runtime dir> [runtime lib]}"
runtime_lib="${3:-}"
link_flags=()
if [ -n "$runtime_lib" ]; then
    link_flags+=(--runtime-lib "$runtime_lib")
    if [ -n "${DJINN_USE_LLD:-}" ]; then
        link_flags+=(--lld)
    fi
fi
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$(mktemp -d)"

"$stage1" "$root/djinnc" -o "$out/stage2" -O2 --runtime-dir "$runtime" ${link_flags[@]+"${link_flags[@]}"} --keep-ir
"$out/stage2" "$root/djinnc" --no-link -O2 -o "$out/stage3"

if cmp -s "$out/stage2.ll" "$out/stage3.ll"; then
    echo "PASS fixpoint"
else
    echo "FAIL fixpoint (stage2 and stage3 IR differ)"
    exit 1
fi
