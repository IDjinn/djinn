#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
compiler="${1:-$root/build/bootstrap/stage2/djinnc}"
runtime="${2:-$root/cmake-build-debug-visual-studio/runtime}"
[ -f "$compiler" ] || compiler="$compiler.exe"
out="$root/build/debug_tests"
mkdir -p "$out"
failed=0

run_case() {
    local source="$1" line="$2"
    shift 2
    local name
    name="$(basename "$source" .djinn)_$line"
    local binary="$out/$name.exe"
    if ! "$compiler" "$root/tests/djinnc/debug/$source" -g -o "$binary" --runtime-dir "$runtime" >"$out/$name.build.log" 2>&1; then
        echo "FAIL $name (compile)"
        failed=1
        return
    fi
    (cd "$out" && timeout 60 lldb -b -o "breakpoint set -f $source -l $line" -o run -o "frame variable" -o "bt" -o quit "$binary") >"$out/$name.lldb.log" 2>&1
    tr -d '\r' <"$out/$name.lldb.log" >"$out/$name.lldb.txt"
    for pattern in "$@"; do
        if ! grep -q -- "$pattern" "$out/$name.lldb.txt"; then
            echo "FAIL $name (missing: $pattern)"
            failed=1
            return
        fi
    done
    echo "PASS $name"
}

run_crash() {
    local source="$1"
    shift
    local name
    name="crash_$(basename "$source" .djinn)"
    local binary="$out/$name.exe"
    if ! "$compiler" "$root/tests/djinnc/crash/$source" -g -o "$binary" --runtime-dir "$runtime" >"$out/$name.build.log" 2>&1; then
        echo "FAIL $name (compile)"
        failed=1
        return
    fi
    "$binary" >"$out/$name.run.log" 2>&1
    tr -d '' <"$out/$name.run.log" >"$out/$name.run.txt"
    for pattern in "$@"; do
        if ! grep -q -- "$pattern" "$out/$name.run.txt"; then
            echo "FAIL $name (missing: $pattern)"
            failed=1
            return
        fi
    done
    echo "PASS $name"
}

run_case_stage0() {
    local source="$1" line="$2"
    shift 2
    local name
    name="stage0_$(basename "$source" .djinn)_$line"
    local dir="$out/$name"
    rm -rf "$dir"
    mkdir -p "$dir"
    cp "$root/tests/djinnc/debug/$source" "$dir/$source"
    if ! (cd "$root" && "$stage0" -g -O0 -out "$dir" -o prog "$dir/$source") >"$out/$name.build.log" 2>&1 && [ ! -f "$dir/prog.exe" ] && [ ! -f "$dir/prog" ]; then
        echo "FAIL $name (compile)"
        failed=1
        return
    fi
    local binary="$dir/prog.exe"
    [ -f "$binary" ] || binary="$dir/prog"
    (cd "$dir" && timeout 60 lldb -b -o "breakpoint set -f $source -l $line" -o run -o "frame variable" -o "bt" -o quit "$binary") >"$out/$name.lldb.log" 2>&1
    tr -d '' <"$out/$name.lldb.log" >"$out/$name.lldb.txt"
    for pattern in "$@"; do
        if ! grep -q -- "$pattern" "$out/$name.lldb.txt"; then
            echo "FAIL $name (missing: $pattern)"
            failed=1
            return
        fi
    done
    echo "PASS $name"
}

run_case locals.djinn 8 "locals.djinn:8" "a = 3" "b = 4" "total = 7" "add(a=3, b=4)"
run_case locals.djinn 14 "r = 7" "x = 3" "y = 4" "main"
run_case scopes.djinn 11 "inner = 14" "sum = 0" "current = 0x"
run_case scopes.djinn 20 "value = 5" "value = 7" "next = NULL" "Node"
run_case structs.djinn 8 "x = 3" "y = 4" "result = 12" "Point"
run_case enums.djinn 12 "base = 11" "result = 33" "level = " "weight"

run_crash null_read.djinn "native stack trace" "read" "outer" "null_read.djinn:6" "null_read.djinn:10"

if [ -n "${STAGE0:-}" ]; then
    stage0="$STAGE0"
    run_case_stage0 locals.djinn 8 "a = 3" "b = 4" "total = 7" "add(a=3, b=4)"
    run_case_stage0 locals.djinn 14 "r = 7"
    run_case_stage0 structs.djinn 8 "x = 3" "y = 4" "result = 12"
fi

exit $failed
