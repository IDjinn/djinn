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
    node tests/web/js/exec.mjs "$out/$name.js" > "$out/$name.web.txt" || fail "$name must run under node"
    diff "$out/$name.native.txt" "$out/$name.web.txt" || fail "$name prints something else on the web"
done

# The macros run on the host whatever the target is; ui itself becomes the bindings in libs/ui/js.
"$compiler" libs/ui_macros -o "$libs/ui_macros.djlib" "${flags[@]}" > "$out/macros.log" 2>&1 \
    || { cat "$out/macros.log"; fail "ui_macros must build"; }
"$compiler" examples/web-app --target web -o "$out/app" --lib-dir "$libs" "${flags[@]}" > "$out/app.log" 2>&1 \
    || { cat "$out/app.log"; fail "examples/web-app must build for the web"; }
cat "$out/app.js" "$out"/djinn.*.js | grep -q "createElement" || fail "the app builds the DOM directly"
if cat "$out/app.js" "$out"/djinn.*.js | grep -q "WebAssembly"; then
    fail "the web target must not use WebAssembly"
fi
node tests/web/js/app.mjs "$out/app.js" || fail "examples/web-app must work in the page"

# the server side needs the native libraries
native_libs="$out/native_libs"
mkdir -p "$native_libs"
cp "$libs/ui_macros.djlib" "$native_libs/"
"$compiler" libs/ui -o "$native_libs/ui.djlib" --lib-dir "$native_libs" "${flags[@]}" > "$out/ui_native.log" 2>&1     || { cat "$out/ui_native.log"; fail "libs/ui must build natively"; }
# [Client] island props: the native build writes them in data-props, the web build builds the islands from them
"$compiler" tests/web/js/island_props -o "$out/props_server$exe" --lib-dir "$native_libs" "${flags[@]}" > "$out/props_server.log" 2>&1     || { cat "$out/props_server.log"; fail "the island props server must build"; }
"$compiler" tests/web/js/island_props --target web -o "$out/props" --lib-dir "$libs" "${flags[@]}" > "$out/props.log" 2>&1     || { cat "$out/props.log"; fail "the island props app must build for the web"; }
"$out/props_server$exe" > "$out/props.html" || fail "the island props server must run"
node tests/web/js/props.mjs "$out/props.js" "$out/props.html" || fail "island props"
# a page the server rendered is adopted by the web build: no element created, [Server] code not shipped
"$compiler" tests/web/js/island_page -o "$out/page_server$exe" --lib-dir "$native_libs" "${flags[@]}" > "$out/page_server.log" 2>&1     || { cat "$out/page_server.log"; fail "the island page server must build"; }
"$compiler" tests/web/js/island_page --target web -o "$out/page" --lib-dir "$libs" "${flags[@]}" > "$out/page.log" 2>&1     || { cat "$out/page.log"; fail "the island page must build for the web"; }
"$out/page_server$exe" > "$out/page.html" || fail "the island page server must run"
node tests/web/js/adopt.mjs "$out/page.js" "$out/page.html" || fail "page adoption"
# a debug build (-g) writes the page indented, and the web build adopts it just the same
"$compiler" tests/web/js/island_page -g -o "$out/page_debug_server$exe" --lib-dir "$native_libs" "${flags[@]}" > "$out/page_debug_server.log" 2>&1     || { cat "$out/page_debug_server.log"; fail "the island page server must build with -g"; }
"$out/page_debug_server$exe" > "$out/page_debug.html" || fail "the debug island page server must run"
node tests/web/js/adopt.mjs "$out/page.js" "$out/page_debug.html" debug || fail "debug page adoption"
# when each island is taken over: load, visible (the default), idle, interaction
"$compiler" tests/web/js/island_load -o "$out/load_server$exe" --lib-dir "$native_libs" "${flags[@]}" > "$out/load_server.log" 2>&1     || { cat "$out/load_server.log"; fail "the island load page server must build"; }
"$compiler" tests/web/js/island_load --target web -o "$out/load" --lib-dir "$libs" "${flags[@]}" > "$out/load.log" 2>&1     || { cat "$out/load.log"; fail "the island load page must build for the web"; }
"$out/load_server$exe" > "$out/load.html" || fail "the island load page server must run"
node tests/web/js/load.mjs "$out/load.js" "$out/load.html" || fail "island load strategies"
# the native server writes the script of the JavaScript islands: a preload of the runtime, the program in the page when
# it is small and a <script src> when it is not, and nothing for a page without islands
"$out/page_server$exe" --program page.js --public "$out" > "$out/page_tags.html" || fail "the page with a program must render"
grep -q '<link rel="modulepreload" href="/djinn\.[0-9a-f]*\.js">' "$out/page_tags.html" || fail "the runtime is preloaded"
grep -q '<script type="module">' "$out/page_tags.html" && grep -q '^import "/djinn\.[0-9a-f]*\.js";' "$out/page_tags.html" || fail "a small program is written into the page"
! grep -q 'data-wasm\|app\.js\|src="/page\.js"' "$out/page_tags.html" || fail "and neither the WebAssembly host nor a second request for the program is asked for"
"$out/load_server$exe" --program load.js --public "$out" > "$out/load_tags.html" || fail "the page with a larger program must render"
grep -q '<script type="module" src="/load\.js"></script>' "$out/load_tags.html" || fail "a larger program is a <script src>"
"$compiler" tests/web/js/island_none -o "$out/none_server$exe" --lib-dir "$native_libs" "${flags[@]}" > "$out/none.log" 2>&1     || { cat "$out/none.log"; fail "the page without islands must build"; }
"$out/none_server$exe" --program page.js --public "$out" > "$out/none.html" || fail "the page without islands must render"
! grep -q '<script\|modulepreload' "$out/none.html" || fail "a page without islands loads no script"
# the runtime is kept for a year (--cache changes it, 0 turns it off) in a release build and never in a debug one
rt=$(grep -o 'djinn\.[0-9a-f]*\.js' "$out/page.js" | head -1)
cache_of() {
    "$1" --serve "$2" --public "$out" "${@:3}" > /dev/null 2>&1 &
    local pid=$!
    sleep 1
    curl -s -D - -o /dev/null "http://127.0.0.1:$2/$rt" | tr -d '\r' | grep -i '^cache-control' | head -1
    kill $pid 2>/dev/null
}
[[ "$(cache_of "$out/page_server$exe" 8231)" == *"max-age=31536000, immutable"* ]] || fail "a release build lets the browser keep the runtime"
[[ "$(cache_of "$out/page_server$exe" 8232 --cache 60)" == *"max-age=60, immutable"* ]] || fail "--cache sets how long"
[[ "$(cache_of "$out/page_server$exe" 8233 --cache 0)" == *"no-store"* ]] || fail "--cache 0 keeps nothing"
[[ "$(cache_of "$out/page_debug_server$exe" 8234)" == *"no-store"* ]] || fail "a debug build never lets the browser keep the runtime"
rt_load=$(grep -o 'djinn\.[0-9a-f]*\.js' "$out/load.js" | head -1)
[[ "$(rt=$rt_load cache_of "$out/load_server$exe" 8235)" == *"max-age=120, immutable"* ]] || fail "static-cache in djinn.proj sets how long"
[[ "$(rt=$rt_load cache_of "$out/load_server$exe" 8236 --cache 5)" == *"max-age=5, immutable"* ]] || fail "--cache wins over the project"
# a prop that cannot be sent to the page is a compile error that names the field
if "$compiler" tests/web/js/island_props_bad -o "$out/props_bad$exe" --lib-dir "$native_libs" "${flags[@]}" > "$out/props_bad.log" 2>&1; then
    fail "a [Client] field of a type that is not serializable must not build"
fi
grep -q "main.djinn:9:9: error.*\[Client\]: a prop is" "$out/props_bad.log" || { cat "$out/props_bad.log"; fail "the error must point at the field"; }

echo "PASS web"
