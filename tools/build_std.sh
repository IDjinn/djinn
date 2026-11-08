#!/usr/bin/env bash
set -eu
compiler="${1:?usage: build_std.sh <djinnc> <output djlib> [djinnc flags]}"
output="${2:?usage: build_std.sh <djinnc> <output djlib> [djinnc flags]}"
shift 2
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$(dirname "$output")"
mapfile -t sources < <(find "$root/std" -name '*.djinn' | sort)
"$compiler" "${sources[@]}" --library -o "$output" "$@"
