#!/usr/bin/env bash
set -eu

usage() {
    echo "usage: bootstrap.sh --stage0 <djinn executable> --runtime-dir <dir> [--runtime-lib <lib>] [--lld] [--out <dir>]"
    echo "                    [--bench-ref <file>] [--update-ref]"
    exit 2
}

root="$(cd "$(dirname "$0")/.." && pwd)"
stage0=""
runtime=""
runtime_lib=""
use_lld=0
out="$root/build/bootstrap"
bench_ref="$root/tools/bench.reference.json"
update_ref=0

while [ $# -gt 0 ]; do
    case "$1" in
        --stage0) stage0="$2"; shift 2 ;;
        --runtime-dir) runtime="$2"; shift 2 ;;
        --runtime-lib) runtime_lib="$2"; shift 2 ;;
        --lld) use_lld=1; shift ;;
        --out) out="$2"; shift 2 ;;
        --bench-ref) bench_ref="$2"; shift 2 ;;
        --update-ref) update_ref=1; shift ;;
        *) usage ;;
    esac
done
[ -n "$stage0" ] && [ -n "$runtime" ] || usage

ext=""
case "$stage0" in *.exe) ext=".exe" ;; esac

link_flags=()
if [ -n "$runtime_lib" ]; then
    link_flags+=(--runtime-lib "$runtime_lib")
    [ "$use_lld" = 1 ] && link_flags+=(--lld)
fi

now_ms() { echo $(( $(date +%s%N) / 1000000 )); }

rm -rf "$out"
mkdir -p "$out/stage1" "$out/stage2" "$out/stage3" "$out/samples"
cd "$root"

echo "== stage0 -> stage1"
"$stage0" -r djinnc >"$out/stage1.log" 2>&1 || true
[ -f "djinnc/build/djinnc$ext" ] || { echo "FAIL stage1 not produced (see $out/stage1.log)"; exit 1; }
cp "djinnc/build/djinnc$ext" "$out/stage1/djinnc$ext"

echo "== stage1 -> stage2"
"$out/stage1/djinnc$ext" djinnc -o "$out/stage2/djinnc$ext" --runtime-dir "$runtime" ${link_flags[@]+"${link_flags[@]}"} --keep-ir

echo "== stage2 -> stage3"
"$out/stage2/djinnc$ext" djinnc -o "$out/stage3/djinnc$ext" --runtime-dir "$runtime" ${link_flags[@]+"${link_flags[@]}"} --keep-ir

echo "== fixpoint"
if cmp -s "$out/stage2/djinnc$ext.ll" "$out/stage3/djinnc$ext.ll"; then
    echo "PASS fixpoint"
else
    echo "FAIL fixpoint (stage2 and stage3 IR differ)"
    diff "$out/stage2/djinnc$ext.ll" "$out/stage3/djinnc$ext.ll" | head -20 || true
    exit 1
fi

echo "== samples on stage1, stage2 and stage3"
failed=0
for source in "$root"/tests/djinnc/samples/*.djinn; do
    name="$(basename "$source" .djinn)"
    expected="$(cat "$root/tests/djinnc/samples/$name.exit")"
    expected_stdout="$root/tests/djinnc/samples/$name.stdout"
    reference=""
    for stage in stage1 stage2 stage3; do
        binary="$out/samples/$name.$stage$ext"
        if ! "$out/$stage/djinnc$ext" "$source" -o "$binary" --runtime-dir "$runtime" ${link_flags[@]+"${link_flags[@]}"} >"$out/samples/$name.$stage.log" 2>&1; then
            echo "FAIL $name ($stage compile)"
            failed=1
            continue
        fi
        set +e
        "$binary" >"$out/samples/$name.$stage.stdout"
        code=$?
        set -e
        tr -d '\r' <"$out/samples/$name.$stage.stdout" >"$out/samples/$name.$stage.stdout.lf"
        result="$code:$(cat "$out/samples/$name.$stage.stdout.lf")"
        if [ "$code" != "$expected" ]; then
            echo "FAIL $name ($stage exit $code, expected $expected)"
            failed=1
        elif [ -f "$expected_stdout" ] && ! cmp -s "$out/samples/$name.$stage.stdout.lf" "$expected_stdout"; then
            echo "FAIL $name ($stage stdout differs from $name.stdout)"
            failed=1
        elif [ -n "$reference" ] && [ "$result" != "$reference" ]; then
            echo "FAIL $name ($stage disagrees with stage1)"
            failed=1
        fi
        [ -z "$reference" ] && reference="$result"
    done
    echo "done $name"
done
[ "$failed" = 0 ] || exit 1

echo "== benchmark (stage2 compiling djinnc, best of 3)"
best=0
for run in 1 2 3; do
    start="$(now_ms)"
    "$out/stage2/djinnc$ext" djinnc --no-link --stats -o "$out/bench_run" >"$out/bench.stats" 2>&1
    elapsed=$(( $(now_ms) - start ))
    if [ "$best" = 0 ] || [ "$elapsed" -lt "$best" ]; then best="$elapsed"; fi
done
tokens="$(sed -n 's/^tokens: \([0-9]*\).*/\1/p' "$out/bench.stats")"
nodes="$(sed -n 's/^ast: \([0-9]*\) nodes.*/\1/p' "$out/bench.stats")"
arena="$(sed -n 's/^arena: \([0-9]*\) bytes allocated.*/\1/p' "$out/bench.stats")"
phase_us() {
    local value
    value="$(sed -n "s/^\[PerformanceMonitor [^]]*\] lap $1 ([0-9]*) \([0-9]*\)\.\([0-9]*\) ms/\1\2/p" "$out/bench.stats" | head -1)"
    [ -n "$value" ] && echo $(( 10#$value ))
}
lex_us="$(phase_us lex)"
parse_us="$(phase_us parse)"
codegen_us="$(phase_us codegen)"
cat >"$out/bench.json" <<JSON
{
  "compile_ms": $best,
  "tokens": ${tokens:-0},
  "nodes": ${nodes:-0},
  "arena_bytes": ${arena:-0},
  "lex_us": ${lex_us:-0},
  "parse_us": ${parse_us:-0},
  "codegen_us": ${codegen_us:-0}
}
JSON
cat "$out/bench.json"

if [ "$update_ref" = 1 ]; then
    cp "$out/bench.json" "$bench_ref"
    echo "reference updated: $bench_ref"
elif [ -f "$bench_ref" ]; then
    for key in compile_ms arena_bytes; do
        old="$(sed -n "s/.*\"$key\": *\([0-9]*\).*/\1/p" "$bench_ref")"
        new="$(sed -n "s/.*\"$key\": *\([0-9]*\).*/\1/p" "$out/bench.json")"
        if [ -n "$old" ] && [ "$old" -gt 0 ] && [ $(( new * 100 )) -gt $(( old * 110 )) ]; then
            echo "FAIL benchmark regression: $key $old -> $new (> 10%)"
            exit 1
        fi
    done
    echo "PASS benchmark (within 10% of reference)"
else
    echo "no benchmark reference at $bench_ref (use --update-ref to create it)"
fi

echo "PASS bootstrap"
