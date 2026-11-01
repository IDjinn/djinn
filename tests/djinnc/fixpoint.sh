#!/usr/bin/env bash
set -eu
stage1="${1:?usage: fixpoint.sh <stage1 djinnc> <runtime dir> <llvm lib dir>}"
runtime="${2:?usage: fixpoint.sh <stage1 djinnc> <runtime dir> <llvm lib dir>}"
llvm_lib="${3:?usage: fixpoint.sh <stage1 djinnc> <runtime dir> <llvm lib dir>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$(mktemp -d)"
sources=$(find "$root/djinnc/src" -name '*.djinn' | sort)

"$stage1" $sources -o "$out/stage2" --runtime-dir "$runtime" --link-arg "-L$llvm_lib" --link-arg -lLLVM-C
"$out/stage2" $sources --no-link -o "$out/stage3"

if cmp -s "$out/stage2.ll" "$out/stage3.ll"; then
    echo "PASS fixpoint"
else
    echo "FAIL fixpoint (stage2 and stage3 IR differ)"
    exit 1
fi
