#!/usr/bin/env bash
set -eu
compiler="${1:?usage: link_deps.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: link_deps.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/link_deps"
std_libs="$root/build/unit/libs"
rm -rf "$out"
mkdir -p "$out/lib/src" "$out/app/src" "$out/broken/src" "$out/bad_app/src" "$out/libs"
cd "$root"

fail() { echo "FAIL link_deps: $1"; exit 1; }

flags=(--lib-dir "$out/libs" --std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
dependency="-lm"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe"; dependency="-lkernel32" ;; esac
cp "$std_libs"/std.djlib* "$out/libs/" 2>/dev/null || fail "build std.djlib first (tests/djinnc/unit.sh does)"

# A library lists the system libraries it needs in its djinn.proj; the .djlib records them, an importer links them.
printf 'project: "linklib"\nversion: "0.1.0"\n\ncompiler:\n  library-mode: true\n  libs: [\x27std\x27]\n\n  \x27%s\x27\n' "$dependency" > "$out/lib/djinn.proj"
printf 'namespace linklib;\npublic i32 answer() { return 42; }\n' > "$out/lib/src/answer.djinn"
"$compiler" "$out/lib" -o "$out/libs/linklib.djlib" "${flags[@]}" > "$out/lib.log" 2>&1 || { cat "$out/lib.log"; fail "the library must build"; }

"$compiler" --inspect-lib "$out/libs/linklib.djlib" > "$out/inspect.txt" 2>&1 || { cat "$out/inspect.txt"; fail "--inspect-lib must read the library"; }
grep -q "links:.*$dependency" "$out/inspect.txt" || { cat "$out/inspect.txt"; fail "the library must record its link dependency '$dependency'"; }

# An app importing it builds and runs,.
printf 'project: "linkapp"\nversion: "0.1.0"\n\ncompiler:\n  library-mode: false\n  libs: [\x27std\x27, \x27linklib\x27]\n' > "$out/app/djinn.proj"
printf 'import linklib;\ni32 main() { return answer() - 42; }\n' > "$out/app/src/main.djinn"
"$compiler" "$out/app" -o "$out/linkapp$exe" "${flags[@]}" > "$out/app.log" 2>&1 || { cat "$out/app.log"; fail "an app importing the library must link"; }
"$out/linkapp$exe" || fail "the app must run"

# A dependency that names a file that does not exist is rejected when the library is imported.
printf 'project: "brokenlib"\nversion: "0.1.0"\n\ncompiler:\n  library-mode: true\n  libs: [\x27std\x27]\n\n  \x27%s\x27\n' "$out/missing/dir/nothing.lib" > "$out/broken/djinn.proj"
printf 'namespace brokenlib;\npublic i32 one() { return 1; }\n' > "$out/broken/src/one.djinn"
"$compiler" "$out/broken" -o "$out/libs/brokenlib.djlib" "${flags[@]}" > "$out/broken.log" 2>&1 || { cat "$out/broken.log"; fail "the library with a bad dependency still builds"; }
printf 'project: "badapp"\nversion: "0.1.0"\n\ncompiler:\n  library-mode: false\n  libs: [\x27std\x27, \x27brokenlib\x27]\n' > "$out/bad_app/djinn.proj"
printf 'import brokenlib;\ni32 main() { return one() - 1; }\n' > "$out/bad_app/src/main.djinn"
if "$compiler" "$out/bad_app" -o "$out/badapp$exe" "${flags[@]}" > "$out/bad_app.log" 2>&1; then
    cat "$out/bad_app.log"; fail "importing a library whose dependency file is missing must fail"
fi
grep -q "which does not exist" "$out/bad_app.log" || { cat "$out/bad_app.log"; fail "the missing dependency must be named"; }

echo "PASS link_deps"
