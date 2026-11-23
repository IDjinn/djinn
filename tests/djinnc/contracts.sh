#!/usr/bin/env bash
set -eu
compiler="${1:?usage: contracts.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: contracts.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/contracts"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")

fail() { echo "FAIL contracts: $1"; exit 1; }

# 'contracts: observe' in djinn.proj reports the failed clause and goes on.
"$compiler" tests/contracts_project -o "$out/project" --run "${flags[@]}" > "$out/project.log" 2>&1 && status=0 || status=$?
[ "$status" = 42 ] || { cat "$out/project.log"; fail "the observing project must exit with 42, got $status"; }
grep -q "observed: R10013: contract violated: require(x % 2 == 0)" "$out/project.log" || fail "observe must report the clause"

# The command line wins over djinn.proj.
"$compiler" tests/contracts_project -o "$out/ignore" --run --contracts=ignore "${flags[@]}" > "$out/ignore.log" 2>&1 && status=0 || status=$?
[ "$status" = 42 ] || { cat "$out/ignore.log"; fail "--contracts=ignore must exit with 42, got $status"; }
grep -q "observed" "$out/ignore.log" && fail "--contracts=ignore must not report"

# Each library keeps the mode it was built with: lib_observe only reports, also in the generic the consumer instantiates,
# while the consumer, built with check, traps on its own clause.
cat > "$out/lib_observe.djinn" <<'SRC'
namespace observed;

public i64 halve(i64 x) require(x % 2 == 0) {
    return x / 2;
}

public T first<T>(T a, T b) require(a != b) {
    return a;
}
SRC
cat > "$out/app.djinn" <<'SRC'
import observed;

i64 positive(i64 x) require(x > 0) {
    return x;
}

i32 main() {
    i64 sum = observed::halve(3) + observed::first<i64>(4, 4);
    return (i32)positive(sum - 5);
}
SRC
"$compiler" "$out/lib_observe.djinn" --library -o "$out/observed.djlib" --contracts=observe "${flags[@]}" > "$out/lib.log" 2>&1 || { cat "$out/lib.log"; fail "the library must compile"; }
"$compiler" --inspect-lib "$out/observed.djlib" | grep -q "contracts:  observe" || fail "the manifest must record the contracts mode"
"$compiler" "$out/app.djinn" --lib "$out/observed.djlib" -o "$out/app" "${flags[@]}" ${DJINN_USE_LLD:+--lld} > "$out/app.log" 2>&1 || { cat "$out/app.log"; fail "the consumer must compile"; }
grep -q "was built with contracts observe and this project uses check" "$out/app.log" || fail "a weaker library mode must be reported"
"$out/app" > "$out/app_run.log" 2>&1 && status=0 || status=$?
[ "$status" != 0 ] || fail "the consumer clause must trap"
grep -q "observed: R10013: contract violated: require(x % 2 == 0)" "$out/app_run.log" || fail "the library clause must only be observed"
grep -q "observed: R10013: contract violated: require(a != b)" "$out/app_run.log" || fail "the instantiated generic must keep the library mode"
grep -q "panic" "$out/app_run.log" || fail "the consumer clause must panic"
grep -q "require(x > 0)" "$out/app_run.log" || fail "the consumer report must name its clause"

echo "PASS contracts"
