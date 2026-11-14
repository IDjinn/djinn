#!/usr/bin/env bash
set -eu
compiler="${1:?usage: sync_model.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: sync_model.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/sync_model"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi

fail() { echo "FAIL sync_model: $1"; exit 1; }

exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

# A 'sync main' with nothing async starts no runtime.
cat > "$out/plain.djinn" <<'SOURCE'
sync i32 add(i32 a, i32 b) {
    return a + b;
}

sync i32 main() {
    return add(1, 2);
}
SOURCE
"$compiler" "$out/plain.djinn" -o "$out/plain$exe" --keep-ir "${flags[@]}" > "$out/plain.log" 2>&1 || { cat "$out/plain.log"; fail "sync main must compile"; }
if grep -q 'call .*@__djinn_runtime_init' "$out/plain$exe.ll"; then fail "a sync main without async code must not start the runtime"; fi
set +e; "$out/plain$exe"; code=$?; set -e
[ "$code" = 3 ] || fail "plain sync program must exit 3, got $code"

# '.sync' blocks on a task from a sync function; the runtime is kept because an async function remains.
cat > "$out/block.djinn" <<'SOURCE'
async i32 leaf(i32 x) {
    return x + 1;
}

sync i32 compute() {
    return leaf(20).sync * 2;
}

sync i32 main() {
    return compute();
}
SOURCE
for extra in "--no-async-elision" ""; do
    "$compiler" "$out/block.djinn" $extra -o "$out/block$exe" --keep-ir "${flags[@]}" > "$out/block.log" 2>&1 || { cat "$out/block.log"; fail "'.sync' program must compile ($extra)"; }
    set +e; "$out/block$exe"; code=$?; set -e
    [ "$code" = 42 ] || fail "'.sync' program must exit 42, got $code ($extra)"
done
"$compiler" "$out/block.djinn" --no-async-elision -o "$out/block$exe" --keep-ir "${flags[@]}" > "$out/block.log" 2>&1
grep -q 'call .*@__djinn_runtime_init' "$out/block$exe.ll" || fail "a program with a live async function must start the runtime"

# 'await' is rejected in a 'sync' function; '.sync' inside async code warns.
cat > "$out/bad.djinn" <<'SOURCE'
async i32 leaf(i32 x) {
    return x + 1;
}

sync i32 bad() {
    return await leaf(1);
}

async i32 blocking() {
    return leaf(1).sync;
}

i32 main() {
    return 0;
}
SOURCE
set +e; "$compiler" "$out/bad.djinn" --no-async-elision -o "$out/bad$exe" "${flags[@]}" > "$out/bad.log" 2>&1; code=$?; set -e
[ "$code" != 0 ] || fail "'await' in a sync function must be an error"
grep -q 'error\[E3061\]' "$out/bad.log" || { cat "$out/bad.log"; fail "expected E3061"; }
grep -q 'warning\[E6005\]' "$out/bad.log" || { cat "$out/bad.log"; fail "expected E6005 for '.sync' in an async function"; }

# 'sync' stays an ordinary name elsewhere.
cat > "$out/name.djinn" <<'SOURCE'
struct File {
    i32 handle;

    public i32 sync() {
        return this.handle + 1;
    }
}

i32 main() {
    File f = { .handle = 41 };
    return f.sync();
}
SOURCE
"$compiler" "$out/name.djinn" -o "$out/name$exe" "${flags[@]}" > "$out/name.log" 2>&1 || { cat "$out/name.log"; fail "a method named sync must still compile"; }
set +e; "$out/name$exe"; code=$?; set -e
[ "$code" = 42 ] || fail "method named sync must return 42, got $code"

# 'throws' shares the modifier bits with 'sync': a plain throwing function must not count as sync.
cat > "$out/throws.djinn" <<'SOURCE'
struct Oops {
    i32 code;

    Oops(i32 code) {
        this.code = code;
    }
}

async i32 leaf(i32 x) throws(Oops) {
    if (x > 5) {
        throw Oops(x);
    }
    return x;
}

i32 plain() {
    return try await leaf(9) ?: 30;
}

sync i32 blocked() throws(Oops) {
    return leaf(2).sync;
}

i32 main() {
    i32 ok = try blocked() ?: 100;
    return plain() + ok;
}
SOURCE
"$compiler" "$out/throws.djinn" --no-async-elision -o "$out/throws$exe" "${flags[@]}" > "$out/throws.log" 2>&1 || { cat "$out/throws.log"; fail "throws with sync must compile"; }
set +e; "$out/throws$exe"; code=$?; set -e
[ "$code" = 32 ] || fail "throws program must exit 32, got $code"

# 'private' is enforced: a private method is callable from its own type, a private free function from its namespace.
cat > "$out/private_ok.djinn" <<'SOURCE'
struct Counter {
    i32 value;

    Counter(i32 start) {
        this.value = start;
    }

    private i32 bump() {
        return this.value + 1;
    }

    public i32 next() {
        return this.bump();
    }
}

private i32 twice(i32 x) {
    return x * 2;
}

i32 main() {
    Counter counter = Counter(20);
    return twice(counter.next());
}
SOURCE
"$compiler" "$out/private_ok.djinn" -o "$out/private_ok$exe" "${flags[@]}" > "$out/private_ok.log" 2>&1 || { cat "$out/private_ok.log"; fail "private use inside its type and namespace must compile"; }
set +e; "$out/private_ok$exe"; code=$?; set -e
[ "$code" = 42 ] || fail "private program must exit 42, got $code"

rm -rf "$out/private_bad"; mkdir -p "$out/private_bad"
cat > "$out/private_bad/lib.djinn" <<'SOURCE'
namespace hidden;

private i32 secret() {
    return 7;
}

i32 shown() {
    return secret();
}
SOURCE
cat > "$out/private_bad/main.djinn" <<'SOURCE'
namespace app;

import hidden;

i32 main() {
    return secret() + shown();
}
SOURCE
if "$compiler" "$out/private_bad/lib.djinn" "$out/private_bad/main.djinn" -o "$out/private_bad$exe" "${flags[@]}" > "$out/private_bad.log" 2>&1; then fail "calling a private function from another namespace must fail"; fi
grep -q "E3062" "$out/private_bad.log" || { cat "$out/private_bad.log"; fail "private access must report E3062"; }

echo "sync_model: ok"
