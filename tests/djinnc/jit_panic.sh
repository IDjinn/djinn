#!/usr/bin/env bash
set -eu
compiler="${1:?usage: jit_panic.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: jit_panic.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/jit_panic"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi

fail() { echo "FAIL jit_panic: $1"; exit 1; }

cat > "$out/panic.djinn" <<'SOURCE'
extern "C" {
    i32 puts(ptr<i8> text);
}

unsafe i32 main() {
    puts("before the panic");
    i64 big = 5000000000;
    return (i32)big;
}
SOURCE

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) expected=3 ;;
    *) expected=134 ;;
esac

# A panic under --run ends the program with a plain exit code. The operating system must not see a crash.
"$compiler" "$out/panic.djinn" --run "${flags[@]}" > "$out/jit.log" 2>&1 && status=0 || status=$?
[ "$status" = "$expected" ] || { cat "$out/jit.log"; fail "a panic under --run must exit with $expected, got $status"; }
grep -q "before the panic" "$out/jit.log" || fail "the output written before the panic must be flushed"
grep -q "integer value does not fit in the target type" "$out/jit.log" || fail "the panic report must be printed"

# The panic report is the same for a linked program.
"$compiler" "$out/panic.djinn" -o "$out/linked" "${flags[@]}" > "$out/build.log" 2>&1 || { cat "$out/build.log"; fail "the program must link"; }
"$out/linked" > "$out/linked.log" 2>&1 && status=0 || status=$?
[ "$status" != 0 ] || fail "a linked program must fail on a panic"
grep -q "integer value does not fit in the target type" "$out/linked.log" || fail "the linked panic report must be printed"

echo "PASS jit_panic"
