# ui-bench

Speed, memory and CPU of the UI pipeline (mount, style + layout, paint, software raster) on a page of N rows.

```
djinnc examples/ui-bench -o ui-bench.exe --link-arg user32.lib --link-arg gdi32.lib --link-arg kernel32.lib
DJINN_BENCH_ROWS=1000 ./ui-bench.exe
```

Medians of 21 runs, 1280x720, Windows, single thread. Memory is the process working set; CPU is user+kernel time.

| rows (dom nodes) | mount | cold frame | warm frame | update + frame | vertices | memory after frame |
|---|---|---|---|---|---|---|
| 100 (909) | 0.2 ms | 41 ms | 0.4 ms | 0.7 ms | 12k | 20 MB |
| 1000 (9009) | 1.5 ms | 285 ms | 1.1 ms | 3.7 ms | 12k | 114 MB |
| 5000 (45009) | 7.6 ms | 1424 ms | 4.4 ms | 18.8 ms | 12k | 520 MB |

Findings and what to do next:

- Paint used to emit every node (2.28M vertices for 1000 rows, 47 ms); it now skips what lies outside the viewport
  (12k vertices, 0.9 ms). Scrolling by a viewport is a repaint, not a relayout.
- The cold frame is style + layout (277 ms of 285 ms for 1000 rows, ~31 us per node). `Styles.collect` matches every
  rule against every element (nodes x rules): bucketing the rules by their rightmost key (id, class, tag) is the fix.
- The working set grows ~11 KB per node after the first frame; the structures (Style 376 B, LayoutBox 84 B, DomNode
  80 B) explain 0.5 KB, so something else is retained per node and needs profiling.
- The software raster costs ~256 ms per 1280x720 frame whatever the vertex count: the GPU renderer replaces it.
- update + frame is 3.7 ms at 1000 rows and grows with the page (18.8 ms at 5000): the paint still walks the whole tree.
