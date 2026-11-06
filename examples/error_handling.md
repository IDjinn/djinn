### Error Handling

Errors are plain values, checked by the compiler and returned by value, exactly like Rust's `Result<T, E>`. There is no
unwinding, no hidden allocation and no global state: `throws(E)` is only syntax sugar that separates the success type
`T` from the error type `E` in a function signature.

```djinn
struct DivisionByZeroError {
    i32 dividend;

    DivisionByZeroError(i32 dividend) {
        this.dividend = dividend;
    }
}

i32 division(i32 value, i32 divisor) throws(DivisionByZeroError) {
    if (divisor == 0) {
        throw DivisionByZeroError(value);
    }
    return value / divisor;
}

i32 main() {
    i32 a = try division(1, 0) ?: -1;

    i32 b = switch division(10, 2) {
        Result v -> v,
        DivisionByZeroError e -> e.dividend,
    };
    return a + b;
}
```

- An error type is any non-void type listed in a `throws(...)` clause, as in Rust's `Result<T, E>`: `i32 f() throws(bool)`
  is `fn f() -> Result<i32, bool>`. There is no base type and no hierarchy; a struct error carries its details in fields.
- The return type stays the classical `T`. `throws(A, B)` means `Result<T, A | B>`: a tagged union, matched by exact
  type.
- A call to a throwing function must be handled: `try f() ?: fallback` (use the fallback on error), `try f()` (re-throw to
  the caller, which must declare the error in its own `throws`), a `switch` over the call, or an unchecked call inside a
  throwing function, which re-throws automatically.
- `switch f() { Result v -> ..., ErrorType e -> ..., Error e -> ... }`: `Result` (or `_`) binds the success value, a
  type name binds that error, and `Error` catches whatever is left as the core `Error` value (`name`, `message`, `code`,
  `stackTrace`). The switch must be exhaustive: every error type of the call needs an arm, or an `Error` arm must exist.
- A bare `throws` accepts any error; every error is converted to the core `Error` value.
- `Error.stackTrace` holds the call stack captured at the throw site. It is on by default in debug builds and `null`
  otherwise.
- An error that escapes `main` prints a report (type, message, stack in debug builds) and aborts.

Async functions follow the same rules: `async i32 f() throws(E)` yields a `task<i32, E>` whose `await` must be wrapped in
`try` or a `switch`. `task<T>` is `task<T, void>`, a task that cannot fail. The failure record lives inline in the
coroutine promise, so there is no allocation. An async function that lists several error types reports them as the core
`Error`, because a task carries a single error type.

`panic("message")` is an intrinsic for bugs, not recoverable errors: it prints the message and the live stack, then
aborts. A function marked `[NoReturn]` (and `panic`, `unreachable`) ends the control flow: the compiler emits
`unreachable` after the call and assumes the program never continues from there.

Contracts (`require` / `ensure`) will be integrated with errors later.
