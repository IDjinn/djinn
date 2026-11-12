#!/usr/bin/env bash
set -eu
compiler="${1:?usage: async_elision.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: async_elision.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/async_elision"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi

fail() { echo "FAIL async_elision: $1"; exit 1; }

exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac
cat > "$out/app.djinn" <<'SOURCE'
async i32 leaf(i32 x) {
    return x + 1;
}

async i32 middle(i32 x) {
    i32 value = await leaf(x);
    return value * 2;
}

i32 main() {
    return await middle(20);
}
SOURCE

for level in -O0 -O2; do
    "$compiler" "$out/app.djinn" $level -o "$out/elided$exe" --keep-ir "${flags[@]}" > "$out/elided.log" 2>&1 || { cat "$out/elided.log"; fail "default build must compile ($level)"; }
    [ "$(grep -c 'warning\[E6004\]' "$out/elided.log")" = 2 ] || { cat "$out/elided.log"; fail "both functions must report E6004 ($level)"; }
    grep -q 'define .*i32 @leaf(' "$out/elided$exe.ll" || fail "leaf must be a plain function ($level)"
    if grep -q 'llvm.coro.id' "$out/elided$exe.ll"; then fail "no coroutine may remain ($level)"; fi
    set +e; "$out/elided$exe"; code=$?; set -e
    [ "$code" = 42 ] || fail "elided program must exit 42, got $code ($level)"

    "$compiler" "$out/app.djinn" $level --no-async-elision -o "$out/kept$exe" --keep-ir "${flags[@]}" > "$out/kept.log" 2>&1 || { cat "$out/kept.log"; fail "--no-async-elision must compile ($level)"; }
    if grep -q 'E6004' "$out/kept.log"; then cat "$out/kept.log"; fail "--no-async-elision must not report E6004 ($level)"; fi
    grep -q 'define .*ptr @leaf(' "$out/kept$exe.ll" || fail "--no-async-elision must keep leaf a coroutine ($level)"
    set +e; "$out/kept$exe"; code=$?; set -e
    [ "$code" = 42 ] || fail "--no-async-elision program must exit 42, got $code ($level)"
done

set +e
"$compiler" "$out/app.djinn" --run "${flags[@]}" > "$out/jit.log" 2>&1; code=$?
set -e
[ "$code" = 42 ] || { cat "$out/jit.log"; fail "--run must exit 42, got $code"; }
grep -q 'E6004' "$out/jit.log" || fail "--run must report E6004"

cat > "$out/tail.djinn" <<'SOURCE'
async bool is_even(i32 n) {
    if (n == 0) {
        return true;
    }
    return await is_odd(n - 1);
}

async bool is_odd(i32 n) {
    if (n == 0) {
        return false;
    }
    return await is_even(n - 1);
}

i32 main() {
    mut i32 hits = 0;
    for (mut i32 round = 0; round < 200; round = round + 1) {
        if (await is_even(3000000 + round)) {
            hits = hits + 1;
        }
    }
    return hits - 58;
}
SOURCE

for mode in "--run" "--run --tiered --tier-threshold=2"; do
    set +e
    "$compiler" "$out/tail.djinn" $mode "${flags[@]}" > "$out/tail.log" 2>&1; code=$?
    set -e
    [ "$code" = 42 ] || { cat "$out/tail.log"; fail "a deep tail-recursive cycle must run in constant stack with $mode, got $code"; }
done

echo "async_elision: ok"
