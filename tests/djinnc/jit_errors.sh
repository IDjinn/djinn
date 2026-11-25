#!/usr/bin/env bash
set -eu
compiler="${1:?usage: jit_errors.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: jit_errors.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/jit_errors"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")

fail() { echo "FAIL jit_errors: $1"; exit 1; }

{
    echo 'extern "C" {'
    for i in $(seq 1 14); do echo "    i32 djinn_missing_$i();"; done
    echo '}'
    echo 'i32 main() {'
    echo '    mut i32 total = 0;'
    for i in $(seq 1 14); do echo "    total = total + djinn_missing_$i();"; done
    echo '    return total;'
    echo '}'
} > "$out/missing.djinn"

# By default the missing symbols are cut at 10 and the cascade is one line.
"$compiler" "$out/missing.djinn" --run "${flags[@]}" > "$out/short.log" 2>&1 && status=0 || status=$?
[ "$status" = 1 ] || { cat "$out/short.log"; fail "a missing symbol under --run must exit with 1, got $status"; }
grep -q "Symbols not found: \[ djinn_missing_.*, \.\.\. and 4 more (--verbose) \]" "$out/short.log" || { cat "$out/short.log"; fail "the missing symbols must be cut at 10"; }
grep -q "cannot find 'main': some symbols could not be compiled (--verbose lists them)" "$out/short.log" || { cat "$out/short.log"; fail "the lookup failure must be one short line"; }
! grep -q "Failed to materialize" "$out/short.log" || { cat "$out/short.log"; fail "the cascade list must be hidden"; }

for flag in --verbose -v; do
    "$compiler" "$out/missing.djinn" --run "$flag" "${flags[@]}" > "$out/verbose.log" 2>&1 && status=0 || status=$?
    [ "$status" = 1 ] || { cat "$out/verbose.log"; fail "$flag must not change the exit code, got $status"; }
    for i in $(seq 1 14); do
        grep -qw "djinn_missing_$i" "$out/verbose.log" || { cat "$out/verbose.log"; fail "$flag must name djinn_missing_$i"; }
    done
    grep -q "Failed to materialize symbols" "$out/verbose.log" || { cat "$out/verbose.log"; fail "$flag must print the whole error"; }
    ! grep -q -- "(--verbose" "$out/verbose.log" || fail "$flag must not suggest itself"
done

echo "PASS jit_errors"
