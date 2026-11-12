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

cat > "$out/wide.djinn" <<'SOURCE'
extern "C" {
    i32 printf(ptr<i8> format, ...);
}

struct Big {
    i64 a;
    i64 b;
    i64 c;
    i64 d;
}

struct Wide {
    i64 x;
    i64 y;
    i64 z;

    Wide(i64 x) {
        this.x = x;
        this.y = x + 1;
        this.z = x + 2;
    }
}

Big spread(i64 n) {
    Big big = { .a = n, .b = n * 2, .c = n * 3, .d = n * 4 };
    return big;
}

i64 checked(i64 n) throws(Wide) {
    if (n % 97 == 0) {
        throw Wide(n);
    }
    return n * 5;
}

i128 widen(i128 n) {
    return n * 3 + 1;
}

i32 main() {
    mut i64 sum = 0;
    for (mut i64 i = 1; i < 600000; i++) {
        Big big = spread(i);
        sum = sum + big.d - big.a + (try checked(i) ?: 1) + (i64)(widen((i128)i) % 1000);
        sum = sum % 1000000007;
    }
    printf("%lld
", sum);
    return 0;
}
SOURCE

"$compiler" "$out/wide.djinn" --run "${flags[@]}" > "$out/wide_plain.log" 2>&1 || { cat "$out/wide_plain.log"; fail "the plain run with wide results must succeed"; }
"$compiler" "$out/wide.djinn" --run --tiered --tier-threshold=200 --tier-settle=0 "${flags[@]}" > "$out/wide_tiered.log" 2>&1 || { cat "$out/wide_tiered.log"; fail "a tiered function returning an aggregate or a wide scalar must not use musttail"; }
expected="$(grep -E '^[0-9]+$' "$out/wide_plain.log" | tail -1)"
actual="$(grep -E '^[0-9]+$' "$out/wide_tiered.log" | tail -1)"
[ -n "$expected" ] || fail "the plain run with wide results must print a result"
[ "$expected" = "$actual" ] || fail "the tiered wide run printed '$actual', the plain run printed '$expected'"

echo "PASS tiering"
