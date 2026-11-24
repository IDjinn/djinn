#!/usr/bin/env bash
set -eu
compiler="${1:?usage: proj_options.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: proj_options.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/proj_options"
mkdir -p "$out"
cd "$root"
flags=(--runtime-dir "$runtime" --runtime-lib "$runtime_lib")

fail() { echo "FAIL proj_options: $1"; exit 1; }
proven() { grep -o "range: [0-9]* checks proven" | grep -o "[0-9]*"; }

# djinn.proj selects optimization: O2 with range-opt: false, so the analysis must not run.
none="$("$compiler" tests/opt_project -o "$out/p" --stats "${flags[@]}" 2>&1 | proven || true)"
[ -z "$none" ] || fail "range-opt: false in djinn.proj must disable the range analysis"
"$compiler" tests/opt_project -o "$out/run" --run "${flags[@]}" > "$out/run.log" 2>&1 && status=0 || status=$?
[ "$status" = 42 ] || { cat "$out/run.log"; fail "the project must exit with 42, got $status"; }

# --harden=on wins over harden: "off"; the command line wins over the project for the other options too.
"$compiler" tests/opt_project -o "$out/hardened" --harden=on "${flags[@]}" > "$out/hardened.log" 2>&1 || { cat "$out/hardened.log"; fail "--harden=on must compile"; }
"$compiler" tests/opt_project -o "$out/o0" -O0 --stats "${flags[@]}" > "$out/o0.log" 2>&1 || { cat "$out/o0.log"; fail "-O0 must compile"; }

for level in off basic standard strict on; do
    "$compiler" tests/opt_project -o "$out/h_$level" --harden=$level "${flags[@]}" > "$out/h_$level.log" 2>&1 || { cat "$out/h_$level.log"; fail "--harden=$level must compile"; }
done
"$compiler" tests/opt_project -o "$out/h_bad" --harden=max "${flags[@]}" > "$out/h_bad.log" 2>&1 && fail "--harden=max must be rejected"
grep -q "unknown hardening level" "$out/h_bad.log" || fail "--harden=max must explain the error"

# The protections are visible in the code (wasm gets none): sspreq/sspstrong call __stack_chk_fail, or __security_check_cookie on Windows.
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) canary="__security_check_cookie" ;;
    *) canary="__stack_chk_fail" ;;
esac
"$compiler" tests/opt_project -o "$out/ssp_off" --emit-asm --harden=off "${flags[@]}" > "$out/ssp_off.log" 2>&1 || { cat "$out/ssp_off.log"; fail "--harden=off --emit-asm must compile"; }
"$compiler" tests/opt_project -o "$out/ssp_strict" --emit-asm --harden=strict "${flags[@]}" > "$out/ssp_strict.log" 2>&1 || { cat "$out/ssp_strict.log"; fail "--harden=strict --emit-asm must compile"; }
grep -rq "$canary" "$out"/ssp_strict* || fail "--harden=strict must put a canary in every function"
grep -rq "$canary" "$out"/ssp_off* && fail "--harden=off must not add stack protectors"

# A library built with another IEEE 754 revision: a conforming project that imports an `ieee754 none` library is warned,
# the other direction and equal modes are silent, two conforming revisions are only informational.
sample="$root/tests/djinnc/library"
for standard in none 2008 2019; do
    "$compiler" "$sample/mathlib.djinn" --library --ieee754=$standard -o "$out/math_$standard.djlib" "${flags[@]}" > "$out/math_$standard.log" 2>&1 || { cat "$out/math_$standard.log"; fail "the $standard library must build"; }
done
cross() { # <library standard> <project standard>
    "$compiler" "$sample/app.djinn" --lib "$out/math_$1.djlib" --ieee754=$2 -o "$out/app_$1_$2" "${flags[@]}" > "$out/app_$1_$2.log" 2>&1 || { cat "$out/app_$1_$2.log"; fail "a $2 project must build against the $1 library"; }
}
cross none 2019
grep -q "built with ieee754 none" "$out/app_none_2019.log" || fail "a 2019 project must be warned about an ieee754 none library"
cross none 2008
grep -q "built with ieee754 none" "$out/app_none_2008.log" || fail "a 2008 project must be warned about an ieee754 none library"
cross none none
grep -q "built with ieee754" "$out/app_none_none.log" && fail "equal modes must not warn"
cross 2019 none
grep -q "built with ieee754" "$out/app_2019_none.log" && fail "a none project using a conforming library must not warn"
cross 2008 2019
grep -q "built with ieee754 none" "$out/app_2008_2019.log" && fail "two conforming revisions must not give the undefined-behavior warning"

