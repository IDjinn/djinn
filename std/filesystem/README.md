# std::filesystem

Capability-based filesystem API. Every fallible call returns `result<T, FsError>`; `FsError` catalogues the POSIX and
Windows failures (`error.djinn`). Operations that return nothing use `result<bool, FsError>` with `Ok(true)`.

| Type | Role |
|---|---|
| `Path` | Validated path text (borrowed `str`). `Path.parse` rejects empty and `..` components, NUL/control characters, `\ : < > " \| ? *`, Windows device names (`CON`, `COM1`...) and components ending in `.` or space. |
| `Directory` | Capability. All relative operations resolve from its handle; the only way to get the first one is `Directory.open_root`, the single entry of ambient authority. Closed on scope exit. |
| `File` | An already-open regular file (FIFOs, devices and directories are refused). Reads, writes, `seek`, `truncate`, `sync` and `metadata` use the handle, never a path. Closed on scope exit. |
| `OpenOptions` | `read`, `read_write`, `create`, `create_new`, `append`, `following_symlinks()`, `with_mode()`. |
| `Metadata`, `FileKind`, `DirEntries`, `DirEntry` | Results of `metadata`, `entries`. |

## Guarantees

- **No path traversal.** `..` cannot be parsed, relative operations reject absolute paths (`AbsolutePath`), and the
  runtime re-validates every path it receives.
- **No TOCTOU.** There is no `exists()`; use `open_*` and handle `NotFound`. Paths are walked one component at a time
  with `openat`/`NtCreateFile` relative to the parent handle, never as a whole string.
- **Links are refused by default.** A symlink (or Windows junction) at any component fails with `SymlinkRefused`.
  The `*_following` variants and `OpenOptions.following_symlinks()` opt in; then the walk may leave the directory,
  because the link target decides where it ends up.
- **Atomic replace.** `Directory.write_atomic` writes a temporary file beside the target, syncs it and renames it over
  the target. `rename(..., replace: false)` fails with `AlreadyExists` instead of overwriting.
- **`create_new`** is `O_EXCL` / `FILE_CREATE`: it never opens an existing file.

## Async by default

Every operation that touches the disk is `async`: it queues the blocking call on a small worker pool in the runtime
(`__djinn_fs_submit`, 4 threads, started on first use) and suspends the coroutine until the worker is done, so the
scheduler never blocks on the filesystem.

```djinn
result<File, FsError> file = await dir.open_file(path, OpenOptions.read());
```

The blocking versions keep the same name with a `_sync` suffix (`open_file_sync`, `read_to_string_sync`,
`sync_sync`...) and run on the calling thread; use them outside coroutines. `Path`, `OpenOptions`, `Metadata` and
`DirEntries.next` do no I/O and are plain functions.

A request keeps raw pointers (`Path` text, read/write buffers) until it finishes: keep them alive across the `await`.

## Low level

`std::filesystem::native` holds the `extern "C"` bindings to `runtime/fs_safe.c` and `Native`, thin `unsafe` wrappers over
raw `i64` handles. Nothing there validates paths or owns handles. (The namespace is not called `unsafe` because
`unsafe` is a keyword.)

## Limits

- `Path` borrows its text; keep the `str` alive. There is no owned path type or `join` yet.
- Directory listings are read in full by `entries()`.
- The worker pool has a fixed size and the coroutine polls its request once per scheduler turn.
- `Directory.open_root` follows links in the leading part of an absolute path (`/tmp` on macOS); only the final
  component is checked.
- The POSIX half of `runtime/fs_safe.c` (`openat`, `fstatat`, `renameat`...) was written and tested on Windows only; its first
  real run is the Linux CI job.
