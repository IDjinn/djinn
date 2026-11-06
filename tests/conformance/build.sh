#!/usr/bin/env bash
set -eu
compiler="${1:?usage: build.sh <djinnc> <runtime lib> <output> [runtime dir]}"
runtime_lib="${2:?usage: build.sh <djinnc> <runtime lib> <output> [runtime dir]}"
output="${3:?usage: build.sh <djinnc> <runtime lib> <output> [runtime dir]}"
runtime="${4:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
support="$root/djinnc/src/support"
flags=()
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
"$compiler" "$root/tests/conformance/runner.djinn" "$root"/tests/conformance/testing/*.djinn "$root"/tests/conformance/suites/*.djinn \
    "$support"/memory/*.djinn "$support/text/byte_buffer.djinn" "$support/text/strings.djinn" \
    "$support/collections/pointer_list.djinn" "$support/source/diagnostic_code.djinn" "$support/system/libc.djinn" \
    "$support/system/files.djinn" "$support/system/process.djinn" \
    -o "$output" --runtime-dir "$runtime" --runtime-lib "$runtime_lib" ${flags[@]+"${flags[@]}"}
