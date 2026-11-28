#!/usr/bin/env bash
set -eu
compiler="${1:?usage: cpu_option.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: cpu_option.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/cpu_option"
rm -rf "$out"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

fail() { echo "FAIL cpu_option: $1"; exit 1; }

cat > "$out/main.djinn" <<'DJINN'
i32 main() {
    return 0;
}
DJINN

if "$compiler" "$out/main.djinn" --cpu bogus-cpu -o "$out/bad$exe" "${flags[@]}" > "$out/bad.log" 2>&1; then
    fail "an unknown --cpu must be rejected"
fi
grep -q "unknown CPU 'bogus-cpu'" "$out/bad.log" || { cat "$out/bad.log"; fail "expected the unknown CPU diagnostic"; }
if grep -q "LLVM ERROR" "$out/bad.log"; then
    cat "$out/bad.log"
    fail "LLVM must not abort on an unknown CPU"
fi

"$compiler" "$out/main.djinn" --cpu x86-64 -o "$out/ok$exe" "${flags[@]}" > "$out/ok.log" 2>&1 || { cat "$out/ok.log"; fail "a listed CPU must compile"; }
"$compiler" "$out/main.djinn" --cpu native -o "$out/native$exe" "${flags[@]}" > "$out/native.log" 2>&1 || { cat "$out/native.log"; fail "--cpu native must compile"; }

echo "PASS cpu_option"
