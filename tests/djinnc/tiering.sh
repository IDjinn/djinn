#!/usr/bin/env bash
set -eu
compiler="${1:?usage: tiering.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: tiering.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/tiering"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")

fail() { echo "FAIL tiering: $1"; exit 1; }

cat > "$out/hot.djinn" <<'SOURCE'
extern "C" {
    i32 printf(ptr<i8> format, ...);
}

i32 classify(i32 value) {
    if (value % 7 == 0) { return value / 7; }
    return value + 1;
}

i32 work(i32 rounds) {
    mut i32 total = 0;
    for (mut i32 i = 0; i < rounds; i++) {
        total = total + classify(i) % 13;
    }
    return total;
}

i32 main() {
    mut i32 sum = 0;
    for (mut i32 r = 0; r < 60; r++) {
        sum = sum + work(400000) % 1000;
    }
    printf("%d\n", sum);
    return 0;
}
SOURCE

"$compiler" "$out/hot.djinn" --run "${flags[@]}" > "$out/plain.log" 2>&1 || { cat "$out/plain.log"; fail "the plain run must succeed"; }
"$compiler" "$out/hot.djinn" --run --tiered --tier-threshold=200 --tier-settle=0 "${flags[@]}" > "$out/tiered.log" 2>&1 || { cat "$out/tiered.log"; fail "the tiered run must succeed"; }

expected="$(grep -E '^[0-9]+$' "$out/plain.log" | tail -1)"
actual="$(grep -E '^[0-9]+$' "$out/tiered.log" | tail -1)"
[ -n "$expected" ] || fail "the plain run must print a result"
[ "$expected" = "$actual" ] || fail "the tiered run printed '$actual', the plain run printed '$expected'"
grep -q "tiering .* branch sites" "$out/tiered.log" || fail "--tiered must prepare the program"
grep -q "tier-1: [0-9]* functions recompiled" "$out/tiered.log" || fail "hot functions must be recompiled into the instrumented tier"
grep -q "tier-2: [0-9]* functions recompiled" "$out/tiered.log" || fail "measured functions must be recompiled with branch weights"

"$compiler" "$out/hot.djinn" --run --tiered --tier-threshold=1000000000 "${flags[@]}" > "$out/cold.log" 2>&1 || { cat "$out/cold.log"; fail "a program that never gets hot must still run"; }
grep -q "tier-1:" "$out/cold.log" && fail "nothing may be recompiled below the threshold"

echo "PASS tiering"
