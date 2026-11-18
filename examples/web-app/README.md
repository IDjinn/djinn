# web-app

The UI library compiled to JavaScript (`--target web`): components with props and children, signals and memos,
`if` / `for` / keyed lists, two-way binding, batching, the router and the theme.

```
djinnc libs/ui_macros -o build/libs/ui_macros.djlib --std-dir std
djinnc examples/web-app --target web -o build/web-app/app --lib-dir build/libs
```

That writes `build/web-app/app.js`, the program, and `build/web-app/djinn.<hash>.js`, the runtime it imports (see
"The web target" in `djinnc/USAGE.md`); open it from a page with `<script type="module" src="app.js"></script>`
(`index.html` here). `tests/djinnc/web.sh` drives it on a fake DOM under Node.js.
