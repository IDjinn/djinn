# showcase

One front end (`src/app.djinn`) built for two platforms: a native Windows window (drawn by the framework with Vulkan
or the software rasterizer) and a web page (compiled to JavaScript). Only the entry point differs, through platform
files: `main.windows.djinn` opens the window, `main.web.djinn` mounts the app in the page, `main.djinn` prints the
page elsewhere.

```
djinnc examples/showcase -o build/showcase/showcase.exe --lib-dir <libs>               # Windows
djinnc examples/showcase --target web -o build/showcase/showcase --lib-dir <libs>      # build/showcase/showcase.js
```

On Android the same pages run from `examples/showcase-android` (its `djinn.proj` lists the shared sources and only `main.djinn` is its own):

```
bash tools/android_build.sh examples/showcase-android --out build/android --abi x86_64 --apk
```

The Virtual list page uses `VirtualList` (`virtual.djinn`), native and web: only the rows in view are in the tree; the Motion page shows `@keyframes` (rotate, translate, scale, opacity) and a color transition.

`index.html` loads `showcase.js`; serve the folder with every path answered by `index.html` so the routes work.
`showcase.exe --html <route>` prints the tree the native build makes, and `DJINN_UI_SHOT=file.ppm` (with
`DJINN_UI_ROUTE`, `DJINN_UI_H`) renders one frame without a window. `tests/djinnc/showcase.sh` checks that every route
builds the same tree natively and on the web.

## Dev tools

`DJINN_UI_DEVTOOLS=1 showcase.exe` shows a text UI (std `Spectre`, `libs/win32/src/devtools.djinn`) in the console of the
native build: frames per second and a sparkline of the last frames, the time of each stage of a frame (layout and paint,
draw, present) against the 16.7 ms of 60 fps, process CPU (user and kernel), working set, peak and private memory, the heap
(`__djinn_alloc_stats` in the runtime: bytes alive and peak, blocks alive and how fast they grow, allocations per second and
per frame, the worst frame, and how much of the private memory the allocator never saw: GPU driver, system libraries), what the ui keeps (`UiMemory.report`: the tree, the font table and atlas, the cascade and its stylesheets, the reserved vertices), the size
of the scene, and how long the start-up stages took (mount, window, GPU, first frame). It redraws twice a second on the
console's alternate screen and gives the console back when the window closes.
