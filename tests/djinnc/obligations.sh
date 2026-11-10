#!/usr/bin/env bash
set -eu
compiler="${1:?usage: obligations.sh <djinnc> <runtime lib> [runtime dir]}"
runtime_lib="${2:?usage: obligations.sh <djinnc> <runtime lib> [runtime dir]}"
runtime="${3:-runtime}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/build/unit/obligations"
mkdir -p "$out"
cd "$root"

fail() { echo "FAIL obligations: $1"; exit 1; }

cat > "$out/bank.djinn" <<'SOURCE'
struct Account { i64 balance; }

uow Guarded {
    require(amount > 0)
    atomic(*account)
    after_commit {
        account.balance = account.balance + 0;
    }
}

[Pure]
i32 twice(i32 value) {
    return value * 2;
}

i32 withdraw(Account* account, i64 amount) ensure(account.balance >= 0) uow(Guarded) {
    account.balance = account.balance - amount;
    return 0;
}

i32 main() {
    Account account = { .balance = 100 };
    withdraw(&account, 58);
    return twice(1);
}
SOURCE

"$compiler" "$out/bank.djinn" --check --obligations --runtime-dir "$runtime" --runtime-lib "$runtime_lib" > "$out/report.txt" 2>&1 || { cat "$out/report.txt"; fail "the report run must succeed"; }
grep -q "^obligations:" "$out/report.txt" || fail "the report must start with a header"
grep -Eq "bank.djinn:[0-9]+:[0-9]+  pure +proved +twice" "$out/report.txt" || fail "twice must be proved pure"
grep -Eq "require +checked +withdraw" "$out/report.txt" || fail "the uow require must be listed for withdraw"
grep -Eq "ensure +checked +withdraw" "$out/report.txt" || fail "the ensure must be listed for withdraw"
grep -Eq "atomic.rollback +enforced +withdraw" "$out/report.txt" || fail "the uow atomic region must be enforced"
grep -Eq "atomic.no_suspend +proved +withdraw" "$out/report.txt" || fail "the region must be proved not to suspend"
grep -Eq "after_commit +best_effort +withdraw" "$out/report.txt" || fail "after_commit must be best effort"
grep -q "^summary: 2 proved, 1 enforced, 2 checked, 1 best_effort" "$out/report.txt" || { cat "$out/report.txt"; fail "the summary counts are wrong"; }

"$compiler" "$out/bank.djinn" --check --runtime-dir "$runtime" --runtime-lib "$runtime_lib" > "$out/quiet.txt" 2>&1 || fail "the plain run must succeed"
if grep -q "^obligations:" "$out/quiet.txt"; then
    fail "the report must only print with --obligations"
fi
echo "PASS obligations"
