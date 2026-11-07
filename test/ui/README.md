# PyChart webview UI harness

Runs the built PyChart webview (`webview/index.html` + `dist/webview/bundle.js` + `webview/index.css`) in headless Chrome, under the real CSP, with a fake `acquireVsCodeApi`, and drives it with the same messages VS Code sends.

## Run

```
npm run test:ui   # builds the webview, then runs test/ui/run.mjs; exit code 0 = all checks passed
```

- `PYCHART_CHECKOUT` env var: checkout to test (default: this repo; it must be built so `dist/webview/bundle.js` exists). The fixture is `test/ui/fixtures/demo.py`.
- `CHROME` env var: Chrome/Edge executable (default: found automatically in the usual install paths; if none is found the run prints `SKIP` and exits 0).
- `node test/ui/server.mjs` serves the harness alone at http://127.0.0.1:5173/harness.html to poke at by hand. In the devtools console, post messages with `postMessage({type:"setCode", code, offset}, "*")` and read what the page sent from `__posted`.

Output: PASS/FAIL per check on stdout, `test/ui/results.json`, and screenshots in `test/ui/shots/` (both gitignored).

## What it checks

| # | Check |
|---|-------|
| R | Time from the `setCode` post to the SVG in the DOM, median of 5. This includes the 50 ms debounce. |
| 1 | Pan/zoom transform of `.cfg-root`: wheel pans, Ctrl+wheel zooms and keeps the point under the mouse fixed, drag pans, Fit, and the `+` / `-` / `0` keys |
| 2 | Clicking the `if s < 0` node posts `reveal` with that node's `data-from` / `data-to` (after the revealRange rule). A drag that starts on the node posts no reveal. |
| 3 | `setCursor` puts `is-current` on exactly the expected node, at 3 offsets, with LF and then with CRLF text. The time is measured with a MutationObserver. |
| 4 | Follow cursor: classify, then `Cart.add_item` (title and nodes change). The Whole file option shows a `Module (whole file)` title and def nodes. |
| 5 | An edit inside classify while zoomed adds a node and keeps the transform. Moving the offset to `load` refits. |
| 6 | Functions mode: all 5 user functions are present, the edge count is reported, and `__state.mode` is `"functions"`. |
| 7 | Dark Modern / Light Modern variable sets, switched by the body class: computed colours, WCAG text contrast of at least 4.5:1, and edge-to-background contrast of at least 3:1 |
| 8 | Functions view clean-up: built-ins hidden by default; the toggle shows them again |
| 9 | Hover hints on boxes and controls |
| 10 | `?` cheat sheet: opens, traps keys (no zoom behind it), Esc closes and returns focus |
| 11 | First-run tip banner: shown once, dismissible, and the diagram refits when it shows or hides |
| 12 | Webview state writes are merged (no write drops another field) |
| R1 | ▶ Run posts `run` and shows "Running…" |
| R2 | A `trace` message starts replay: run bar shown, first step highlighted |
| R3 | Play advances at the chosen speed; pause stops it |
| R4 | Scrubbing into `classify` switches to that function's graph and highlights the right node |
| R5 | Variables strip shows the step's locals and marks the changed ones |
| R6 | Output pane holds the program's full stdout at the last step |
| R7 | Visit-count badge on the `for` loop equals its visit count |
| R8 | An edit ends replay: run bar hidden, "Code changed" banner, live graph back, no run marks left |
| R9 | Same-scope step update p95 < 16 ms |
| R10 | No console errors or CSP violations during run mode |
| C | No console errors, page errors, failed requests or `securitypolicyviolation` events during the whole run |

## How the harness stands in for the host

`server.mjs` fills the `index.html` placeholders the way `extension.js` does: `cspSource` is the server origin and the nonce is fixed. It keeps the CSP meta as it is. It then adds a nonce'd shim script before the bundle, plus a `<style>` with the theme variables.

## Limits

This is Chrome, not the VS Code webview host. Theme variables, focus handling, real editor offsets and the host's `reveal` handling are not exercised.
