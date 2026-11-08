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

bash "$root/tools/build_std.sh" "$compiler" "$out/libs/std.djlib" --runtime-dir "$runtime" --runtime-lib "$runtime_lib" ${DJINN_USE_LLD:+--lld}
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
summary "$out/workflow_ok.log" | grep -Eq "^15 passed, 0 failed, 15 total" || { head -30 "$out/workflow_ok.log"; fail "workflow: the healthy run must pass 15 nodes"; }
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

"$workflow_exe" --list --graph json > "$out/workflow_graph.json"
grep -q '"largest_component":' "$out/workflow_graph.json" || fail "graph json: the largest component must be reported"
grep -q '"name":"Flow.edit(login_admin)","component":[0-9]*,"state":"not run","inputs":\["Flow.login_admin"\]' "$out/workflow_graph.json" || { cat "$out/workflow_graph.json"; fail "graph json: edit(login_admin) must list its input"; }
"$workflow_exe" --list --graph dot > "$out/workflow_graph.dot"
grep -q '^digraph tests' "$out/workflow_graph.dot" || fail "graph dot: header"
grep -q '"Flow.login_admin" -> "Flow.edit(login_admin)";' "$out/workflow_graph.dot" || fail "graph dot: edge login_admin -> edit(login_admin)"

WF_FAIL=login_admin "$workflow_exe" --graph json --graph-file "$out/workflow_states.json" > /dev/null && fail "graph states: the run must fail"
grep -q '"name":"Flow.login_admin","component":[0-9]*,"state":"failed"' "$out/workflow_states.json" || { cat "$out/workflow_states.json"; fail "graph states: login_admin must be failed"; }
grep -q '"name":"Flow.admin_only(login_admin)".*"state":"blocked"' "$out/workflow_states.json" || fail "graph states: admin_only must be blocked"
grep -q '"name":"Flow.alone","component":[0-9]*,"state":"passed"' "$out/workflow_states.json" || fail "graph states: a lone test must be passed"
grep -q '"blocked_by":"Flow.login_admin"' "$out/workflow_states.json" || fail "graph states: the blocker must be named"

# A compilation is the output of a node: one compiler run serves the diagnostic, IR and execution checks.
"$compiler" djinnc/testing -o "$out/libs/djinnc_testing.djlib" "${flags[@]}"
mkdir -p "$out/compilations"
compiler_path="$(cd "$(dirname "$compiler")" && pwd)/$(basename "$compiler")"
lld_flag=""
[ -n "${DJINN_USE_LLD:-}" ] && lld_flag="1"
COMPILATION_DIR="$out/compilations" COMPILATION_COMPILER="$compiler_path" COMPILATION_RUNTIME_LIB="$runtime_lib" COMPILATION_RUNTIME_DIR="$runtime" COMPILATION_LLD="$lld_flag"     "$compiler" test tests/compilation -o "$out/compilation_tests$exe" "${flags[@]}" > "$out/compilation.log" 2>&1 || { grep -v "^djinnc:" "$out/compilation.log" | head -30; fail "compilation: every check must pass"; }
summary "$out/compilation.log" | grep -Eq "^6 passed, 0 failed, 6 total" || { cat "$out/compilation.log"; fail "compilation: 6 nodes expected"; }
[ "$(grep -c "^PASS Hello.seven" "$out/compilation.log")" = 1 ] || fail "compilation: the source must be compiled once for its three checks"
grep -q "^PASS Hello.exits_with_seven" "$out/compilation.log" || fail "compilation: the run check must pass"

# Phase 5: [Skip], [Resource], [Teardown], --junit and --seed.
export FEATURES_TEARDOWN="$out/features_teardown.log" FEATURES_LOCK="$out/features.lock"
rm -f "$FEATURES_TEARDOWN" "$FEATURES_LOCK"
"$compiler" test tests/features -o "$out/features_tests$exe" "${flags[@]}" -- --junit "$out/features.xml" > "$out/features.log" 2>&1 || { grep -v "^djinnc:" "$out/features.log" | head -30; fail "features: the run must pass"; }
expect_line "$out/features.log" "^11 passed, 0 failed, 3 skipped, 14 total" "features: the summary must count 3 skipped"
expect_line "$out/features.log" "^SKIP Skipping.later: not written yet" "features: [Skip] must carry its reason"
expect_line "$out/features.log" "^SKIP Skipping.needs_base: skipped with Skipping.base_value" "features: a dependent of a skipped test must be skipped"
expect_line "$out/features.log" "^PASS Parameterized.sum(10,20,30)" "features: every [Case] must run as its own test"
expect_line "$out/features.log" "^PASS Parameterized.sum(-5,5,0)" "features: a negative [Case] value must work"
expect_line "$out/features.log" "^PASS Parameterized.flag(0)" "features: a bool [Case] must work"
[ -f "$FEATURES_TEARDOWN" ] || fail "features: [Teardown] must run after the component"
grep -q '<testsuite name="tests" tests="14" failures="0" skipped="3">' "$out/features.xml" || { cat "$out/features.xml"; fail "features: junit header"; }
grep -q '<skipped message="not written yet"/>' "$out/features.xml" || fail "features: junit must mark skipped tests"
features_exe="$out/features_tests$exe"
"$features_exe" --jobs 1 --seed 5 > "$out/features_seed_a.log"
"$features_exe" --jobs 1 --seed 5 > "$out/features_seed_b.log"
order() { grep -E "^(PASS|SKIP) " "$1" | sed -E 's/^(PASS|SKIP) ([^ :]*).*//'; }
[ "$(order "$out/features_seed_a.log")" = "$(order "$out/features_seed_b.log")" ] || fail "seed: the same seed must give the same order"
expect_line "$out/features_seed_a.log" "^seed: 5" "seed: the seed must be printed"

