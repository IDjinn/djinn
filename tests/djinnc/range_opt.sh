#!/usr/bin/env bash
set -eu
compiler="${1:?usage: range_opt.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: range_opt.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/range_opt"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi

fail() { echo "FAIL range_opt: $1"; exit 1; }

exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac
cat > "$out/app.djinn" <<'SOURCE'
extern "C" {
    i32 printf(ptr<i8> format, ...);
}

[Export]
[NoInline]
i32 widened(u8 a, u8 b) { return (i32)a + (i32)b; }

[Export]
[NoInline]
i32 masked(i32 x) { return (x & 255) * 3; }

[Export]
[NoInline]
i32 guarded(i32 n) {
    if (n < 100 && n > 0 - 100) { return n + 1; }
    return 0;
}

[Export]
[NoInline]
i32 divide(i32 a) {
    i32 d = 7;
    return a / d;
}

[Export]
[NoInline]
i32 unknown(i32 a, i32 b) { return a + b; }

[Export]
[NoInline]
i32 unknown_divide(i32 a, i32 b) { return a / b; }

i32 main() {
    printf("%d %d %d %d %d %d\n", widened(200, 100), masked(1000), guarded(5), divide(50), unknown(1, 2), unknown_divide(9, 3));
    return 0;
}
SOURCE

body() { awk "/^define .*@$2\(/,/^}/" "$1"; }

"$compiler" "$out/app.djinn" -O1 -o "$out/app$exe" --keep-ir "${flags[@]}" > "$out/app.log" 2>&1 || { cat "$out/app.log"; fail "the program must compile"; }
[ "$("$out/app$exe")" = "300 696 6 7 3 3" ] || fail "the program must print the unoptimized results"

for name in widened masked guarded divide; do
    if body "$out/app$exe.ll" "$name" | grep -Eq "with.overflow|__djinn_panic"; then
        fail "$name is provably safe and must carry no check"
    fi
done
body "$out/app$exe.ll" unknown | grep -q "with.overflow" || fail "an unconstrained addition must keep its overflow check"
body "$out/app$exe.ll" unknown_divide | grep -q "__djinn_panic" || fail "an unknown divisor must keep its zero check"

"$compiler" "$out/app.djinn" -O1 --no-range-opt -o "$out/plain$exe" --keep-ir "${flags[@]}" > "$out/plain.log" 2>&1 || { cat "$out/plain.log"; fail "--no-range-opt must compile"; }
[ "$("$out/plain$exe")" = "300 696 6 7 3 3" ] || fail "--no-range-opt must print the same results"
for name in widened masked guarded divide; do
    body "$out/plain$exe.ll" "$name" | grep -Eq "with.overflow|__djinn_panic" || fail "$name must keep its checks without the range analysis"
done

proven() { grep -o "range: [0-9]* checks proven" | grep -o "[0-9]*"; }
aot="$("$compiler" "$out/app.djinn" -O1 --stats -o "$out/stats$exe" "${flags[@]}" 2>&1 | proven)"
[ -n "$aot" ] && [ "$aot" -gt 0 ] || fail "--stats must report the checks proven for an ahead-of-time build"
none="$("$compiler" "$out/app.djinn" -O1 --no-range-opt --stats -o "$out/stats$exe" "${flags[@]}" 2>&1 | proven || true)"
[ -z "$none" ] || fail "--no-range-opt must not run the analysis"
o0="$("$compiler" "$out/app.djinn" -O0 --stats -o "$out/stats$exe" "${flags[@]}" 2>&1 | proven || true)"
[ -z "$o0" ] || fail "-O0 must keep every check"

jit="$("$compiler" "$out/app.djinn" -O1 --run --stats "${flags[@]}" 2>&1 | proven)"
[ "$jit" = "$aot" ] || fail "the JIT must prove the same checks as the ahead-of-time build ($jit vs $aot)"
tiered="$("$compiler" "$out/app.djinn" -O1 --run --tiered --stats "${flags[@]}" 2>&1 | proven)"
[ "$tiered" = "$aot" ] || fail "the tiered JIT must prove the same checks ($tiered vs $aot)"
"$compiler" "$out/app.djinn" -O1 --run "${flags[@]}" 2>&1 | grep -q "^300 696 6 7 3 3$" || fail "the JIT must print the same results"

echo "PASS range_opt"
