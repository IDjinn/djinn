# djinn-lsp

Language server for `djinnc`, written in Djinn. Provides diagnostics (lexical lint plus `djinnc --check`), hover, definition, references, rename, completion, signature help, symbols, folding and semantic tokens.

Build (needs `clang` and `llvm-ar`, and a `djinnc` recent enough to compile `std`; JSON comes from `std::util::Json`, backed by the runtime's yyjson):

```bash
./build.sh <djinnc> [runtime dir]
```

Tests (need the same compiler in `DJINNC`):

```bash
DJINNC=<djinnc> python tests/smoke.py
```

Full documentation: `docs/content/docs/advanced/language-server.mdx`. The VS Code client lives in `tools/vscode-djinn`.

## Diagnostics

`src/ast/ast.djinn` builds a light syntax tree per file (declarations, bodies as nested blocks, locals, and lexical errors as nodes) from the tokens and the Scanner, once per edit. Rules in `src/diagnostics/rules/` walk it through a `DiagContext` and report findings; the `lint-disable` handling, the severity and the LSP output are not the rule's concern.

To add a diagnostic: create `src/diagnostics/rules/<name>.djinn` (copy `unclosed_bracket.djinn`: a struct with `static unsafe void check(DiagContext* context)`) and add its call to `Diagnostics.run` in `src/diagnostics/registry.djinn`.

A rule can offer a quick fix with its finding: `report` returns the finding, and `item.fix(title, from, to, text)` replaces the bytes `[from, to)` with `text` (an insertion has `from == to`). The editor shows it as a quickfix; see `unmatched_bracket.djinn` and `unterminated_literal.djinn`.

## For agents

The same diagnostics from the command line, with the least text (`DJINNC` or `djinn.compilerPath` finds the compiler; the project is found from the file):

```bash
djinn-lsp diagnostics src/big.djinn [--limit N]   # one line per problem, with a [fix] marker when there is a quick fix
djinn-lsp explain src/big.djinn 3                 # the line with carets, note, help, the suggestion and the edit to apply
```

`diagnostics` prints `#3 13:14 error E1000 Unterminated string literal [fix]`; `explain` is only paid for the problem about to be fixed. The numbers follow the file order and are stable while the file does not change. Exit code: 0 clean, 1 problems, 2 bad arguments or an unreadable file.