# Invalid values are rejected.
bad="$out/bad_project"
rm -rf "$bad"; mkdir -p "$bad/src"; cp tests/opt_project/src/main.djinn "$bad/src/"
printf 'project: "bad"\nversion: "0.1.0"\n\ncompiler:\n  optimization: "O9"\n  libs: []\n' > "$bad/djinn.proj"
"$compiler" "$bad" -o "$out/bad" "${flags[@]}" > "$out/bad.log" 2>&1 && fail "optimization: O9 must be rejected"
grep -q "unknown optimization level" "$out/bad.log" || fail "optimization: O9 must explain the error"
"$compiler" "$bad" -o "$out/bad" -O1 "${flags[@]}" > "$out/bad_cli.log" 2>&1 || { cat "$out/bad_cli.log"; fail "-O1 must win over a bad optimization: value"; }
printf 'project: "bad"\nversion: "0.1.0"\n\ncompiler:\n  harden: "maybe"\n  libs: []\n' > "$bad/djinn.proj"
"$compiler" "$bad" -o "$out/bad" "${flags[@]}" > "$out/bad_harden.log" 2>&1 && fail "harden: maybe must be rejected"
grep -q "unknown harden value" "$out/bad_harden.log" || fail "harden: maybe must explain the error"

echo "PASS proj_options"

# --gc-sections and --sanitize: accepted, validated, and the instrumentation is present in the object.
"$compiler" tests/opt_project -o "$out/gc" --gc-sections "${flags[@]}" > "$out/gc.log" 2>&1 || { cat "$out/gc.log"; fail "--gc-sections must link"; }
"$out/gc" && status=0 || status=$?
[ "$status" = 42 ] || fail "a program linked with --gc-sections must still exit with 42, got $status"

"$compiler" tests/opt_project -o "$out/san_bad" --sanitize=nope "${flags[@]}" > "$out/san_bad.log" 2>&1 && fail "--sanitize=nope must be rejected"
grep -q "unknown sanitizer" "$out/san_bad.log" || fail "--sanitize=nope must explain the error"
"$compiler" tests/opt_project -o "$out/san_both" --sanitize=address,thread "${flags[@]}" > "$out/san_both.log" 2>&1 && fail "address with thread must be rejected"
grep -q "cannot be used together" "$out/san_both.log" || fail "address with thread must explain the error"

"$compiler" tests/opt_project -o "$out/san_address" --sanitize=address "${flags[@]}" > "$out/san_address.log" 2>&1 || { cat "$out/san_address.log"; fail "--sanitize=address must link"; }
"$out/san_address" && status=0 || status=$?
[ "$status" = 42 ] || fail "an address-sanitized program must still exit with 42, got $status"
"$compiler" tests/opt_project -o "$out/san_asm" --emit-asm --sanitize=address "${flags[@]}" > "$out/san_asm.log" 2>&1 || fail "--sanitize=address --emit-asm must compile"
grep -rq "__asan" "$out"/san_asm* || fail "--sanitize=address must instrument the program"
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
        "$compiler" tests/opt_project -o "$out/san_thread" --sanitize=thread "${flags[@]}" > "$out/san_thread.log" 2>&1 && fail "--sanitize=thread must be rejected on Windows"
        grep -q "thread sanitizer is not available on Windows" "$out/san_thread.log" || fail "--sanitize=thread must explain the error on Windows"
        ;;
esac
"$compiler" tests/opt_project -o "$out/san_undefined" --sanitize=undefined "${flags[@]}" > "$out/san_undefined.log" 2>&1 || { cat "$out/san_undefined.log"; fail "--sanitize=undefined must link"; }
"$out/san_undefined" && status=0 || status=$?
[ "$status" = 42 ] || fail "an undefined-sanitized program must still exit with 42, got $status"

# The JIT is hardened like ahead-of-time code (no CFG or ShadowCallStack); --no-jit-harden turns that off.
for extra in "" "--no-jit-harden" "--harden=strict" "--harden=strict --no-jit-harden" "--tiered"; do
    "$compiler" tests/opt_project -o "$out/jit" --run $extra "${flags[@]}" > "$out/jit.log" 2>&1 && status=0 || status=$?
    [ "$status" = 42 ] || { cat "$out/jit.log"; fail "--run $extra must exit with 42, got $status"; }
done
