# Plan 014: The graph is interactive: click to jump, cursor highlight, pan and zoom

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (timings, test counts, coverage) in your report's METRICS section with
> the command used (the reviewer copies them into `plans/METRICS.md`). Measure "before" on your base commit.
>
> **Drift check (run first, after Step 1's checkout)**:
> `git diff --stat 617cf26..HEAD -- extension.js webview/main.js webview/index.html webview/index.css`
> Expected: all four were changed by plans 012/013. Confirm instead that the base contains what "Current state" lists
> (the `setCursor` message, `update()` with `shouldRender`, `renderGraph`, and `.cfg-node` attributes). If any of those are missing, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/013-flow-view-follow-cursor.md (and through it 012, 011, 010)
- **Category**: direction (1.1 feature)
- **Executor model**: opus / high
- **Planned at**: commit `617cf26` (1.0.1 tip), 2026-11-05. The excerpts below describe the code **after** plans 012/013, as specified by those plans.

## Why this matters

The project's founding principle (top of `plans/DECISIONS.md`) is: *"What makes our product strong is that the graphs should
be interactive."* D9 lists the 1.1 interactions: **click a node to jump to its source line, highlight the node for the
cursor's line, pan and zoom**. "Every graph node carries its source range … That one field powers click-to-source, cursor
highlighting and step-through." This plan wires those three, keeping all the logic in pure, unit-tested functions and the DOM
glue thin. The highlight must be cheap (no re-layout). That is why plan 013 made cursor moves within a function skip rendering.

## Current state (after plans 012 + 013, verify in your base)

- `webview/render/toSvg.js` emits, per node:
  `<g class="cfg-node cfg-node--<kind>[ is-unreachable]" data-id="…" data-kind="…" [data-from="…" data-to="…"] transform="translate(x,y)" tabindex="0" role="button" aria-label="<kind>: <label>">`.
  It emits exactly one `<g class="cfg-root" transform="translate(16,16)">` inside `<svg class="cfg" viewBox=… width=… height=…>`.
  Externals in Functions mode have **no** `data-from`/`data-to`.
- `webview/main.js` (plan 013): holds `currentCode`, `cursorOffset` and `lastRendered`, and has an `update()` that
  1) parses (cached), 2) computes the view's scope and `next`, 3) **returns early when `!shouldRender(lastRendered, next)`**, and
  4) otherwise `display.innerHTML = await renderGraph(graph)`. It handles `setCode` (debounced 50 ms), `setCursor` (immediate) and `setMessage`.
  Find the exact names in your base: `grep -n "shouldRender\|setCursor\|renderGraph\|display.innerHTML" webview/main.js`.
- `extension.js` (plan 013): `onDidReceiveMessage` handles `ready` only:
  ```js
		panel.webview.onDidReceiveMessage(message => {
			if (message.type === 'ready') {
				webviewReady = true;
				updatePanel();
			}
		}, undefined, panelDisposables);
  ```
  It has a `sourceDocument` variable and the `sourceOffset()` helper using
  `vscode.window.visibleTextEditors.find(e => e.document === sourceDocument)`.
- `webview/index.css` (617cf26 + plan 012): `#display { … padding: 24px; overflow: auto; }` and `#display svg { display: block; … margin-inline: auto; }`.
- Graph node contract (plan 010): `{ id, kind, label, from, to, unreachable? }`. `start` in module scope is `0/0`; `end` is `to/to`
  (zero-width); a function scope's `start` covers the `def …` header; clause nodes cover the header line only; `def` nodes cover the whole definition.
- Messages from the webview are **untrusted input** for the host: validate types and ranges.

