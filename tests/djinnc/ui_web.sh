#!/usr/bin/env bash
# libs/ui on the web: the libraries are built for the host (ui_macros runs there, ui renders the server's HTML) and for
# the web (<lib-dir>/wasm32-unknown-unknown/ui.djlib), then tests/web/ui runs under Node.js on a small DOM:
#   client    a page built in the browser (events, fields, router, unsafe URLs)
#   hydrate   the native build writes the page, the web build adopts it without creating a node
#   islands   a server page where only the [Client] island is adopted
# Needs wasm-ld and node; without them the test is skipped.
set -eu
compiler="${1:?usage: ui_web.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: ui_web.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/ui_web"
libs="$out/libs"
web_libs="$libs/wasm32-unknown-unknown"
rm -rf "$out"
mkdir -p "$web_libs"
cd "$root"

fail() { echo "FAIL ui_web: $1"; exit 1; }

wasm_ld="${DJINN_WASM_LD:-wasm-ld}"
if ! command -v "$wasm_ld" > /dev/null 2>&1 || ! command -v node > /dev/null 2>&1; then
    echo "SKIP ui_web (needs $wasm_ld and node)"
    exit 0
fi

flags=(--lib-dir "$libs" --std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
native_flags=("${flags[@]}")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    native_flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

build() {
    local log="$out/$1.log"
    shift
    "$compiler" "$@" > "$log" 2>&1 || { cat "$log"; fail "$(basename "$log" .log) must build"; }
}

build macros libs/ui_macros -o "$libs/ui_macros.djlib" "${native_flags[@]}"
build ui-native libs/ui -o "$libs/ui.djlib" "${native_flags[@]}"
build ui-web libs/ui -o "$web_libs/ui.djlib" "${flags[@]}" --target web

for app in client hydrate islands; do
    mkdir -p "$out/$app"
    build "$app-web" "tests/web/ui/$app" -o "$out/$app/app.wasm" "${flags[@]}" --target web
done
mkdir -p "$out/example/public"
build example-web examples/ui-web -o "$out/example/public/app.wasm" "${flags[@]}" --target web
build example-native examples/ui-web -o "$out/example/server$exe" "${native_flags[@]}"
for app in hydrate islands; do
    build "$app-native" "tests/web/ui/$app" -o "$out/$app/server$exe" "${native_flags[@]}"
    "$out/$app/server$exe" > "$out/$app/index.html" || fail "the $app server must run"
done

# the static site: "/" and every page its links reach
(cd "$out/example" && "./server$exe" --out site > ssg.log 2>&1) || { cat "$out/example/ssg.log"; fail "the static site must be written"; }
for page in index.html todos/index.html about/index.html; do
    [ -f "$out/example/site/$page" ] || fail "the static site must have $page"
done
grep -q 'Built natively' "$out/example/site/about/index.html" || fail "a [Server] part is in the static page"

node tests/web/ui/client.mjs "$out/client/app.wasm" || fail "client"
node tests/web/ui/hydrate.mjs "$out/hydrate/index.html" "$out/hydrate/app.wasm" hydrate || fail "hydrate"
node tests/web/ui/hydrate.mjs "$out/islands/index.html" "$out/islands/app.wasm" islands || fail "islands"

node tests/web/ui/example.mjs "$out/example/site/index.html" "$out/example/public/app.wasm" || fail "example"

echo "PASS ui_web"
