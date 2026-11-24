#!/usr/bin/env bash
set -eu
compiler="${1:?usage: scaffold.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: scaffold.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
work="$root/build/scaffold_test"
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac
rm -rf "$work"
mkdir -p "$work/bin" "$work/project"
cd "$root"
bash tools/scaffold/build.sh "$compiler" "$runtime" "$runtime_lib" >/dev/null
cp "$compiler" "$work/bin/djinnc$exe"
cp "tools/scaffold/build/djinn-scaffold$exe" "$work/bin/"
tool="$work/bin/djinnc$exe"
cd "$work/project"

fail() { echo "FAIL $1"; exit 1; }

"$tool" new app --target=executable </dev/null >/dev/null || fail "new executable"
[ -f app/djinn.proj ] && [ -f app/src/main.djinn ] || fail "new executable writes djinn.proj and src/main.djinn"
grep -q "library-mode: false" app/djinn.proj || fail "executable project is not a library"
"$tool" new lib --target=library </dev/null >/dev/null || fail "new library"
grep -q "library-mode: true" lib/djinn.proj || fail "library project sets library-mode"
"$tool" new site --target=web </dev/null >/dev/null || fail "new web"
grep -q "targets: \[web\]" site/djinn.proj && [ -f site/index.html ] || fail "web project has targets and index.html"
if "$tool" new app --target=executable </dev/null >/dev/null 2>&1; then fail "new refuses an existing project"; fi
if "$tool" new x --target=nope </dev/null >/dev/null 2>&1; then fail "new rejects an unknown target"; fi

"$tool" doctor app --target=executable </dev/null >/dev/null || fail "doctor accepts a fresh executable project"
if "$tool" doctor app --target=library </dev/null >/dev/null; then fail "doctor flags an executable project checked as a library"; fi
if "$tool" doctor app --target=web </dev/null >/dev/null; then fail "doctor flags missing web libs"; fi
mkdir bare
"$tool" doctor bare </dev/null >/dev/null || fail "doctor accepts a folder without djinn.proj"

mkdir init_dir2
"$tool" init init_dir2 --target=executable --name named --yes </dev/null >/dev/null || fail "init"
grep -q 'project: "named"' init_dir2/djinn.proj || fail "init writes the project name"

mkdir -p app/build
"$compiler" app -o app/build/app$exe --std-dir "$root/std" --runtime-dir "$root/$runtime" --runtime-lib "$runtime_lib" ${DJINN_USE_LLD:+--lld} >/dev/null || fail "the generated executable project builds"
[ "$(./app/build/app$exe | tr -d '\033' | grep -c 'hello from app')" = "1" ] || fail "the generated program runs"
echo "scaffold: ok"
