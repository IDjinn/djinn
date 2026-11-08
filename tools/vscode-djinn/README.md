# Djinn Language (VS Code)

Syntax highlighting plus language-server support for `.djinn` files: diagnostics from `djinnc --check`, hover, go to definition, references, rename, completion, signature help, outline and semantic highlighting.

Commands: `Djinn: Build`, `Djinn: Build and Run`, `Djinn: Check Project`, `Djinn: Restart Language Server`, `Djinn: Show Language Server Info`. A `djinn` task type with the `$djinnc` problem matcher is also available.

Setup:

1. Build the server: `djinn-lsp/build.sh <djinnc> [runtime dir]`.
2. `npm install` in this folder, then run the extension from VS Code (F5), or package it with `npx @vscode/vsce package` and install the `.vsix`.

The server is found from `djinn.server.path`, this extension's `bin/`, then `djinn-lsp/build` of the workspace. See the `djinn.*` settings for the compiler and runtime paths.
