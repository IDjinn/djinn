# Range analysis

`djinnc/src/semantic/range/` proves runtime checks redundant on the typed AST and lets the code generator drop them.
It runs between the type checker and code generation, only with `-O1` or higher and without `--no-range-opt`.
`-O0` always keeps every check. The JIT (`--run`, `--tiered`) shares the same path, so it proves the same checks.

## What is proven

For each integer expression the analysis keeps an interval `[low, high]` (`RangeAnalysis.eval`). A proof is stored on
the node (`Node.add_proof`, `ast_proofs`) together with the common type it was computed in; the code generator reads it
with `Node.proof_for(common)` and a proof for another type is ignored.

| Flag | Removes |
| --- | --- |
| `OVERFLOW_FREE` | the `with.overflow` check of `+ - *`, `++`, `--` and negation; emits `nsw`/`nuw` |
| `DIVISOR_NONZERO` | the division-by-zero check of `/` and `%` |
| `NOT_MINIMUM_DIVIDED` | the `MIN / -1` check of signed `/` |
| `SHIFT_IN_RANGE` | the shift-count check of `<<` and `>>` |

## Soundness rules

- A fact exists only for integer locals that are not `volatile` and whose address is never taken (`&x`, or `x` used as
  the receiver of a field access). Everything else is the full range of its type.
- Statements the analysis does not model (`switch`, `spawn`, try, async await...) forget every local they assign and
  record no proofs inside.
- A loop forgets every local it writes before the first iteration, so the entry state covers all iterations. The exit
  is refined by the negated condition only when the body has no `break`.
- A comparison refines a local only when the condition contains no assignment. An empty interval marks the path dead.
- 64-bit unsigned values above `i64.MAX_VALUE` have no `i64` bound and stay unknown.
- All interval arithmetic is checked against `i64` overflow first; a possible overflow falls back to the full range.

## Observing it

`--stats` prints `range: N checks proven` for ahead-of-time builds and for `--run`. `tests/djinnc/range_opt.sh` compares
the IR with and without `--no-range-opt` and checks the same count from the JIT. `tests/conformance/src/suites/range.djinn`
checks at every `-O` level that proven code computes the right value and that anything unproven still traps.
