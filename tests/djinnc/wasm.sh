#!/usr/bin/env bash
# The WebAssembly target (--target wasm, an add-on next to the JavaScript web target): every program in
# tests/web/programs is built for the host and for wasm32, run natively and under Node.js (tests/web/run.mjs), and must
# print the same output and end the same way (a panic ends both with a failure). Needs wasm-ld and node; without them the test is skipped.
set -eu
compiler="${1:?usage: wasm.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: wasm.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/wasm"
rm -rf "$out"
mkdir -p "$out"
cd "$root"

fail() { echo "FAIL wasm: $1"; exit 1; }

wasm_ld="${DJINN_WASM_LD:-wasm-ld}"
if ! command -v "$wasm_ld" > /dev/null 2>&1 || ! command -v node > /dev/null 2>&1; then
    echo "SKIP wasm (needs $wasm_ld and node)"
    exit 0
fi

native_flags=(--std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    native_flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

for source in tests/web/programs/*.djinn; do
    name="$(basename "$source" .djinn)"
    "$compiler" "$source" -o "$out/$name$exe" "${native_flags[@]}" > "$out/$name.native.log" 2>&1 \
        || { cat "$out/$name.native.log"; fail "$name must build for the host"; }
    "$compiler" "$source" -o "$out/$name.wasm" --target wasm --std-dir "$root/std" --runtime-dir "$runtime" > "$out/$name.web.log" 2>&1 \
        || { cat "$out/$name.web.log"; fail "$name must build for the web"; }
    [ -f "$out/djinn.js" ] || fail "djinn.js must be copied next to $name.wasm"

    set +e
    "$out/$name$exe" > "$out/$name.native.out" 2> /dev/null
    native_status=$?
    node tests/web/run.mjs "$out/$name.wasm" > "$out/$name.web.out" 2> "$out/$name.web.err"
    web_status=$?
    set -e

    diff <(tr -d '\r' < "$out/$name.native.out") <(tr -d '\r' < "$out/$name.web.out") > "$out/$name.diff" \
        || { cat "$out/$name.diff"; cat "$out/$name.web.err"; fail "$name prints something else on the web"; }
    if [ "$native_status" -lt 100 ] || [ "$web_status" -lt 100 ]; then
        [ "$native_status" = "$web_status" ] || { cat "$out/$name.web.err"; fail "$name exits with $web_status on the web, $native_status natively"; }
    fi
done

echo "PASS wasm"
