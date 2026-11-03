#!/usr/bin/env bash
# usage: bench_scale.sh <djinnc executable> <runtime dir> [lines...]
set -euo pipefail
compiler="${1:?usage: bench_scale.sh <djinnc> <runtime dir> [lines...]}"
runtime="${2:?usage: bench_scale.sh <djinnc> <runtime dir> [lines...]}"
shift 2
sizes=("$@")
[ ${#sizes[@]} -gt 0 ] || sizes=(1000 10000 100000)
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

generate() {
    local lines="$1" out="$2" count=$(( $1 / 6 )) i
    {
        for ((i = 0; i < count; i++)); do
            printf 'i32 f%d(i32 x) {\n    mut i32 a = x + %d;\n    if (a > 10) { a = a - 3; }\n    return a * 2;\n}\n\n' "$i" "$i"
        done
        printf 'i32 main() { return f0(1) %% 7; }\n'
    } > "$out"
}

printf '%-10s %-8s %-8s %-8s %-8s %-8s\n' lines read_ms lex_ms parse_ms codegen_ms total_ms
for lines in "${sizes[@]}"; do
    generate "$lines" "$work/bench.djinn"
    best=""
    for run in 1 2 3; do
        stats="$("$compiler" "$work/bench.djinn" --no-link --stats -o "$work/bench.exe" --runtime-dir "$runtime" 2>&1)"
        total="$(grep -oE 'total [0-9.]+' <<<"$stats" | awk '{print $2}')"
        if [ -z "$best" ] || awk "BEGIN{exit !($total < $best)}"; then
            best="$total"
            row="$(printf '%s' "$stats" | grep -E 'lap (read|lex|parse|codegen)' | sed -E 's/.*lap [a-z-]+ \([0-9]+\) ([0-9.]+) ms/\1/' | tr '\n' ' ')"
        fi
    done
    read -r r l p c <<<"$row"
    printf '%-10s %-8s %-8s %-8s %-8s %-8s\n' "$lines" "$r" "$l" "$p" "$c" "$best"
done
