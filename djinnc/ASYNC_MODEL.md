# Async/sync model: plan

Decisions (confirmed 2026-11-14). Tracking issues: #121 to #125.

- Async is inferred for private/internal functions; public/exported functions declare `async` or `sync` (#121).
- `await f()` stays explicit. `sync` opts a function out of async.
- `task.sync` is the blocking wait from sync code (C# `GetAwaiter().GetResult()`). It warns inside async code and traps on a scheduler thread (#122).
- `sync main` with nothing async reachable has no runtime; otherwise the compiler includes it (#123).
- Runtime configuration, highest precedence first: `DJINN_THREADS` env var, `threads=N` in `runtime.properties`, `[Runtime(threads = N)]` on main, `.proj`, default (#124).
- Scheduler: unify event loop and worker pool before `.sync` (#125).

## Order of implementation

1. **Runtime thread config (#124), runtime side.** Done: `DJINN_THREADS` and `runtime.properties`. Done too: `--async-threads=N` replaces the hardcoded `4` in `code_generator_functions.djinn`. Done too: `[Runtime(threads = N)]` on `main` and `async-threads:` in `djinn.proj` (flag > attribute > .proj > 4). Next: default to logical cores, `io_threads` and the other fields, config struct.
2. **Scheduler unification (#125).** Remove the busy re-enqueue in `djinn_worker_thread`, timers without busy-wait, scheduler-thread flag.
3. **`sync` keyword (#121).** Lexer/parser/AST, checker: sync function cannot `await`; sync main; blocking std I/O variants.
4. **`.sync` (#122).** Postfix on `task<T>`, "may block" fixpoint, warning, runtime trap. Retire `await` running a nested event loop in sync functions.
5. **Inference and explicit public API (#121).** Build on `AsyncElision`, store the result in the `.djlib` interface.
6. **Runtime-less `sync main` (#123).**

## Status (implemented)

- Runtime thread configuration (#124): flag, `[Runtime]`, `.proj`, `DJINN_THREADS`, `runtime.properties`.
- `sync` modifier and postfix `.sync` (#121, #122): `await` in a `sync` function is E3061; `.sync` in an async function is E6005. `.sync` reuses the nested event loop that `await` already used in sync functions, so it blocks the calling thread until the task is done.
- Runtime-less `sync main` (#123): conservative rule, the runtime is omitted only when no function is still async after elision (any async declaration, used or not, keeps it).

## Worker pool (#125)

`djinn_worker_thread` dequeues from `pool.queue`, but nothing enqueues there: every coroutine runs on the event-loop thread (`drain_ready_queue`). Idle workers only burn resources, so the runtime no longer starts them (`DJINN_SCHEDULE_ON_POOL 0` in `scheduler.c`). The thread setting is still resolved (env > properties > `[Runtime]` > `.proj` > default, where `0` means the logical core count) and kept in `pool.configured_threads`. Turning the pool on needs a thread-safe coroutine table, `Send`-like capture rules (#54, #102) and a decision on `spawn`; flip the macro when that exists. Until then `.sync` inside a coroutine nests the event loop on the same thread, so the scheduler-thread trap and `io_threads` are not meaningful and are not implemented.

### Timers and idle loop (done)

`Task.delay` no longer busy-yields. It registers a timer (`__djinn_async_sleep`), marks the coroutine waiting and suspends; the event loop re-enqueues it when the deadline passes. When nothing is runnable the loop waits on the ready queue's condition variable (I/O threads signal it) for at most 20 ms or until the next timer, instead of spinning with `sched_yield`/`Sleep(0)`. Timers live on the loop thread, so they need no lock.

## Public contract (#121)

A function written `public` that blocks on a task (`.sync`) or calls an async function without awaiting it, and declares neither `async` nor `sync`, gets error E3063. The choice is part of the contract for library callers. `public` is op bit 128, `private` 64.

## Runtime-less `sync main` (#123)

The runtime is omitted when no async work is reachable from a `sync main`: the program walks the functions main can reach and looks for `spawn`, `.sync`, awaits that are not a direct call, async functions that remain coroutines after elision, or runtime async primitives. Unreachable async code does not keep the runtime.

## Finding: inference by default is blocked on two language gaps (#121)

1. ~~`public` and `private` are parsed and then dropped.~~ Done (and E3063 for public contract): `private` is op bit 64 / `FunctionInfo.is_private` and is enforced per namespace (E3062); `public` is the default and has no bit. The `.djlib` interface keeps the modifier in its minified text, so library imports are checked too (tested in `sync_model.sh`).
2. Inferring `async` for a private function changes its type from `T` to `task<T>`. With `await` explicit, every un-annotated caller would stop compiling, so inference needs either implicit await at call sites in inferred-async code or a coloring rule that keeps the signature `T` and lets the compiler hide the task. This is the open design decision.

Until both are settled a function is async only when declared, and `AsyncElision` already removes the cost of declaring `async` on code that never suspends.

## Decision: `await` makes a function async (2026-11-14)

Resolves the implicit-await question without changing call sites: a function whose body contains `await` is async (the parser sets the async bit), so `T` becomes `task<T>` exactly as if `async` were written, and callers `await` it as usual. Functions without `await` keep their signature. Excluded: `sync` functions (`await` stays E3061) and `main` (entry point signature is fixed; write `async i32 main()` explicitly). Inference is a parser-level rule, so an inferred function keeps its body in the `.djlib` interface. A function that calls async code without awaiting is deliberately not inferred: it holds the task itself (storing it, passing it on, or `.sync`), so changing its signature would be wrong. The public contract error (E3063) covers that case.

## Not implemented

- Executing coroutines on the worker pool (real multi-threading, #125), the `.sync` scheduler-thread trap and `io_threads`: all depend on it (see "Worker pool").
