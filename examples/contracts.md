```djinn
// require is checked on entry, ensure on every return (result is the returned value, old(x) its value at entry).
i32 abs(i32 value)
    require(value != -2147483648)
    ensure(result >= 0)
    ensure(result == value || result == -value)
{
    return value < 0 ? -value : value;
}
```

```djinn
// An invariant holds whenever a method or constructor returns; its fields are only written by its own methods.
struct Account {
    mut i64 balance;
    invariant(this.balance >= 0);

    Account(i64 start) {
        this.balance = start;
    }

    public void withdraw(i64 amount) require(amount > 0) ensure(this.balance == old(this.balance) - amount) {
        this.balance = this.balance - amount;
    }
}
```

```djinn
// An atomic region restores its operands when an error leaves it; after_commit runs only when it completes.
unsafe i32 transfer(Account* from, Account* to, i64 amount) throws(InsufficientFunds, AuditUnavailable) {
    atomic(*from, *to) {
        if (from.balance < amount) {
            throw InsufficientFunds();
        }
        from.balance = from.balance - amount;
        try audit(amount);
        to.balance = to.balance + amount;
    } after_commit {
        printf("committed %lld\n", amount);
    }
    return 0;
}
```

Build modes: `--contracts=check` (trap, default), `observe` (report and go on) or `ignore`; `contracts:` in `djinn.proj`.
Each `.djlib` keeps the mode it was built with. `--obligations[=json]` lists every guarantee and the inferred effects.
See `examples/bank_transfer.djinn` for the complete transfer.
