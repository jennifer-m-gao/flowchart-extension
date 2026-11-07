# Plan 013: The Flow view shows the control-flow graph of the function under the cursor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, debounce values, timings) in your report's METRICS section,
> with the command used (the reviewer copies them into `plans/METRICS.md`). Measure "before" on your base commit.
>
> **Drift check (run first, after Step 1's checkout)**:
> `git diff --stat 617cf26..HEAD -- extension.js webview/index.html webview/main.js test/extension.test.js`
> Expected: `webview/main.js` changed **only** by plan 012 (Functions mode now calls `renderGraph(functionGraph(...))`).
> `extension.js`, `index.html` and `test/extension.test.js` are unchanged. Anything else: compare with "Current state"; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/012-elk-svg-renderer.md (and through it 010 + 011)
- **Category**: direction (1.1 feature)
- **Executor model**: sonnet / medium
- **Planned at**: commit `617cf26` (1.0.1 tip), 2026-11-05

## Why this matters

This is the moment PyChart becomes the product we decided on. "Timeline" (a flat list) is replaced by **Flow**: a real
control-flow graph of **the function your cursor is in**, which updates as you move between functions. A "Whole file"
toggle shows module-level flow, with function definitions collapsed. From `plans/DECISIONS.md`:
- D2: the control-flow graph "replaces Timeline".
- D7: "the control-flow view follows the cursor (the function it's in, or module-level code), with a whole-file toggle".
- D10: "the panel holds a stack of views … 1.1 ships with one cursor-following view, and drill-down later just pushes more views".
- D14: "the total deliberate delay goes down to ≤ 150 ms (host 100 ms + webview 50 ms)".

The key performance rule is that **moving the cursor within the same function must not re-layout**. Layout is the expensive
stage (~150 ms for a big function). Plan 014's cursor highlighting depends on cursor moves being cheap.

## Current state

**Host** (`extension.js` at 617cf26):
```js
// :10-13
	let panel;
	let webviewReady = false;
	let updateTimer;
	let sourceDocument = vscode.window.activeTextEditor?.document;
// :36-39 (end of updatePanel)
		panel.webview.postMessage({
			type: 'setCode',
			code: sourceDocument.getText()
		});
// :103-108
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === sourceDocument) {
				clearTimeout(updateTimer);
				updateTimer = setTimeout(updatePanel, 150);
			}
		}),
```
`panel.onDidDispose` (lines 85–92) already does `clearTimeout(updateTimer)` and disposes `panelDisposables`.

**Webview HTML** (`webview/index.html:13-20`):
```html
    <footer class="diagram-toolbar">
      <label for="diagram-mode">Mode</label>
      <select id="diagram-mode">
        <option value="functions">Functions</option>
        <option value="timeline">Timeline</option>
      </select>
      <div id="time-track" aria-label="Diagram updates">0</div>
    </footer>
```

**Webview** (`webview/main.js` at 617cf26; plan 012 changed only the Functions branch of `renderCurrentCode`):
```js
// :11-18
const savedState = vscode.getState();
if (savedState?.mode) {
  modeSelector.value = savedState.mode;
  if (modeSelector.value === "") {
    modeSelector.value = "functions";
  }
}
let diagramMode = modeSelector.value;
// :24-28
modeSelector.addEventListener("change", () => {
  diagramMode = modeSelector.value;
  vscode.setState({ mode: diagramMode });
  renderCurrentCode();
});
// :30-36
window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "setCode") {
    currentCode = message.code;
    renderRevision++;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(renderCurrentCode, 100);
```
The "ready" handshake (`vscode.postMessage({ type: "ready" })` at the end of main.js) must be kept.

**Modules available in your base**:
- `webview/cfg/findScope.js` (plan 011; read it): `findScope(tree, code, offset)` → `{ node, kind: "function" | "module", name, qualifiedName }`.
  `node` is a Lezer `FunctionDefinition` or the `Script` top node; module → `name`/`qualifiedName` = `"<module>"`.
- `webview/cfg/buildCfg.js` (plan 010): `buildCfg(scopeNode, code)` → `{ nodes, edges }`.
- `webview/render/renderGraph.js` (plan 012): `renderGraph(graph)` → `Promise<svgString>`.

**Offsets**: VS Code's `document.offsetAt(position)` counts UTF-16 code units over `document.getText()`, including `\r` in CRLF
files. Lezer offsets index the same JS string the webview parses. They match as long as the webview parses exactly the
text the host sent. Do not normalise line endings anywhere.

**Integration test** (`test/extension.test.js:19-20`) asserts `<option value="functions">` and `<option value="timeline">`.

Conventions: `extension.js` is CommonJS with tabs and single quotes. `webview/*.js` are ESM with 2-space indent and double quotes. Tests:
`test/unit/*.test.mjs` with `node:test`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `npm run test:unit` | `ℹ fail 0` |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build:webview` | exit 0 |

**Do NOT run `npm test`** (the disk is nearly full; the reviewer runs the VS Code integration tests). On `ENOSPC`, STOP.

## Scope

**In scope**: `extension.js`, `webview/index.html`, `webview/index.css` (toolbar additions only), `webview/main.js`,
`webview/viewStack.js` (create), `webview/viewState.js` (create), `test/unit/viewStack.test.mjs` (create),
`test/unit/viewState.test.mjs` (create), `test/extension.test.js`. Delete `webview/parser.js` and `test/unit/parser.test.mjs`.

**Out of scope**:
- `webview/render.js` / Mermaid, `escapeLabel.js`, `functionParser.js#parseFunctions`: plan 015 deletes them. Timeline was the
  last Mermaid user in `main.js`, so after this plan `main.js` no longer imports `render.js`, but leave the file in place.
- Click-to-source, cursor highlighting, pan/zoom: plan 014. This plan just delivers the cursor offset into the webview and stores it.
- `webview/cfg/*`, `webview/render/*`: don't change them.
- Drill-down (clicking a function to push a view): out of 1.1; the view stack only needs depth 1 now.

## Git workflow

- Branch: `git checkout -b advisor/013-flow-view <base>` (the reviewer names `<base>`, normally plan 012's branch), then `npm ci`.
- Commits: e.g. `Added Flow view that follows the cursor`. Do NOT push.

## Steps

### Step 1: Branch, install, baseline
Checkout, `npm ci`, drift check. **Verify**: `npm run test:unit` → `ℹ fail 0` (record the counts).

### Step 2: Pure view modules + tests (write the tests first)

`webview/viewStack.js`:
```js
export function createViewStack(initial) { ... }
// returns { current(), push(view), pop(), replace(view), depth() }
// pop() never removes the last view (returns current unchanged at depth 1)
```
Views are plain objects: `{ kind: "flow", follow: true }` (follow the cursor), `{ kind: "flow", follow: false }` (whole file),
`{ kind: "functions" }`.

`webview/viewState.js`:
```js
export function migrateMode(saved)    // "timeline" → "flow"; "flow"/"functions" unchanged; anything else → "flow"
export function scopeKey(scope)       // `${scope.kind}:${scope.qualifiedName}:${scope.node.from}:${scope.node.to}`
export function shouldRender(prev, next)
// prev/next: { code, viewKind, follow, scopeKey } (prev may be null)
// → true if prev is null, or code/viewKind/follow differ, or (viewKind === "flow" && scopeKey differs)
// → false otherwise (a cursor move inside the same function)
```
Tests:
- `viewStack.test.mjs`: push/pop/replace/depth; pop at depth 1 keeps the view.
- `viewState.test.mjs`:
  - `migrateMode` for timeline/flow/functions/undefined/"bogus";
  - `shouldRender` returns false for the same code and same scope with a different cursor, true for a changed code, true for a
    changed scopeKey in flow, and false for a changed scopeKey in functions view;
  - `scopeKey` built from a real `findScope` result on `"def a():\n  x = 1\ndef b():\n  y = 2\n"` at offsets inside a and inside b gives different keys,
    and two offsets inside a give the same key.

**Verify**: `npm run test:unit` → `ℹ fail 0`.

### Step 3: Toolbar markup

`webview/index.html`: replace the select options with
```html
        <option value="flow">Flow</option>
        <option value="functions">Functions</option>
```
(Flow first, so it's the default) and add after the `</select>`:
```html
      <label class="whole-file"><input type="checkbox" id="whole-file"> Whole file</label>
      <span id="scope-title" aria-live="polite"></span>
```
Keep `#time-track`. In `index.css`, add minimal styles for `.whole-file` (inline-flex, gap 4px, align center) and `#scope-title`
(`color: var(--vscode-foreground); font-weight: 600;`).
Update `test/extension.test.js`: replace the `timeline` assertion with `assert.match(html, /<option value="flow">/);` and add
`assert.match(html, /id="whole-file"/);`.
**Verify**: `grep -c timeline webview/index.html test/extension.test.js` → `0` for both.

### Step 4: Host sends the cursor offset

In `extension.js`:
- Add `let cursorTimer;` next to `updateTimer`, and a helper:
  ```js
	const sourceOffset = () => {
		const editor = vscode.window.visibleTextEditors.find(e => e.document === sourceDocument);
		return editor ? sourceDocument.offsetAt(editor.selection.active) : 0;
	};
  ```
- `updatePanel`'s `setCode` message becomes `{ type: 'setCode', code: sourceDocument.getText(), offset: sourceOffset() }`.
- Change the text-change debounce from `150` to `100` (D14).
- Add to the `context.subscriptions.push(...)` block:
  ```js
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (!panel || !webviewReady || event.textEditor.document !== sourceDocument) {
				return;
			}
			clearTimeout(cursorTimer);
			cursorTimer = setTimeout(() => {
				if (panel && webviewReady) {
					panel.webview.postMessage({ type: 'setCursor', offset: sourceDocument.offsetAt(event.selections[0].active) });
				}
			}, 50);
		}),
  ```
- In `panel.onDidDispose`, also `clearTimeout(cursorTimer);`.

**Verify**: `npm run lint` → exit 0. `grep -n "setTimeout(updatePanel, 100)" extension.js` → 1 match.
`grep -c "setCursor" extension.js` → 1.

### Step 5: Webview: the Flow view

Rewrite the view logic in `webview/main.js` (keep the ready handshake, the error path and `#time-track` counting):
- Remove the imports of `parseCode` (`./parser.js`) and `renderDiagram` (`./render.js`). Import `findScope`, `buildCfg`,
  `renderGraph`, `functionGraph`, `createViewStack`, `migrateMode`, `scopeKey`, `shouldRender`.
- State: `currentCode`, `cursorOffset`, `cachedTree` (+ `cachedTreeCode`: re-parse only when the code changes), `lastRendered`
  (the `{code, viewKind, follow, scopeKey}` of the last successful render), `views` = a view stack.
- Restore: `const saved = vscode.getState() || {}; modeSelector.value = migrateMode(saved.mode); wholeFile.checked = !!saved.wholeFile;`
  then build the initial view: `modeSelector.value === "functions" ? { kind: "functions" } : { kind: "flow", follow: !wholeFile.checked }`.
  Persist with `vscode.setState({ mode, wholeFile })` on every change of either control (keep the `{ mode }` key; plan 009's notes say a
  future serializer receives this object). Disable the checkbox when the mode is `functions`.
- Messages:
  - `setCode`: set `currentCode` and `cursorOffset = message.offset ?? 0`, bump the revision, and debounce `update()` by **50 ms** (was 100).
  - `setCursor`: set `cursorOffset`, then call `update()` immediately (no debounce; it's cheap when the scope hasn't changed).
  - `setMessage`: unchanged.
- `update()`:
  1. `tree` = cached parse of `currentCode`.
  2. If the view is functions: `next = { code, viewKind: "functions", follow: false, scopeKey: "" }`, `graph = () => functionGraph(tree, code)`.
  3. If flow: `scope = view.follow ? findScope(tree, code, cursorOffset) : { node: tree.topNode, kind: "module", name: "<module>", qualifiedName: "<module>" }`;
     `next = { code, viewKind: "flow", follow: view.follow, scopeKey: scopeKey(scope) }`; `graph = () => buildCfg(scope.node, code)`;
     set `#scope-title` to `scope.qualifiedName === "<module>" ? "Module" : scope.qualifiedName`, plus `" (whole file)"` when `!view.follow`.
  4. If `!shouldRender(lastRendered, next)`: return. (Plan 014 hooks highlighting in here.)
  5. Otherwise: `svg = await renderGraph(graph())`, run the revision check as today, then `display.innerHTML = svg`, `lastRendered = next`, and update the counter.
  6. In the error path, keep the existing behaviour, and set `lastRendered = null` so the next event retries.
- Mode change and checkbox change: `views.replace(newView)`, persist, `lastRendered = null`, `update()`.

**Verify**: `npm run lint` → exit 0. `npm run build:webview` → exit 0. `grep -c "parser.js\|render.js\|parseCode\|renderDiagram" webview/main.js` → `0`.

### Step 6: Delete Timeline
`git rm webview/parser.js test/unit/parser.test.mjs`. Plan 010's `buildCfg` tests cover the `1.1 CFG` todos that lived in
`parser.test.mjs`. `escapeLabel.js` is still used by `parseFunctions`; leave it (plan 015).
**Verify**: `grep -rn "parser.js\|parseCode" webview test --include=*.js --include=*.mjs | grep -v "@lezer"` → no matches.
`npm run test:unit` → `ℹ fail 0` (the test count drops by parser.test's tests; report before/after).

### Step 7: Node smoke check of the decision logic
Run:
```
node --input-type=module -e "import {parser} from '@lezer/python'; import {findScope} from './webview/cfg/findScope.js'; import {scopeKey, shouldRender} from './webview/viewState.js'; const c='def a():\n  x = 1\n  y = 2\ndef b():\n  z = 3\n'; const t=parser.parse(c); const k=o=>scopeKey(findScope(t,c,o)); const p={code:c,viewKind:'flow',follow:true,scopeKey:k(12)}; console.log(shouldRender(p,{...p,scopeKey:k(20)}), shouldRender(p,{...p,scopeKey:k(40)}))"
```
**Verify**: prints `false true` (moving within `a` doesn't re-render; moving to `b` does).

### Step 8: Full gate
`npm run test:unit` → `ℹ fail 0`; `npm run lint` → exit 0; `npm run build:webview` → exit 0; `git status --short` clean after the commits.

## Test plan

- New unit tests: `viewStack.test.mjs`, `viewState.test.mjs` (≥ 10 cases total).
- Integration (reviewer): `test/extension.test.js` with the updated option assertions; all 3 existing tests must pass.
- Manual (reviewer, F5): open a file with 2 functions, open PyChart (Flow is the default), and move the cursor between functions.
  The diagram and title switch, and moving within one function doesn't flicker. Whole file shows Module with collapsed `def`
  nodes. Switch to Functions and back; reload the panel and the mode/checkbox persist.

## Done criteria

- [ ] `webview/parser.js` and `test/unit/parser.test.mjs` are deleted; `main.js` imports neither `parser.js` nor `render.js`
- [ ] `index.html` has `value="flow"` first and `id="whole-file"`; no `timeline`
- [ ] `extension.js`: debounce 100 ms; `setCursor` posted from `onDidChangeTextEditorSelection` (debounced 50 ms); `setCode` includes `offset`
- [ ] Step 7 prints `false true`
- [ ] `npm run test:unit` `ℹ fail 0`; lint and build exit 0
- [ ] METRICS: unit test counts before/after, debounce values before/after (host 150→100, webview 100→50)

## STOP conditions

- `findScope` or `buildCfg` signatures differ from "Current state" (plans 010/011 changed shape). Report them; don't adapt the callers silently.
- Offsets from the host don't line up with Lezer node ranges in a CRLF file. In a quick check, the scope found for an offset in
  function `b` is `a`. Report this; don't normalise text in one place only.
- Keeping the ready handshake seems to need a protocol change.
- `ENOSPC`.

## Maintenance notes

- **Plan 014** adds, in `update()` step 4's "no re-render" branch and after every render: `highlight(nodeAtOffset(...))`. It also adds `reveal` messages and pan/zoom.
- **Drill-down (post-1.1, D7)**: `views.push({ kind: "flow", follow: false, scope: qualifiedName })` from a click on a Functions-mode
  node, plus a back button calling `views.pop()`. The stack is ready; `update()` just needs to honour a fixed `scope` field.
- The view state object `{ mode, wholeFile }` is what a future `WebviewPanelSerializer` receives; keep its keys stable.
- The debounce chain is now host 100 ms + webview 50 ms (D14). The < 300 ms target measures the pipeline after these.
