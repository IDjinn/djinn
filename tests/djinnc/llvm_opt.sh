#!/usr/bin/env bash
set -eu
compiler="${1:?usage: llvm_opt.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: llvm_opt.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/llvm_opt"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi

fail() { echo "FAIL llvm_opt: $1"; exit 1; }

exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac
cat > "$out/app.djinn" <<'SOURCE'
extern "C" {
    i32 printf(ptr<i8> format, ...);
}

[NonNull]
i32* identity(i32* value) {
    return value;
}

i32 hidden_helper(i32 x) {
    return x * 3 + 1;
}

[Export]
i32 exported_helper(i32 x) {
    return x + 7;
}

i32 main() {
    mut i32 sum = 0;
    [Unroll(4)]
    for (mut i32 i = 0; i < 8; i++) { sum = sum + i; }
    [NoVectorize]
    for (mut i32 i = 0; i < 8; i++) { sum = sum + i; }
    i32 value = 5;
    i32* same = identity(&value);
    printf("%d\n", hidden_helper(*same));
    return 0;
}
SOURCE

"$compiler" "$out/app.djinn" -O2 -o "$out/app$exe" --keep-ir "${flags[@]}" > "$out/app.log" 2>&1 || { cat "$out/app.log"; fail "the program must compile"; }
[ "$("$out/app$exe")" = "16" ] || fail "the program must print 16"

grep -Eq "define [^@]*nonnull[^@]* @identity" "$out/app$exe.ll" || fail "[NonNull] on a pointer function must mark its return value nonnull"

symbols="$(llvm-nm "$out/app$exe.obj")"
grep -q '!"llvm.loop.unroll.count", i32 4' "$out/app$exe.ll" || fail "[Unroll(n)] must emit llvm.loop.unroll.count"
grep -q '!"llvm.loop.vectorize.enable", i1 false' "$out/app$exe.ll" || fail "[NoVectorize] must emit llvm.loop.vectorize.enable false"

echo "$symbols" | grep -q " T main" || fail "main must stay exported"
echo "$symbols" | grep -q " T exported_helper" || fail "[Export] must keep a function external"
if echo "$symbols" | grep -q "hidden_helper"; then
    fail "a function nobody references must be internalized and removed"
fi


cat > "$out/inl_lib.djinn" <<'SOURCE'
namespace inlib;

public i32 triple(i32 x) {
    return x * 3 + 1;
}

public i32 clamp_low(i32 x, i32 low) {
    if (x < low) {
        return low;
    }
    return x;
}
SOURCE
cat > "$out/inl_app.djinn" <<'SOURCE'
i32 main() {
    return inlib::triple(inlib::clamp_low(4, 1)) - 13;
}
SOURCE
"$compiler" "$out/inl_lib.djinn" --library -O2 -o "$out/inlib.djlib" "${flags[@]}" > "$out/inl_lib.log" 2>&1 || { cat "$out/inl_lib.log"; fail "the library must build"; }
"$compiler" --inspect-lib "$out/inlib.djlib" | grep -q "bitcode:" || fail "an optimized library must carry a bitcode section"
"$compiler" "$out/inl_app.djinn" --lib "$out/inlib.djlib" -O2 -o "$out/inl_app$exe" "${flags[@]}" > "$out/inl_app.log" 2>&1 || { cat "$out/inl_app.log"; fail "the consumer must build"; }
"$out/inl_app$exe" || fail "the consumer must return 0"
if llvm-nm "$out/inl_app$exe.obj" | grep -q "inlib"; then
    fail "small library functions must be inlined into the consumer"
fi
"$compiler" "$out/inl_lib.djinn" --library -o "$out/inlib_o0.djlib" "${flags[@]}" > /dev/null 2>&1
"$compiler" --inspect-lib "$out/inlib_o0.djlib" | grep -q "bitcode:" && fail "an unoptimized library must not carry bitcode"
echo "PASS llvm_opt"