Conventions: as before (`extension.js` CommonJS/tabs/single quotes; webview ESM/2 spaces/double quotes; tests `test/unit/*.test.mjs`).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `npm run test:unit` | `ℹ fail 0` |
| Coverage | `node --test --experimental-test-coverage "test/unit/*.test.mjs"` | new modules ≥ 90% lines |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build:webview` | exit 0 |

**Do NOT run `npm test`** (the disk is nearly full; the reviewer runs it). On `ENOSPC`, STOP.

## Scope

**In scope**: `webview/interact/nodeAtOffset.js`, `webview/interact/revealRange.js`, `webview/interact/viewport.js` (create);
`test/unit/nodeAtOffset.test.mjs`, `test/unit/revealRange.test.mjs`, `test/unit/viewport.test.mjs` (create);
`webview/main.js`, `webview/index.html` (a Fit button), `webview/index.css`, `extension.js` (the `reveal` handler only).

**Out of scope**: `webview/render/*` (no changes; if an attribute you need is missing, STOP), `webview/cfg/*`, Mermaid
cleanup (plan 015), collapse/expand and step-through (1.2), drill-down on Functions-mode click (post-1.1).

## Git workflow
- Branch: `git checkout -b advisor/014-interactions <base>` (the reviewer names it; normally plan 013's branch), then `npm ci`.
- Commits, e.g. `Added click-to-source and cursor highlight`, `Added pan and zoom`. Do NOT push.

## Steps

### Step 1: Branch, install, baseline
Checkout, `npm ci`, drift/contents check. **Verify**: `npm run test:unit` → `ℹ fail 0` (record the counts).

### Step 2: `nodeAtOffset` (pure, tests first)
```js
// webview/interact/nodeAtOffset.js
export function nodeAtOffset(nodes, offset, code) { ... } // → node id or null
```
Rules, in order:
1. Candidates: nodes with numeric `from`/`to`, `to > from`, and `from <= offset < to`. Return the id of the one with the **smallest** `to - from`.
   On a tie, take the later node in the array.
2. If there are none, use a line fallback: the line containing `offset` (computed from `code`; `\n` delimits lines, so `\r\n` works).
   Among nodes with `to > from` whose `from` lies on that line, return the one with the smallest `from`. This handles the cursor
   sitting in indentation before a statement, or at the end of a line just after a statement.
3. Otherwise return `null`.

Tests (`nodeAtOffset.test.mjs`) use real `buildCfg` output:
- a cursor inside `x = 1` in a function returns that statement's id;
- a cursor inside an `if` body's statement returns the statement, not the `if` decision (the smallest span wins);
- a cursor on the `if a:` header returns the decision;
- a cursor in the leading indentation of a line returns that line's statement;
- a cursor on a blank line returns `null`;
- a CRLF source works;
- zero-width `end` is never returned;
- in module scope, a cursor anywhere inside a nested function returns the collapsed `def` node.

### Step 3: `revealRange` (pure, tests first)
```js
// webview/interact/revealRange.js
export function revealRange(code, from, to) { ... } // → { from, to }
```
If `[from, to)` lies on a single line (no `\n` in `code.slice(from, to)` after trimming one trailing newline), return it
unchanged (select the statement). Otherwise return `{ from, to: from }` (caret at the start of a multi-line node, such as a `def`).
Clamp both to `[0, code.length]` and make sure `from <= to`.
Tests: single-line statement; multi-line def → caret; out-of-range values clamped; `from > to` is swapped.

### Step 4: `viewport` (pure, tests first)
```js
// webview/interact/viewport.js
export const MIN_SCALE = 0.2, MAX_SCALE = 4;
export function identity() { return { scale: 1, tx: 0, ty: 0 }; }
export function zoomAt(v, factor, px, py) { ... }   // keeps (px,py) fixed on screen; clamps scale
export function panBy(v, dx, dy) { ... }
export function fit(contentW, contentH, viewW, viewH, padding = 16) { ... } // scale = clamp(min(1, (viewW-2p)/contentW, (viewH-2p)/contentH)); centred
export function toTransform(v) { return `translate(${v.tx},${v.ty}) scale(${v.scale})`; }
```
`zoomAt`: `s2 = clamp(v.scale * factor)`, `tx2 = px - (px - v.tx) * (s2 / v.scale)`, and the same for `ty`.
Tests: the zoom-about-point invariant (the content point under (px,py) is the same before and after); clamping at both ends; pan is
additive; fit centres a small graph at scale 1 and shrinks a large one; `toTransform` formats.

**Verify after Steps 2–4**: `npm run test:unit` → `ℹ fail 0`. Coverage of the three modules ≥ 90% lines (report).

### Step 5: Host handles `reveal`
In `extension.js`'s `onDidReceiveMessage`, add:
```js
			} else if (message.type === 'reveal' && sourceDocument
				&& Number.isInteger(message.from) && Number.isInteger(message.to)) {
				const length = sourceDocument.getText().length;
				const from = Math.max(0, Math.min(message.from, length));
				const to = Math.max(from, Math.min(message.to, length));
				const editor = vscode.window.visibleTextEditors.find(e => e.document === sourceDocument);
				const range = new vscode.Range(sourceDocument.positionAt(from), sourceDocument.positionAt(to));
				vscode.window.showTextDocument(sourceDocument, {
					viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One,
					selection: range,
					preserveFocus: false
				}).then(shown => shown.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport));
			}
```
(Keep the `ready` branch first and unchanged.)
**Verify**: `npm run lint` → exit 0.
Note: the selection change triggers `setCursor`, which highlights the clicked node, which keeps the panel consistent. When the
user clicks a `def` node in module (whole-file) view, the caret lands on the def. That's in function scope, but whole-file
view doesn't follow, so nothing jumps. In follow mode, clicking a `def` moves the caret into that function, and the Flow
view switches to it. That gives drill-down for free; it's intended.

### Step 6: Webview: highlight + click + keyboard

In `webview/main.js`:
- Keep `currentGraph` (the graph object last rendered).
- `highlight()`: `const id = nodeAtOffset(currentGraph.nodes, cursorOffset, currentCode)`. Remove `.is-current` from the previously
  highlighted element, then add it to `display.querySelector(`.cfg-node[data-id="${CSS.escape(id)}"]`)` if `id` is set. Call
  `highlight()` (a) in `update()`'s early-return branch (no re-render) and (b) right after every successful render. Wrap it with
  `performance.now()` and keep the last duration in a module variable `lastHighlightMs` (for the metric; `console.debug` it).
- Click: one delegated `click` listener on `#display`. `const g = event.target.closest(".cfg-node[data-from]")`. If found and the
  pointer didn't drag (Step 7), post `{ type: "reveal", ...revealRange(currentCode, +g.dataset.from, +g.dataset.to) }`.
- Keyboard on nodes: `keydown` delegated. On a focused `.cfg-node[data-from]`, `Enter` or `Space` → the same reveal (and `preventDefault`).
- CSS: `.cfg-node.is-current rect, .cfg-node.is-current polygon { stroke: var(--vscode-editorCursor-foreground, var(--vscode-focusBorder)); stroke-width: 2.5; }`
  and `.cfg-node[data-from] { cursor: pointer; }`.

### Step 7: Webview: pan, zoom, fit

- CSS: change `#display` to `padding: 0; overflow: hidden; position: relative;`, and make the rendered `svg.cfg` fill the display
  (`width: 100%; height: 100%;`). After render, remove the `width`/`height` attributes from the svg element so CSS sizing applies, and
  keep the `viewBox` only to read the content size (`svg.viewBox.baseVal.width/height`), then **remove** it too. The
  transform below handles placement.
- Keep `let view = identity()`. Apply it with `root.setAttribute("transform", toTransform(view))` on `.cfg-root`.
  Plan 012 set `translate(16,16)` there; it's replaced.
- After a render: if the scope/view changed (the `scopeKey` or view kind differs from the previous render), or this is the
  first render, `view = fit(contentW, contentH, display.clientWidth, display.clientHeight)`. Otherwise (the same function was
  re-rendered after an edit) **keep `view`**, so the diagram doesn't jump while typing.
- Wheel on `#display`: `preventDefault()` (register with `{ passive: false }`). If `event.ctrlKey` (a trackpad pinch sets it), zoom about
  the pointer: `zoomAt(view, Math.exp(-event.deltaY * 0.01), x, y)`, with x/y relative to `#display`. Otherwise pan by
  `(-event.deltaX, -event.deltaY)`.
- Drag to pan: `pointerdown` (primary button) records the start and calls `setPointerCapture`. `pointermove` pans. Track the total movement;
  if it's over **4 px**, set `dragged = true` so the click handler (Step 6) ignores the following click. Reset on the next `pointerdown`.
- Fit button: add `<button id="fit-view" type="button" title="Fit to view">Fit</button>` to the toolbar in `index.html`. On click, run fit and apply.
- Keyboard (on `#display` or document, ignored when focus is in `select`/`input`): `+`/`=` zoom in ×1.2 about the centre, `-` zoom out,
  `0` fit.
- Window `resize`: re-fit only if the user hasn't zoomed or panned since the last fit (track `userMoved`).

**Verify (Steps 5–7)**: `npm run lint` → exit 0. `npm run build:webview` → exit 0. `npm run test:unit` → `ℹ fail 0`.

### Step 8: Metric: highlight cost
In Node, time the pure part on the 200-line fixture (`scripts/fixture200.mjs` from plan 012): build the graph once, then call
`nodeAtOffset` for 1,000 evenly spaced offsets and report the mean µs per call. The DOM class toggle is O(1); the reviewer reads
`lastHighlightMs` from the webview console for the end-to-end number.
**Verify**: prints the mean, which is expected to be well under 1 ms.

### Step 9: Full gate
`npm run test:unit` → `ℹ fail 0`; lint and build exit 0; `git status --short` clean after the commits.

## Test plan

- New unit tests: `nodeAtOffset` (≥ 8 cases), `revealRange` (≥ 4), `viewport` (≥ 6). Coverage ≥ 90% lines for `webview/interact/*`.
- Reviewer (integration, `npm test`): the 3 existing tests still pass.
- Reviewer (manual, F5) checklist, which goes in the PR description:
  1. Click a statement box; the editor selects that line.
  2. Click an `if` diamond; it selects the header.
  3. Move the cursor line by line; the matching box outline follows, with no re-layout flicker.
  4. Ctrl+wheel / pinch zooms about the pointer; drag pans; dragging doesn't trigger a jump.
  5. Fit recentres; typing in the same function keeps the zoom.
  6. Tab to a node and press Enter; it jumps.
  7. In whole-file view, clicking a `def` box jumps to it.

## Done criteria

- [ ] `webview/interact/{nodeAtOffset,revealRange,viewport}.js` exist, are DOM-free, and have unit tests (≥ 90% line coverage)
- [ ] `extension.js` handles `reveal` with integer/range validation; `grep -n "showTextDocument" extension.js` → 1 match
- [ ] `main.js` highlights on `setCursor` without calling `renderGraph` when `shouldRender` is false (`grep` confirms `highlight(` is called in that branch)
- [ ] the `Fit` button exists; wheel/drag/keyboard handlers are registered
- [ ] `npm run test:unit` `ℹ fail 0`; lint and build exit 0
- [ ] METRICS: `nodeAtOffset` mean µs on the 200-line fixture; unit test counts; coverage of the interact modules

## STOP conditions

- The base lacks `data-from`/`data-to`/`data-id` on `.cfg-node`, `.cfg-root`, `setCursor` or `shouldRender`. A prerequisite plan is
  missing or differs. Don't re-implement it here.
- `CSS.escape` is unavailable in the webview build target (lint/build error). Report it; ids are `start|end|n\d+|function\d+|external\d+`,
  so plain interpolation is safe, but say so instead of silently dropping escaping.
- Click-to-source lands on the wrong line in a CRLF file (the reviewer reports this; it's an offset mismatch, and needs investigating, not patching).
- `ENOSPC`.

## Maintenance notes

- **1.2 step-through (D11)** reuses `highlight()` and the `is-current` class: a "next" button walks edges from the current node; at a
  `decision`, the learner picks True/False. Keep `highlight` keyed by node id, not by DOM element.
- **1.2 collapse/expand** changes the graph between renders. `currentGraph` is the single source for hit-testing; keep it in sync.
- **Drill-down (post-1.1)**: in Functions mode, a click could push `{ kind: "flow", scope }` onto the view stack instead of revealing.
  Decide this when designing levels (deferred by the user).
- The host treats `reveal` as untrusted input (it's validated). Keep that if more message types are added.
