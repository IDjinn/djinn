# djinn-lsp

Language server for `djinnc`, written in Djinn. Provides diagnostics (lexical lint plus `djinnc --check`), hover, definition, references, rename, completion, signature help, symbols, folding and semantic tokens.

Build (needs a `djinnc` with `--check`, for example the stage2 compiler):

```bash
./build.sh <djinnc> [runtime dir]
```

Tests (need the same compiler in `DJINNC`):

```bash
DJINNC=<djinnc> python tests/smoke.py
```

Full documentation: `docs/content/docs/advanced/language-server.mdx`. The VS Code client lives in `tools/vscode-djinn`.
