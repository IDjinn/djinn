# showcase

One front end (`src/app.djinn`) built for two platforms: a native Windows window (drawn by the framework with Vulkan
or the software rasterizer) and a web page (compiled to JavaScript). Only the entry point differs, through platform
files: `main.windows.djinn` opens the window, `main.web.djinn` mounts the app in the page, `main.djinn` prints the
page elsewhere.

```
djinnc examples/showcase -o build/showcase/showcase.exe --lib-dir <libs>               # Windows
djinnc examples/showcase --target web -o build/showcase/showcase --lib-dir <libs>      # build/showcase/showcase.js
```

`index.html` loads `showcase.js`; serve the folder with every path answered by `index.html` so the routes work.
`showcase.exe --html <route>` prints the tree the native build makes, and `DJINN_UI_SHOT=file.ppm` (with
`DJINN_UI_ROUTE`, `DJINN_UI_H`) renders one frame without a window. `tests/djinnc/showcase.sh` checks that every route
builds the same tree natively and on the web.
