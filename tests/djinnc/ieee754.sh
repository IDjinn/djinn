#!/usr/bin/env bash
set -eu
compiler="${1:?usage: ieee754.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: ieee754.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/ieee754"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")

fail() { echo "FAIL ieee754: $1"; exit 1; }

# djinn.proj selects ieee754: 2008 and fp-env: strict.
"$compiler" tests/ieee754_project -o "$out/project" --emit-ir "${flags[@]}" > "$out/project.log" 2>&1 || { cat "$out/project.log"; fail "the project must compile"; }
grep -q "llvm.experimental.constrained.minnum" "$out/project.ll" || fail "ieee754: 2008 in djinn.proj must lower min to minNum"
grep -q "llvm.experimental.constrained.fdiv" "$out/project.ll" || fail "fp-env: strict in djinn.proj must constrain fdiv"

# Command-line options win over djinn.proj.
"$compiler" tests/ieee754_project -o "$out/override" --emit-ir --ieee754=2019 --fp-env=default "${flags[@]}" > "$out/override.log" 2>&1 || { cat "$out/override.log"; fail "the override must compile"; }
grep -q "llvm.minimumnum" "$out/override.ll" || fail "--ieee754=2019 must win over djinn.proj"
grep -q "constrained" "$out/override.ll" && fail "--fp-env=default must win over djinn.proj"

"$compiler" tests/ieee754_project -o "$out/run" --run "${flags[@]}" > "$out/run.log" 2>&1 && status=0 || status=$?
[ "$status" = 42 ] || { cat "$out/run.log"; fail "the project must exit with 42, got $status"; }

# Invalid values are rejected.
"$compiler" tests/ieee754_project -o "$out/bad" --ieee754=2077 "${flags[@]}" > "$out/bad.log" 2>&1 && fail "--ieee754=2077 must be rejected"
grep -q "unknown IEEE 754 revision" "$out/bad.log" || fail "--ieee754=2077 must explain the error"
"$compiler" tests/ieee754_project -o "$out/bad" --ieee754=none --fp-env=strict "${flags[@]}" > "$out/conflict.log" 2>&1 && fail "none with strict must be rejected"
grep -q "needs an IEEE 754 revision" "$out/conflict.log" || fail "none with strict must explain the error"

echo "PASS ieee754"
