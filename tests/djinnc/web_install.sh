#!/usr/bin/env bash
# An installed djinnc (bin, lib, runtime, std and the web bindings tools/package_web_libs.sh stages) builds a ui project
# for the web from the project folder, with nothing of the checkout on the command line but the macro library. Without
# the bindings the build fails and names the library that has none.
set -eu
compiler="${1:?usage: web_install.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: web_install.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/web_install"
libs="$out/libs"
install="$out/install"
project="$out/project"
rm -rf "$out"
mkdir -p "$libs" "$install/bin" "$install/lib" "$project"
cd "$root"

fail() { echo "FAIL web_install: $1"; exit 1; }

flags=(--std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

for lib in ui_macros ui; do
    "$compiler" "libs/$lib" -o "$libs/$lib.djlib" --lib-dir "$libs" "${flags[@]}" > "$out/$lib.log" 2>&1 \
        || { cat "$out/$lib.log"; fail "$lib must build"; }
done

cp "$compiler" "$install/bin/djinnc$exe"
cp "$runtime_lib" "$install/lib/$(basename "$runtime_lib")"
cp -r "$runtime" "$install/runtime"
cp -r std "$install/std"
bash tools/package_web_libs.sh "$install"
cp -r examples/web-app/djinn.proj examples/web-app/src "$project/"
cd "$project"

build() {
    "$install/bin/djinnc$exe" . --target web --lib-dir "$libs" > "$out/$1.log" 2>&1
}

build installed || { cat "$out/installed.log"; fail "the installed compiler must build a ui project for the web"; }
[ -f build/app.js ] || fail "no program was written"

rm -rf "$install/libs"
if build unbound; then
    fail "without the bindings the build must fail"
fi
grep -q "E3001" "$out/unbound.log" || { cat "$out/unbound.log"; fail "the ui types are unknown without the bindings"; }
grep -q "note: only the macros of .*ui.* are available on the web" "$out/unbound.log" \
    || { cat "$out/unbound.log"; fail "the compiler must name the libraries without bindings"; }

echo "PASS web_install"
