#!/usr/bin/env bash
set -eu
compiler="${1:?usage: graph.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: graph.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit"
mkdir -p "$out/libs"
cd "$root"
flags=(--lib-dir "$out/libs" --std-dir "$root/std" --runtime-dir "$runtime" --runtime-lib "$runtime_lib")
if [ -n "${DJINN_USE_LLD:-}" ]; then
    flags+=(--lld)
fi
exe=""
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=".exe" ;; esac

fail() { echo "FAIL graph: $1"; exit 1; }

"$compiler" libs/testing -o "$out/libs/testing.djlib" "${flags[@]}"

# Invalid graphs are rejected before any test runs.
check_invalid() {
    local name="$1" expected="$2" log="$out/invalid_$1.log"
    "$compiler" test "tests/graph_invalid/$name" -o "$out/invalid_$name$exe" "${flags[@]}" > "$log" 2>/dev/null && fail "$name must not run"
    grep -q "^graph error: .*$expected" "$log" || { cat "$log"; fail "$name: expected '$expected'"; }
    grep -q "^PASS\|^FAIL" "$log" && fail "$name: no test may run"
    return 0
}
check_invalid self_cycle "cycle: "
check_invalid two_cycle "cycle: "
check_invalid long_cycle "cycle: "
check_invalid missing_producer "has no \[Test\] that returns it"
check_invalid ambiguous_producer "has 2 producers"
check_invalid unknown_from "has no \[Test\] named 'nobody'"
check_invalid async_parameter "async \[Test\] cannot take or give values"

# One binary, many scenarios.
"$compiler" test tests/graph -o "$out/graph_tests$exe" "${flags[@]}" > "$out/graph_ok.log"
exe_path="$out/graph_tests$exe"

summary() { grep -E "^[0-9]+ passed, " "$1" | tail -1; }
passes() { grep -c "^PASS $2" "$1" || true; }
expect_line() { grep -q "$2" "$1" || { cat "$1" | head -40; fail "$3"; }; }

summary "$out/graph_ok.log" | grep -Eq "^([0-9]+) passed, 0 failed, \1 total" || { head -30 "$out/graph_ok.log"; fail "the healthy run must pass every test"; }
[ "$(passes "$out/graph_ok.log" "Chain.step_")" = 64 ] || fail "all 64 chain steps must pass"

run() {
    local log="$out/graph_$1.log"
    shift
    env "$@" "$exe_path" > "$log" 2>&1 && fail "a broken node must fail the run ($*)"
    echo "$log"
}

log=$(run chain GRAPH_FAIL=step_30)
[ "$(passes "$log" "Chain.step_")" = 30 ] || fail "chain: steps 0..29 must pass"
expect_line "$log" "^FAIL Chain.step_30" "chain: step_30 must fail"
[ "$(grep -c "^BLOCKED Chain.step_.*blocked by Chain.step_30" "$log")" = 33 ] || fail "chain: steps 31..63 must be blocked"
expect_line "$log" "^BLOCKED Chain.chain_end: blocked by Chain.step_30" "chain: the end of the chain must be blocked"
expect_line "$log" "34 blocked" "chain: the summary must count 34 blocked"

log=$(run exit GRAPH_EXIT=step_10)
expect_line "$log" "^FAIL Chain.step_10: exit 3" "exit: step_10 must fail with the exit code"
expect_line "$log" "^BLOCKED Chain.step_11: blocked by Chain.step_10" "exit: step_11 must be blocked"

log=$(run root GRAPH_FAIL=step_00)
[ "$(passes "$log" "Chain.step_")" = 0 ] || fail "root: nothing below a broken root may pass"
expect_line "$log" "63 blocked\|64 blocked" "root: the whole chain must be blocked"

log=$(run diamond_branch GRAPH_FAIL=left)
expect_line "$log" "^FAIL Diamond.left" "diamond: left must fail"
expect_line "$log" "^PASS Diamond.right" "diamond: right must still pass after the worker restarts"
expect_line "$log" "^BLOCKED Diamond.join: blocked by Diamond.left" "diamond: join must be blocked"

log=$(run diamond_root GRAPH_FAIL=root)
expect_line "$log" "^BLOCKED Diamond.left: blocked by Diamond.root" "diamond root: left must be blocked"
expect_line "$log" "^BLOCKED Diamond.right: blocked by Diamond.root" "diamond root: right must be blocked"
expect_line "$log" "^BLOCKED Diamond.join: blocked by Diamond.root" "diamond root: join must be blocked"

