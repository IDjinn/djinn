#!/usr/bin/env bash
# examples/showcase is one front end built twice: a native Windows app and a web page (--target web, JavaScript).
# For every route, the tree the native build makes ('showcase.exe --html <route>') must be the same HTML as the DOM
# the web build makes in a page (tests/web/js/showcase.mjs). Windows only (the native side is the win32 host); needs
# node. MSYS_NO_PATHCONV keeps Git Bash from turning the route "/" into a Windows path.
set -eu
compiler="${1:?usage: showcase.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: showcase.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/showcase"
libs="$root/build/unit/libs"
rm -rf "$out"
mkdir -p "$out" "$libs"
cd "$root"

fail() { echo "FAIL showcase: $1"; exit 1; }

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) ;;
    *) echo "SKIP showcase (the native side is the Windows host)"; exit 0 ;;
esac
if ! command -v node > /dev/null 2>&1; then
    echo "SKIP showcase (needs node)"
    exit 0
fi

flags=(--lib-dir "$libs" --std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
[ -f "$libs/std.djlib" ] || bash "$root/tools/build_std.sh" "$compiler" "$libs/std.djlib" --runtime-dir "$runtime" --runtime-lib "$runtime_lib" ${DJINN_USE_LLD:+--lld}
for lib in ui_macros ui spirv vulkan win32; do
    "$compiler" "libs/$lib" -o "$libs/$lib.djlib" "${flags[@]}" > "$out/$lib.log" 2>&1 || { cat "$out/$lib.log"; fail "$lib must build"; }
done
cp libs/vulkan/native/vulkan-1.* "$libs/"

"$compiler" examples/showcase -o "$out/showcase.exe" "${flags[@]}" > "$out/native.log" 2>&1 \
    || { cat "$out/native.log"; fail "the native showcase must build"; }
"$compiler" examples/showcase --target web -o "$out/showcase" "${flags[@]}" > "$out/web.log" 2>&1 \
    || { cat "$out/web.log"; fail "the web showcase must build"; }

for route in / /components /data /routing /routing/settings /routing/users/42; do
    MSYS_NO_PATHCONV=1 "$out/showcase.exe" --html "$route" | tr -d '\r' > "$out/native.html" || fail "the native showcase must render $route"
    MSYS_NO_PATHCONV=1 node tests/web/js/showcase.mjs build/unit/showcase/showcase.js "$route" > "$out/web.html" || fail "the web showcase must render $route"
    grep -q "<main" "$out/native.html" || fail "the native showcase rendered nothing at $route"
    diff "$out/native.html" "$out/web.html" > "$out/diff.txt" || { cat "$out/diff.txt"; fail "$route is not the same tree natively and on the web"; }
done

echo "PASS showcase"
