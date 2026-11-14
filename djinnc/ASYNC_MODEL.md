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

## Finding: the worker pool is not used (#125)

`djinn_worker_thread` dequeues from `djinn_rt.pool.queue`, but nothing ever enqueues there. Every coroutine runs on the event-loop thread (`drain_ready_queue`), so the thread count configured above creates idle threads today. Making it effective needs real multi-threaded scheduling: a thread-safe coroutine table, `Send`-like rules for captures (#54, #102) and a decision on `spawn`. There is no busy re-enqueue in practice (the loop in the worker is unreachable).

## Not implemented

- Async inference by default with explicit `async`/`sync` on public functions (#121). Today a function is sync unless declared `async`, so this would turn every un-annotated public function into an error and change `T` to `task<T>` for inferred ones. It needs a migration of `std/` and a decision on implicit await first.
- Trap on `.sync` from a scheduler thread: with a single event-loop thread, `.sync` inside a coroutine nests the event loop instead of deadlocking, so the trap is not needed until the pool is real.
