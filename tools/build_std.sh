#!/usr/bin/env bash
set -eu
compiler="${1:?usage: build_std.sh <djinnc> <output djlib> [djinnc flags]}"
output="${2:?usage: build_std.sh <djinnc> <output djlib> [djinnc flags]}"
shift 2
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$(dirname "$output")"
mapfile -t sources < <(find "$root/std" -name '*.djinn' | sort)
# The std is built with the float settings of std/djinn.proj (ieee754: "2019", fp-env: "default"): this script builds
# from the source list, which does not read the manifest, so the same values are passed here. Keep the two in step.
"$compiler" "${sources[@]}" --library --ieee754=2019 --fp-env=default -o "$output" "$@"