log=$(run fan GRAPH_FAIL=fan_3)
expect_line "$log" "^FAIL Fan.fan_3" "fan: fan_3 must fail"
[ "$(passes "$log" "Fan.fan_")" = 7 ] || fail "fan: the other 7 consumers must pass"
expect_line "$log" "^PASS Fan.seed" "fan: the shared root must pass"
expect_line "$log" "^PASS Wide.settle" "fan: an unrelated component is unaffected"

# A filter pulls in the ancestors it needs and nothing else.
"$exe_path" --filter step_05 > "$out/graph_filter.log"
[ "$(passes "$out/graph_filter.log" "Chain.step_")" = 6 ] || fail "filter: step_05 needs steps 0..5"
grep -q "Diamond\|Fan\|Wide" "$out/graph_filter.log" && fail "filter: unrelated tests must not run"

# Listing validates and prints every test.
"$exe_path" --list > "$out/graph_list.log"
[ "$(grep -c "" "$out/graph_list.log")" -gt 80 ] || fail "list: every test must be listed"

# Explicit workflows share nodes by function and bindings.
"$compiler" test tests/workflow -o "$out/workflow_tests$exe" "${flags[@]}" > "$out/workflow_ok.log"
workflow_exe="$out/workflow_tests$exe"
summary "$out/workflow_ok.log" | grep -Eq "^10 passed, 0 failed, 10 total" || { head -30 "$out/workflow_ok.log"; fail "workflow: the healthy run must pass 10 nodes"; }
[ "$(grep -c "^PASS Flow.login (" "$out/workflow_ok.log")" = 1 ] || fail "workflow: login must run once for every workflow that uses it"
expect_line "$out/workflow_ok.log" "^PASS Flow.edit(login) " "workflow: edit must exist bound to login"
expect_line "$out/workflow_ok.log" "^PASS Flow.edit(login_admin) " "workflow: edit must exist bound to login_admin"
expect_line "$out/workflow_ok.log" "^PASS Flow.compare(login+edit(login)) " "workflow: compare must reuse the shared edit node"

"$workflow_exe" --workflow admin > "$out/workflow_admin.log"
[ "$(grep -c "^PASS " "$out/workflow_admin.log")" = 4 ] || { cat "$out/workflow_admin.log"; fail "workflow: admin must run exactly its 4 nodes"; }
grep -q "Flow.login (\|Flow.user_only\|Flow.alone" "$out/workflow_admin.log" && fail "workflow: admin must not run other workflows"

"$workflow_exe" --workflow recheck > "$out/workflow_recheck.log"
[ "$(grep -c "^PASS " "$out/workflow_recheck.log")" = 3 ] || { cat "$out/workflow_recheck.log"; fail "workflow: recheck must run exactly its 3 nodes"; }

"$workflow_exe" --workflow nope > "$out/workflow_nope.log" && fail "workflow: an unknown name must fail"
expect_line "$out/workflow_nope.log" "no workflow named nope" "workflow: unknown name must be reported"

WF_FAIL=login_admin "$workflow_exe" > "$out/workflow_fail.log" && fail "workflow: a broken login must fail the run"
expect_line "$out/workflow_fail.log" "^FAIL Flow.login_admin" "workflow: login_admin must fail"
[ "$(grep -c "^BLOCKED .*blocked by Flow.login_admin" "$out/workflow_fail.log")" = 3 ] || fail "workflow: the admin chain must be blocked"
expect_line "$out/workflow_fail.log" "^PASS Flow.audit(edit(login)+login)" "workflow: the user chain must still pass"

"$compiler" test tests/workflow_invalid -o "$out/workflow_invalid$exe" "${flags[@]}" > "$out/workflow_invalid.log" 2>/dev/null && fail "workflow_invalid must not run"
expect_line "$out/workflow_invalid.log" "^graph error: workflow 'early': Broken.use_token: parameter 'token' of type Token has no earlier step that returns it" "workflow_invalid: a step needing a later producer"
expect_line "$out/workflow_invalid.log" "^graph error: workflow 'helper': step 2 is not a \[Test\]" "workflow_invalid: a step that is not a test"

echo "graph: ok"
