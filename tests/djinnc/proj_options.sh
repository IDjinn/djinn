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

# The protections are visible in the code on ELF targets (Windows and wasm get none): sspreq/sspstrong call __stack_chk_fail.
case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) echo "skip proj_options: stack protector checks (Windows)" ;;
    *)
        "$compiler" tests/opt_project -o "$out/ssp_off" --emit-asm --harden=off "${flags[@]}" > "$out/ssp_off.log" 2>&1 || { cat "$out/ssp_off.log"; fail "--harden=off --emit-asm must compile"; }
        "$compiler" tests/opt_project -o "$out/ssp_strict" --emit-asm --harden=strict "${flags[@]}" > "$out/ssp_strict.log" 2>&1 || { cat "$out/ssp_strict.log"; fail "--harden=strict --emit-asm must compile"; }
        grep -rq "__stack_chk_fail" "$out"/ssp_strict* || fail "--harden=strict must put a canary in every function"
        grep -rq "__stack_chk_fail" "$out"/ssp_off* && fail "--harden=off must not add stack protectors"
        ;;
esac

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
