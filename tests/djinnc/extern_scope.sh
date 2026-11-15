#!/usr/bin/env bash
set -eu
compiler="${1:?usage: extern_scope.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: extern_scope.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/extern_scope"
rm -rf "$out"
mkdir -p "$out/private" "$out/public"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib" --strict-externs)
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

fail() { echo "FAIL extern_scope: $1"; exit 1; }

cat > "$out/private/declares.djinn" <<'SOURCE'
extern "C" {
    i32 abs(i32 value);
}

i32 absolute(i32 value) {
    return abs(value);
}
SOURCE
cat > "$out/private/main.djinn" <<'SOURCE'
i32 main() {
    return absolute(0 - 7) + abs(1);
}
SOURCE
if "$compiler" "$out/private/declares.djinn" "$out/private/main.djinn" -o "$out/private/app$exe" "${flags[@]}" > "$out/private.log" 2>&1; then
    fail "an extern must not be visible from another file"
fi
grep -q "E[0-9]*" "$out/private.log" || { cat "$out/private.log"; fail "expected a diagnostic for the hidden extern"; }

cat > "$out/public/declares.djinn" <<'SOURCE'
public extern "C" {
    i32 abs(i32 value);
}
SOURCE
cat > "$out/public/main.djinn" <<'SOURCE'
extern "C" {
    i32 toupper(i32 value);
}

i32 main() {
    return abs(0 - 7) + toupper(97) - 65;
}
SOURCE
"$compiler" "$out/public/declares.djinn" "$out/public/main.djinn" -o "$out/public/app$exe" "${flags[@]}" > "$out/public.log" 2>&1 || { cat "$out/public.log"; fail "public extern and a local extern must compile"; }
set +e; "$out/public/app$exe"; code=$?; set -e
[ "$code" = 7 ] || fail "program must exit 7, got $code"
mkdir -p "$out/internal"
cat > "$out/internal/declares.djinn" <<'SOURCE'
namespace a;
internal extern "C" {
    i32 abs(i32 value);
}
SOURCE
cat > "$out/internal/same.djinn" <<'SOURCE'
namespace a;
i32 main() {
    return abs(0 - 5);
}
SOURCE
cat > "$out/internal/other.djinn" <<'SOURCE'
namespace b;
i32 other() {
    return abs(0 - 5);
}
SOURCE
"$compiler" "$out/internal/declares.djinn" "$out/internal/same.djinn" -o "$out/internal/app$exe" "${flags[@]}" > "$out/internal.log" 2>&1 || { cat "$out/internal.log"; fail "internal extern must be visible in its namespace"; }
set +e; "$out/internal/app$exe"; code=$?; set -e
[ "$code" = 5 ] || fail "internal program must exit 5, got $code"
if "$compiler" "$out/internal/declares.djinn" "$out/internal/same.djinn" "$out/internal/other.djinn" -o "$out/internal/bad$exe" "${flags[@]}" > "$out/internal_other.log" 2>&1; then
    fail "an internal extern must not be visible from another namespace"
fi
echo "PASS extern_scope"
