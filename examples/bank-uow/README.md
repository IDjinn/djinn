# bank-uow

A bank transfer written with the guarantee features of djinnc.

```powershell
djinnc examples/bank-uow --run
djinnc examples/bank-uow --check --obligations
```

| File | What it shows |
|---|---|
| `src/model.djinn` | `invariant(...)` on `Ledger`, with `require`, `ensure` and `old(...)` on its method |
| `src/units.djinn` | `uow` declarations: participants, `require`/`ensure`, `writes`, `access`, `ordering`, `isolation` |
| `src/bank.djinn` | `uow(Name) strategy cooperative` methods, `writes(...)`, `requires uow`, and the explicit `atomic { } after_commit { }` form |
| `src/main.djinn` | the scenarios: a failed transfer that rolls back, a fee, an audit failure that rolls back, a committed settlement |

Things the compiler rejects, to try:

- `take_fee(&a, 1);` from a plain function: `E7015`, it requires a region.
- A write to another account inside `transfer`: `E7013`, it is not in the uow's `writes`.
- `access(shared from)` on a uow that writes `from`: `E7019`.
- Two `uow` declarations with `ordering(Account.id ascending)` and `ordering(Account.id descending)`: `E7019`.
- `Ledger { .entries = 1, ... }` outside the struct: `E7002`, build it with its constructor.
