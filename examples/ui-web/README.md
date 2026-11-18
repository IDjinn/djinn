# ui-web

One Djinn program built twice: natively it is the server, and with `--target web` it is the JavaScript of its
`[Client]` islands (`Counter`, `TodoList`, `ThemeButton`). The pages are HTML written by the server; the browser takes
over each island when its `load:` says (see `libs/ui/README.md`, "On the web"). No WebAssembly.

```
djinnc libs/ui_macros -o build/libs/ui_macros.djlib --std-dir std
djinnc libs/ui -o build/libs/ui.djlib --std-dir std
djinnc libs/ui -o build/libs/web/ui.djlib --std-dir std --target web
djinnc examples/ui-web -o build/site/server --std-dir std
djinnc examples/ui-web -o build/site/public/app --std-dir std --target web      # app.js + djinn.<hash>.js
cd build/site
./server --serve 8080 --public public     # http://127.0.0.1:8080/
./server --out out --public public        # out/index.html, out/todos/index.html, out/about/index.html
```

A static site needs `app.js` and `djinn.<hash>.js` at its root (copy `public/*` into `out/`) and any static file server.
The counter starts at 5 because the server sent `data-props="{&quot;start&quot;:5}"`.
