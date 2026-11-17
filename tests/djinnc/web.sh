#!/usr/bin/env bash
# The web target (--target web) compiles to JavaScript: every program in tests/web/js/programs is built natively and for
# the web, run natively and under Node.js, and must print the same lines; examples/web-app (html!, signals, components,
# the router) is built for the web and driven on a fake DOM (tests/web/js/app.mjs). Needs node; without it the test
# is skipped.
set -eu
compiler="${1:?usage: web.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: web.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/web"
libs="$out/libs"
rm -rf "$out"
mkdir -p "$out" "$libs"
cd "$root"

fail() { echo "FAIL web: $1"; exit 1; }

if ! command -v node > /dev/null 2>&1; then
    echo "SKIP web (needs node)"
    exit 0
fi

flags=(--std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

for source in tests/web/js/programs/*.djinn; do
    name="$(basename "$source" .djinn)"
    "$compiler" "$source" -o "$out/$name$exe" --std "${flags[@]}" > "$out/$name.native.log" 2>&1 \
        || { cat "$out/$name.native.log"; fail "$name must build natively"; }
    "$compiler" "$source" -o "$out/$name" --std --target web --runtime-dir "$runtime" > "$out/$name.web.log" 2>&1 \
        || { cat "$out/$name.web.log"; fail "$name must build for the web"; }
    "$out/$name$exe" | tr -d '\r' > "$out/$name.native.txt" || fail "$name must run natively"
    node "$out/$name.js" > "$out/$name.web.txt" || fail "$name must run under node"
    diff "$out/$name.native.txt" "$out/$name.web.txt" || fail "$name prints something else on the web"
done

# The macros run on the host whatever the target is; ui itself becomes the bindings in libs/ui/js.
"$compiler" libs/ui_macros -o "$libs/ui_macros.djlib" "${flags[@]}" > "$out/macros.log" 2>&1 \
    || { cat "$out/macros.log"; fail "ui_macros must build"; }
"$compiler" examples/web-app --target web -o "$out/app" --lib-dir "$libs" "${flags[@]}" > "$out/app.log" 2>&1 \
    || { cat "$out/app.log"; fail "examples/web-app must build for the web"; }
grep -q "createElement" "$out/app.js" || fail "the app builds the DOM directly"
if grep -q "WebAssembly" "$out/app.js"; then
    fail "the web target must not use WebAssembly"
fi
node tests/web/js/app.mjs "$out/app.js" || fail "examples/web-app must work in the page"

echo "PASS web"
