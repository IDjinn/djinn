#!/usr/bin/env bash
set -eu
compiler="${1:?usage: ui.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: ui.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/ui"
libs="$root/build/unit/libs"
mkdir -p "$out" "$libs"
cd "$root"

fail() { echo "FAIL ui: $1"; exit 1; }

flags=(--lib-dir "$libs" --std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

# The macros (html!, [Application], [Server], [Client], [Static]) are a library of their own: a library cannot run
# its own procedural macros, and the ui library itself uses html!.
"$compiler" libs/ui_macros -o "$libs/ui_macros.djlib" "${flags[@]}" > "$out/macros.log" 2>&1 || { cat "$out/macros.log"; fail "ui_macros must build"; }
"$compiler" libs/ui -o "$libs/ui.djlib" "${flags[@]}" > "$out/ui.log" 2>&1 || { cat "$out/ui.log"; fail "ui must build"; }
"$compiler" test libs/ui -o "$out/ui_tests$exe" "${flags[@]}" > "$out/ui_tests.log" 2>&1 || { cat "$out/ui_tests.log"; fail "ui tests must pass"; }
grep -q " 0 failed" "$out/ui_tests.log" || { cat "$out/ui_tests.log"; fail "ui tests must pass"; }

# The showcase consumes both libraries as .djlib files, like an application would.
"$compiler" examples/ui-showcase -o "$out/showcase$exe" "${flags[@]}" > "$out/showcase.log" 2>&1 || { cat "$out/showcase.log"; fail "the showcase must build"; }
"$out/showcase$exe" > "$out/showcase.html" || fail "the showcase must run"
diff <(tr -d '\r' < examples/ui-showcase/expected.html) <(tr -d '\r' < "$out/showcase.html") || fail "the showcase HTML changed"
"$compiler" test examples/ui-showcase -o "$out/showcase_tests$exe" "${flags[@]}" > "$out/showcase_tests.log" 2>&1 || { cat "$out/showcase_tests.log"; fail "the showcase tests must pass"; }
grep -q " 0 failed" "$out/showcase_tests.log" || { cat "$out/showcase_tests.log"; fail "the showcase tests must pass"; }

echo "PASS ui"
