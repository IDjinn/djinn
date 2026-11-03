#!/usr/bin/env bash
set -eu
cd /work
tools/bootstrap.sh --stage0 /opt/djinn/djinn --runtime-dir /opt/djinn/runtime --runtime-lib /opt/djinn/libdjinn_runtime.a --lld
STAGE0=/opt/djinn/djinn tools/debug_tests.sh /work/build/bootstrap/stage2/djinnc /opt/djinn/runtime