# Phase 6: [Bench] runs alone, in series, after preparing its inputs through the graph.
"$compiler" test tests/bench -o "$out/bench_tests$exe" "${flags[@]}" > "$out/bench_tests.log" 2>&1 || { grep -v "^djinnc:" "$out/bench_tests.log" | head -20; fail "bench: the normal run must pass"; }
expect_line "$out/bench_tests.log" "^2 passed, 0 failed, 2 total" "bench: a normal run must skip the benchmarks"
grep -q "^BENCH " "$out/bench_tests.log" && fail "bench: a normal run must not measure"
bench_exe="$out/bench_tests$exe"
"$bench_exe" --bench --bench-out "$out/bench.json" > "$out/bench.log" || { cat "$out/bench.log"; fail "bench: --bench must pass"; }
expect_line "$out/bench.log" "^BENCH Spin.spin: median [0-9]* us (min [0-9]*, mean [0-9]*, 5 runs)" "bench: spin must be measured with its iterations"
expect_line "$out/bench.log" "^BENCH Spin.tiny: median [0-9]* us (min [0-9]*, mean [0-9]*, 3 runs)" "bench: tiny must be measured"
grep -q "ordinary" "$out/bench.log" && fail "bench: tests must not run in bench mode"
grep -q '"name":"Spin.spin","min_us":' "$out/bench.json" || fail "bench: the JSON must list spin"
"$bench_exe" --bench --bench-ref "$out/bench.json" --bench-tolerance 1000 > "$out/bench_ok.log" || { cat "$out/bench_ok.log"; fail "bench: a result within tolerance must pass"; }
printf '{"benchmarks":[{"name":"Spin.spin","min_us":1,"median_us":1,"mean_us":1,"iterations":5}]}' > "$out/bench_ref.json"
"$bench_exe" --bench --bench-ref "$out/bench_ref.json" > "$out/bench_bad.log" && fail "bench: a regression must fail the run"
expect_line "$out/bench_bad.log" "^REGRESSION Spin.spin: median 1 us ->" "bench: the regression must be reported"

# Phase 5: a per-node timeout inside a component fails only that node.
"$compiler" test tests/timeouts -o "$out/timeouts_tests$exe" "${flags[@]}" > "$out/timeouts.log" 2>&1 && fail "timeouts: the slow node must fail the run"
expect_line "$out/timeouts.log" "^FAIL Limits.slow: timeout" "timeouts: slow must time out"
expect_line "$out/timeouts.log" "^PASS Limits.fine" "timeouts: the sibling must still pass after the restart"
expect_line "$out/timeouts.log" "^BLOCKED Limits.after_slow: blocked by Limits.slow" "timeouts: the dependent must be blocked"
expect_line "$out/timeouts.log" "1 blocked" "timeouts: the summary must count the blocked node"

# djinnc test --watch rebuilds and reruns when a source changes.
watch_dir="$out/watch_project"
rm -rf "$watch_dir"
mkdir -p "$watch_dir/src"
cp tests/workflow/djinn.proj "$watch_dir/djinn.proj"
printf 'import testing;

struct Watched {
    [Test]
    void first() {
        Expect.equal(1, 1);
    }
}
' > "$watch_dir/src/watched_test.djinn"
"$compiler" test "$watch_dir" -o "$out/watch_tests$exe" "${flags[@]}" --watch --watch-runs 2 > "$out/watch.log" 2>&1 &
watch_pid=$!
for attempt in $(seq 1 120); do
    grep -q "^watch: waiting for changes" "$out/watch.log" 2>/dev/null && break
    sleep 1
done
grep -q "^1 passed, 0 failed, 1 total" "$out/watch.log" || { kill "$watch_pid" 2>/dev/null; cat "$out/watch.log"; fail "watch: the first run must pass"; }
printf 'import testing;

struct Watched {
    [Test]
    void first() {
        Expect.equal(1, 1);
    }

    [Test]
    void second() {
        Expect.equal(2, 2);
    }
}
' > "$watch_dir/src/watched_test.djinn"
for attempt in $(seq 1 120); do
    kill -0 "$watch_pid" 2>/dev/null || break
    sleep 1
done
kill "$watch_pid" 2>/dev/null || true
grep -q "^2 passed, 0 failed, 2 total" "$out/watch.log" || { cat "$out/watch.log"; fail "watch: the change must trigger a second run with both tests"; }

echo "graph: ok"
