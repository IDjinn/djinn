#!/usr/bin/env bash
set -eu
cd /work
tools/bootstrap.sh --seed /opt/djinn/djinnc --runtime-dir /opt/djinn/runtime --runtime-lib /opt/djinn/runtime-lib/libdjinn_runtime.a --lld
tools/debug_tests.sh /work/build/bootstrap/stage2/djinnc /opt/djinn/runtime
