# ui-web

One Djinn program built twice: natively it is the server, with `--target web` it is the client that hydrates the
server's page in the browser (see `libs/ui/README.md`, "On the web").

```
djinnc libs/ui_macros -o build/libs/ui_macros.djlib --std-dir std
djinnc libs/ui -o build/libs/ui.djlib --std-dir std
djinnc libs/ui -o build/libs/wasm32-unknown-unknown/ui.djlib --std-dir std --target web
djinnc examples/ui-web -o build/site/server --std-dir std
djinnc examples/ui-web -o build/site/public/app.wasm --std-dir std --target web
cd build/site
./server --serve 8080 --public public     # http://127.0.0.1:8080/
./server --out out                        # out/index.html, out/todos/index.html, out/about/index.html
```

A static site needs `djinn.js` and `app.wasm` at its root (copy `public/*` into `out/`) and any static file server.
