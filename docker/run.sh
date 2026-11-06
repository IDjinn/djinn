#!/usr/bin/env bash
set -eu
cd /work
mkdir -p build/seed
rm -f djinnc/build/djinnc
/opt/djinn/djinn -r djinnc >build/seed/stage0.log 2>&1 || true
[ -f djinnc/build/djinnc ] || { echo "FAIL seed not produced (see build/seed/stage0.log)"; exit 1; }
cp djinnc/build/djinnc build/seed/djinnc
tools/bootstrap.sh --seed build/seed/djinnc --runtime-dir /opt/djinn/runtime --runtime-lib /opt/djinn/libdjinn_runtime.a --lld
tools/debug_tests.sh /work/build/bootstrap/stage2/djinnc /opt/djinn/runtime
