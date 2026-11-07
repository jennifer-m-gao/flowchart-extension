# Plan 019: Clearer boxes, a cleaner Functions view, and controls people can discover

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: report EVERY number you measure (contrast ratios before/after, test counts, bundle bytes, bench, test:ui results, Functions-view node/edge counts) to the reviewer in a METRICS section, with the exact command. The reviewer logs them in `plans/METRICS.md` (the user asked that all metrics be recorded). Measure "before" on the base commit before changing anything.
>
> **Drift check (run first, after Step 1's checkout)**: `git diff --stat e434a2e..HEAD -- webview/index.css webview/index.html webview/main.js webview/functionParser.js webview/render/toSvg.js webview/viewState.js extension.js test/unit/functionParser.test.mjs test/unit/toSvg.test.mjs test/unit/viewState.test.mjs`
> Plan 018 adds only `test/ui/`, `.gitignore`, `README.md` and the package files, so none of these paths should show up. If any do, compare them against the excerpts below; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (second plan of 1.2)
- **Effort**: M
- **Risk**: LOW–MED (touches UI wiring in `main.js` and the host's message handler)
- **Depends on**: plans/018-ui-test-harness.md (`npm run test:ui` is a gate here and is extended)
- **Category**: bug / ux / a11y
- **Executor model**: opus / medium
- **Planned at**: commit `e434a2e` (branch `advisor/017-label-and-version`), 2026-11-06

## Why this matters

The 1.1 UI check found three rough edges, and the user added a requirement:

1. **Faint boxes.** Box borders are 1.72:1 against the background in Dark Modern and 1.67:1 in Light Modern. That's below the 3:1 that WCAG 1.4.11 asks for graphical outlines. In the older Light+ theme, Start/End text is 3.82:1, below 4.5:1.
2. **Noisy Functions view.** `print`, `len`, `open` and `range` show up as boxes, so for a learner the call graph is mostly built-ins.
3. **Missing method arrows.** `self.add()` inside a method draws no arrow to that method, and `Cart()` links to an external "Cart" box instead of `Cart.__init__`.
4. **Hidden controls (D22).** Pan, zoom, click-to-source, Enter and the Fit/+/−/0 keys are invisible unless you already know about them. The user asked that the UI "tell the user what inputs do what".

This plan fixes all four, so 1.2's headline feature (run & replay) starts on a polished base.

## Current state

All excerpts are from `e434a2e`.

**`webview/index.css:86-89`**, the node colours:
```css
.cfg-node rect, .cfg-node polygon { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-editorWidget-border, var(--vscode-contrastBorder, #888)); stroke-width: 1; }
.cfg-node--decision polygon, .cfg-node--loop polygon { fill: var(--vscode-editor-inactiveSelectionBackground); }
.cfg-node--start rect, .cfg-node--end rect { fill: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background)); }
.cfg-node text { fill: var(--vscode-editor-foreground); }
```
Edges already use `--vscode-editorLineNumber-foreground` (line 96).

**Contrast numbers**, computed with the WCAG formula. The harness's check 7 reports the same values for the Modern themes:

| Pair | Ratio |
|---|---|
| now, Dark Modern: border `#454545` vs background `#1f1f1f` | 1.72 |
| now, Light Modern: border `#c8c8c8` vs `#ffffff` | 1.67 |
| proposed, Dark Modern: `editorLineNumber.foreground` `#6e7681` vs `#1f1f1f` | **3.59** |
| proposed, Light Modern: `#6e7681` vs `#ffffff` | **4.59** |
| proposed, Light+: `#237893` vs `#ffffff` | **5.02** |
| now, Light+: Start/End text `#000000` on `button.secondaryBackground` `#5f6a79` | 3.82 |
| proposed, Light+: `button.secondaryForeground` `#ffffff` on `#5f6a79` | **5.49** |
| proposed, Dark Modern: `#cccccc` on `#313131` | 8.10 |
| proposed, Light Modern: `#3b3b3b` on `#e5e5e5` | 8.89 |

**`webview/index.html:13-23`**, the toolbar:
```html
<footer class="diagram-toolbar">
  <label for="diagram-mode">Mode</label>
  <select id="diagram-mode">
    <option value="flow">Flow</option>
    <option value="functions">Functions</option>
  </select>
  <label class="whole-file"><input type="checkbox" id="whole-file"> Whole file</label>
  <button id="fit-view" type="button" title="Fit to view">Fit</button>
  <span id="scope-title" aria-live="polite"></span>
  <div id="time-track" aria-label="Diagram updates">0</div>
</footer>
```
The CSP (line 6) allows `style-src {{cspSource}} 'unsafe-inline'; script-src 'nonce-{{nonce}}'`. No inline event handlers, so wire everything in `main.js`.

**`webview/main.js`, state saving.** This is a bug you must fix in passing:
```js
// main.js:20-23
const saved = vscode.getState() || {};
modeSelector.value = migrateMode(saved.mode);
wholeFile.checked = !!saved.wholeFile;
wholeFile.disabled = modeSelector.value === "functions";
// main.js:57-63
function onControlChange() {
  wholeFile.disabled = modeSelector.value === "functions";
  vscode.setState({ mode: modeSelector.value, wholeFile: wholeFile.checked });
  views.replace(viewFromControls());
  lastRendered = null;
  update();
}
```
`setState` **replaces** the whole state, so any new key (`hideBuiltins`, `tipDismissed`) would be wiped on the next mode change. Every write must merge (Step 3).

**`webview/main.js:121-124`**, how the Functions graph is built:
```js
if (view.kind === "functions") {
  next = { code, viewKind: "functions", follow: false, scopeKey: "", fitKey: "functions" };
  graph = () => functionGraph(tree, code);
  scopeTitle.textContent = "";
```

**`webview/main.js:282-305`**, the keyboard handler:
```js
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const node = target.closest?.(".cfg-node[data-from]");
  if (node && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); reveal(node); return; }
  if (!root || target.closest?.("select, input") || event.ctrlKey || event.metaKey || event.altKey) { return; }
  // + / = zoom in, - zoom out, 0 fit ...
```

**`webview/functionParser.js`.** Read the whole file (117 lines):
- `functionGraph(tree, code)` builds `functions: Map<qualifiedName, { calls: Set<string>, from, to }>` through `findFunctions(cursor, code, functions, scope)`. `scope` is an array of names. Classes extend `scope` but aren't nodes.
- Resolution (line 21): `functions.has(calledName) && !calledName.includes(".") ? nodeIds.get(calledName) : externalIds.get(calledName)`. Unknown names become `external${n}` nodes with `kind: "external"`, `from: null`.
- `collectCalls` (lines 96-117) records only a `CallExpression` whose first child is a `VariableName`. Method calls are ignored.

**Lezer tree shapes** (verified with `@lezer/python` 1.1.19):
```
self.b(1) → CallExpression( MemberExpression( VariableName "self", PropertyName "b" ), ArgList )
cls.a()   → CallExpression( MemberExpression( VariableName "cls",  PropertyName "a" ), ArgList )
Cart()    → CallExpression( VariableName "Cart", ArgList )
```

**`webview/render/toSvg.js:38`**, each node group:
```js
out += `<g class="${cls}" data-id="${xml(node.id)}" data-kind="${xml(node.kind)}"${range} transform="translate(${num(child.x)},${num(child.y)})" tabindex="0" role="button" aria-label="${xml(`${node.kind}: ${node.label}`)}">`;
```
`xml()` escapes `& < > " '`.

**`extension.js:86-103`**, the host message handler: `ready` posts to `updatePanel()`, and `reveal` is validated and moves the editor selection. The host has `context` available inside `activate`.

**Python built-ins.** Python 3.12.3 on this machine, `dir(builtins)`: 158 names, 150 of them not starting with `_`.

**Conventions.** Webview files are ES modules with 2-space indent and double quotes. `extension.js` is CommonJS with tabs and single quotes. Pure logic lives in small modules with `node:test` unit tests in `test/unit/*.test.mjs`. DOM glue stays thin in `main.js`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `npm run test:unit` | `ℹ fail 0` (base: 111 pass) |
| Coverage gate | `npm run test:coverage` | exit 0 |
| Build | `npm run build:webview` | exit 0 |
| Bundle gate | `npm run check:bundle` | exit 0 |
| Bench | `npm run bench` | exit 0, median < 300 ms |
| Lint | `npm run lint` | exit 0 |
| UI tests | `npm run test:ui` | exit 0, every check `[PASS]` |

**Do NOT run `npm test`.** The reviewer runs the VS Code integration tests.

## Scope

**In scope**:
- `webview/index.css`, `webview/index.html`, `webview/main.js`
- `webview/functionParser.js`, `webview/pyBuiltins.js` (create), `webview/render/toSvg.js`, `webview/viewState.js`
- `extension.js` (tip-state messages only)
- `test/unit/functionParser.test.mjs`, `test/unit/toSvg.test.mjs`, `test/unit/viewState.test.mjs`
- `test/ui/run.mjs`, `test/ui/server.mjs` (new checks and a Light+ theme block)

**Out of scope** (do NOT touch):
- `webview/cfg/*` (graph builder, scope finder), `webview/render/toElk.js`, `layout.js`, `webview/interact/*`
- Double-click drill-down (a later plan); only leave the hint hook (Step 6).
- Run & replay (later plans).
- Resolving `obj.method()` on arbitrary objects. That needs type inference; only `self.`/`cls.` and calling a class are in scope.
- `package.json` (no new dependencies or scripts).

## Git workflow

- Branch: `git checkout -b advisor/019-polish-and-discoverability advisor/018-ui-test-harness`. Use the base your reviewer names.
- One commit per step group, short sentence case (e.g. `Raised node border contrast`, `Added hide built-ins toggle`, `Linked self method calls`, `Added controls cheat sheet and first-run tip`).
- Do NOT push.

## Steps

### Step 1: Branch and baseline

`npm ci`, then the drift check. Record the baseline: `npm run test:unit` (pass count), `npm run check:bundle` (bytes), `npm run bench` (median), and `npm run test:ui` (all PASS, with check 7's contrast numbers and check 6's node/edge counts).

**Verify**: `npm run test:ui` → all PASS before you change anything. If not, STOP.

### Step 2: Border and Start/End contrast

In `webview/index.css`:
- Line 86 stroke → `stroke: var(--vscode-contrastBorder, var(--vscode-editorLineNumber-foreground, #888));`. High-contrast themes define `contrastBorder`; the normal themes don't, so they fall back to the line-number grey the edges already use.
- After line 89, add:
  ```css
  .cfg-node--start text, .cfg-node--end text { fill: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground)); }
  ```
  This pairs the secondary-button text colour with the secondary-button background, as VS Code itself does.

Keep the focus and `is-current` stroke rules (lines 93-94) as they are. They come later in the file, so they still win.

In `test/ui/server.mjs`, add a third theme block for the older **Light+** theme, matched with the body classes `vscode-light theme-lightplus`, so the tests cover it:
```css
body.vscode-light.theme-lightplus {
  --vscode-editor-background:#ffffff; --vscode-editor-foreground:#000000; --vscode-foreground:#616161;
  --vscode-descriptionForeground:#717171; --vscode-focusBorder:#0090f1;
  --vscode-editorWidget-background:#f3f3f3; --vscode-editorWidget-border:#c8c8c8;
  --vscode-button-secondaryBackground:#5f6a79; --vscode-button-secondaryForeground:#ffffff;
  --vscode-editor-inactiveSelectionBackground:#e5ebf1; --vscode-editorLineNumber-foreground:#237893;
  --vscode-sideBar-background:#f3f3f3; --vscode-editorCursor-foreground:#000000;
  --vscode-testing-iconPassed:#388a34; --vscode-testing-iconFailed:#f14c4c; --vscode-errorForeground:#a1260d;
}
```
These are the Light+ defaults as best known at planning time. If you can, confirm them against VS Code's `extensions/theme-defaults/themes/light_vs.json` / `light_plus.json` and the workbench colour defaults, and report what you used. If you can't confirm them, keep these values and say so.

In `test/ui/run.mjs` check 7:
- Iterate three themes: `vscode-dark`, `vscode-light`, and `vscode-light theme-lightplus` (set `document.body.className`).
- **Add** a node border reading (`stroke` of `.cfg-node--statement:not(.is-current) rect`) and assert **border vs background ≥ 3:1** in each theme.
- **Add** Start/End text contrast. Read the `fill` of `.cfg-node--start text`; it's currently not read separately, since the old check used statement text. Assert ≥ 4.5:1 against the start fill.
- Keep the "colours differ between themes" assertion between dark and Modern light only.

**Verify**: `npm run test:ui` → check 7 PASS. Report every ratio for the three themes: border vs background must be ≥ 3 in each, and Start/End text ≥ 4.5 in each. Expected values are in the table above (3.59 / 4.59 / 5.02 for borders; 8.10 / 8.89 / 5.49 for Start/End).

### Step 3: Merge-safe state helpers (pure) + fix the overwrite

In `webview/viewState.js`, add:
```js
export function mergeState(prev, patch) { return { ...(prev || {}), ...patch }; }
export function shouldShowTip(saved, hostDismissed) { return !hostDismissed && !(saved && saved.tipDismissed); }
```
In `main.js`, add `const saveState = (patch) => vscode.setState(mergeState(vscode.getState(), patch));` and replace the `vscode.setState({...})` in `onControlChange` with `saveState({ mode: ..., wholeFile: ..., hideBuiltins: ... })`. Don't call `vscode.setState` anywhere else.

Unit tests in `test/unit/viewState.test.mjs`:
- `mergeState` keeps keys that aren't in the patch, and handles `undefined` as the previous state.
- `shouldShowTip` gives `true` only for (no saved dismissal, host not dismissed), across all 4 combinations.

**Verify**: `npm run test:unit` → 0 fail; `grep -c "vscode.setState" webview/main.js` → `1` (inside `saveState`).

### Step 4: Hide built-ins (default ON)

1. Create `webview/pyBuiltins.js`:
   ```js
   // Generated with Python 3.12.3:
   //   python -c "import builtins; print(sorted(n for n in dir(builtins) if not n.startswith('_')))"
   // 150 names. Regenerate when targeting a newer Python.
   export const PY_BUILTINS = new Set([ /* paste the 150 names */ ]);
   ```
   Generate the list by running that command. **Verify** the count with `node --input-type=module -e "import {PY_BUILTINS} from './webview/pyBuiltins.js'; console.log(PY_BUILTINS.size, PY_BUILTINS.has('print'), PY_BUILTINS.has('_'))"`, which should print `150 true false`.
2. `functionGraph(tree, code, { hideBuiltins = false } = {})`. When `hideBuiltins` is true, a call whose target would be an **external** node with a name in `PY_BUILTINS` adds neither a node nor an edge. User-defined functions named like a built-in (e.g. your own `def print():`) are **not** external, so they're never hidden. The default `false` keeps every existing test valid.
3. UI: in `index.html`, after the Whole file label, add `<label class="hide-builtins"><input type="checkbox" id="hide-builtins"> Hide built-ins</label>`, styled like `.whole-file`. In `main.js`:
   - `hideBuiltins.checked = saved.hideBuiltins ?? true;` **Default ON:** learners care about their own functions, and built-ins dominate small scripts. It's one click to show them.
   - Enabled only in Functions mode (`hideBuiltins.disabled = modeSelector.value !== "functions"`, updated wherever `wholeFile.disabled` is updated).
   - Its `change` goes through `onControlChange` (which already resets `lastRendered`, forcing a render).
   - The Functions branch builds `functionGraph(tree, code, { hideBuiltins: hideBuiltins.checked })` and uses `fitKey: \`functions:${hideBuiltins.checked}\``, so toggling refits.

Unit tests (`test/unit/functionParser.test.mjs`):
- `def a():\n  print(len([]))\n  helper()\n` with `{ hideBuiltins: true }` → no node labelled `print` or `len`, and `helper` is still an external node with an edge from `a`.
- The same source with no options → `print` and `len` are present (old behaviour).
- `def print():\n  pass\ndef a():\n  print()\n` with `{ hideBuiltins: true }` → the edge `a → print` exists (user-defined, not hidden).

**Verify**: `npm run test:unit` → 0 fail.

### Step 5: Link `self.m()`, `cls.m()` and `ClassName()`

In `functionParser.js`:
1. Track the **kind** of each scope element in `findFunctions` (e.g. `scope` becomes `[{ name, kind: "class" | "function" }]`, and the qualified name still joins the names with `.`). For each function, store `className`: the qualified class path when its **immediate** parent scope is a class, otherwise `null`. Also collect the set of **top-level** class names.
2. In `collectCalls`, when a `CallExpression`'s first child is a `MemberExpression` whose first child is `VariableName` `self` or `cls` and whose next named child is a `PropertyName`, record `calls.add("self." + property)`. A `.` can't appear in a bare name, so the marker can't clash. Keep the cursor balanced: every `firstChild()` gets one `parent()`.
3. Resolution in `functionGraph`:
   - `self.m`: if the caller has a `className` and `functions.has(\`${className}.m\`)`, add an edge to that node. Otherwise add **nothing**: no node, no edge, which is today's behaviour for method calls.
   - A bare name `X` that's a top-level class: if `functions.has(\`X.__init__\`)`, add an edge to `X.__init__`. Otherwise keep today's behaviour, an external node `X`.
   - All other rules are unchanged.

Unit tests:
- `class Cart:\n  def a(self):\n    self.b()\n  def b(self):\n    pass\n` → edge `Cart.a → Cart.b`.
- `class Cart:\n  def a(self):\n    self.nope()\n` → no edges; nodes only `Cart.a`.
- `class K:\n  @classmethod\n  def make(cls):\n    cls.setup()\n  @classmethod\n  def setup(cls):\n    pass\n` → edge `K.make → K.setup`.
- `class Cart:\n  def __init__(self):\n    pass\ndef main():\n  Cart()\n` → edge `main → Cart.__init__`, and no node labelled `Cart`.
- `class Foo:\n  pass\ndef main():\n  Foo()\n` → external `Foo` (unchanged).
- `class C:\n  def m(self):\n    def inner():\n      self.m()\n    inner()\n` → `inner`'s immediate parent is a function, so `self.m()` there is **not** resolved (documented limitation): no edge `C.m.inner → C.m`.
- `def a(obj):\n  obj.go()\n` → zero edges (unchanged).

**Verify**: `npm run test:unit` → 0 fail. Coverage for `functionParser.js` from `node --test --experimental-test-coverage "test/unit/*.test.mjs"`: report it. It should stay ≥ 95% lines.

### Step 6: Hover hints on boxes (SVG `<title>`)

In `toSvg.js`, export `nodeHint(node)`:
- A node with a source range: `${node.label}\nClick or Enter: go to code`
- A node without one (external): `${node.label}\nNot defined in this file`
- Add the comment `// TODO(drill-down plan): function nodes in Functions mode add "Double-click: open its flowchart".`

Emit `<title>${xml(nodeHint(node))}</title>` as the **first child** of each node `<g>`. Browsers and VS Code webviews show SVG `<title>` as a native tooltip.

Unit tests (`toSvg.test.mjs`): the statement node's group contains `<title>x = 1\nClick or Enter: go to code</title>` (or the escaped equivalent); the external `print` node's title contains `Not defined in this file`; a label with `<` comes out escaped inside `<title>`.

**Verify**: `npm run test:unit` → 0 fail; `npm run bench` → median still < 300 ms (report it).

### Step 7: "?" cheat sheet (accessible dialog)

`index.html`:
- In the toolbar, after the Fit button: `<button id="help-button" type="button" title="Show all controls (?)" aria-haspopup="dialog" aria-controls="help-dialog">?</button>`
- Inside `<main>`, after `#display`: a `<div id="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" hidden>` containing `<h2 id="help-title">Controls</h2>`, a list of the current controls, and `<button id="help-close" type="button">Close</button>`. Content (only controls that exist now):
  - Scroll or trackpad: move around
  - Ctrl + scroll, or pinch: zoom at the pointer
  - Drag: pan
  - Fit, or 0: fit the diagram · + / −: zoom in / out
  - Click a box, or Tab to it and press Enter: go to that code
  - Mode: Flow (the function your cursor is in) or Functions (who calls whom)
  - Whole file (Flow): show the whole module instead of following the cursor
  - Hide built-ins (Functions): hide print, len and other Python built-ins
  - ?: show this list · Esc: close it

`index.css`: the dialog is positioned over the diagram area (absolute, centred, bounded size, scrollable). It uses `--vscode-editorWidget-background`, `--vscode-editorWidget-border` and `--vscode-foreground`. Don't add any colour the harness's theme blocks don't define. If you need a new `--vscode-*` variable, add it to all three theme blocks in `server.mjs`.

`main.js`:
- `openHelp()`: remove `hidden` and move focus to `#help-close`. `closeHelp()`: add `hidden` and return focus to `#help-button`.
- `#help-button` click toggles. `#help-close` click closes.
- In the keydown handler, **first**: if the dialog is open, `Escape` closes it (preventDefault), and every other key returns early, so the zoom keys don't act behind the dialog. When it's closed, `?` (with no Ctrl/Meta/Alt, and not in a select or input) opens it.
- The dialog sits outside `#display`, so clicks and wheel events in it don't reach the pan/zoom/reveal listeners.

**Verify**: `npm run lint` → exit 0; `npm run build:webview` → exit 0.

### Step 8: First-run tip banner (persisted in the webview AND the host)

`index.html`, inside `<main>` before `#display`:
```html
<div id="tip-banner" role="note" hidden>Tip: click a box to jump to its code · scroll to move · Ctrl+scroll to zoom · <kbd>?</kbd> for all controls <button id="tip-dismiss" type="button" aria-label="Dismiss tip">×</button></div>
```
Message protocol (new, small):
- Host → webview, sent right after `ready`, **before** `updatePanel()`: `{ type: 'tipState', dismissed: context.globalState.get('pychart.tipDismissed', false) }`
- Webview → host when you click ×: `{ type: 'tipDismissed' }`. The host runs `context.globalState.update('pychart.tipDismissed', true)`.

`extension.js`: add these two branches to the existing `onDidReceiveMessage` (match the file's style). Validate the type; ignore anything else.

`main.js`:
- The banner starts `hidden`, so it can't flash for users who already dismissed it.
- On `tipState`: `banner.hidden = !shouldShowTip(vscode.getState(), message.dismissed)`.
- On × click: hide it, `saveState({ tipDismissed: true })`, then `vscode.postMessage({ type: "tipDismissed" })`.

**Why both stores:** webview state survives hide/show of the panel; `globalState` survives closing the panel and restarting VS Code. Either one being set keeps the banner hidden.

### Step 9: Extend `test/ui/run.mjs`

Add these checks, each with `report(n, …)` and a screenshot. Number them 8–12, after check 7 and before C:
- **8. Functions view clean-up.** In Functions mode, with the default state: `#hide-builtins` is checked and enabled. Node labels contain the 5 user functions and **none** of `print`, `open`, `len`, `range`. There's an edge whose target label is `Cart.__init__`: translate edges to labels, as in the unit tests, or read the source/target `data-id`s. Uncheck it, and `print` reappears and `__state.hideBuiltins === false`. Switch to Flow mode, and `#hide-builtins` is disabled.
- **9. Hover hints.** Every `#display .cfg-node` has a first-child `<title>`, and the `if s < 0` node's title contains `Click or Enter: go to code`.
- **10. Cheat sheet.** Click `#help-button`: the dialog is visible and focus is on `#help-close` (`document.activeElement.id`). Press `+`: the transform is **unchanged**, because keys are blocked while the dialog is open. Press `Escape`: the dialog is hidden and focus is on `#help-button`. Press `?`: it opens again. Press `Escape` to close.
- **11. Tip banner.** After `ready`, the banner is hidden. Post `{type:"tipState", dismissed:false}` and it's visible. Click `#tip-dismiss`: it's hidden, `__posted` contains `{type:"tipDismissed"}`, and `__state.tipDismissed === true`. Post `tipState false` again and it stays hidden. Then `page.reload()` (which resets `__state`), wait for `ready`, post `{type:"tipState", dismissed:true}`, and it stays hidden.
- **12. State merge.** After toggling the mode, `__state` still has `tipDismissed: true` and `hideBuiltins`, so nothing was wiped.

Update check 6's expectations if the default hide-built-ins changes them. It requires only the 5 user functions, so it should still pass. Report its new edge count.

**Verify**: `npm run test:ui` → exit 0, every check `[PASS]`, including C (no console errors or CSP violations from the new UI).

### Step 10: Full gate

Run `npm run test:unit`, `npm run test:coverage`, `npm run build:webview`, `npm run check:bundle`, `npm run bench`, `npm run lint` and `npm run test:ui`. All must exit 0. Then `git status --short` should be clean after committing.

## Test plan

- **Unit:** `viewState` (mergeState, shouldShowTip), `functionParser` (hide built-ins ×3, self/cls/class resolution ×7), `toSvg` (title hints ×3). Follow the existing structure of each test file.
- **UI (`test:ui`):** check 7 extended to 3 themes with border and Start/End contrast, plus new checks 8–12.
- **Expected:** unit tests 111 → about 124 passing, 0 fail; `test:ui` all PASS.

## Done criteria

- [ ] `npm run test:ui` exits 0, with checks 1–12, R and C all `[PASS]`. Check 7 reports border ≥ 3:1 and Start/End text ≥ 4.5:1 in all three themes.
- [ ] `npm run test:unit` → 0 fail, and the new tests listed above exist
- [ ] `grep -c "vscode.setState" webview/main.js` → `1`
- [ ] `node --input-type=module -e "import {PY_BUILTINS} from './webview/pyBuiltins.js'; console.log(PY_BUILTINS.size)"` → `150`
- [ ] `grep -n "tipDismissed" extension.js` → both the `globalState.update` and the `tipState` send are present
- [ ] `test:coverage`, `build:webview`, `check:bundle` (< 3.4 MiB; report bytes), `bench` (median < 300 ms) and `lint` all exit 0
- [ ] Only in-scope files changed (`git diff --stat <base>..HEAD`)

## STOP conditions

Stop and report back (do not improvise) if:

- `npm run test:ui` fails on the **unmodified** base in Step 1.
- The border colour can't reach 3:1 in one of the three themes with theme variables alone. Don't hard-code hex colours; report the ratios.
- Resolving `self.`/`cls.` seems to need type inference or changes outside `functionParser.js`.
- The CSP blocks something the new UI needs (check C fails with a `securitypolicyviolation`). Don't loosen the CSP.
- The bench median goes ≥ 300 ms after adding `<title>` elements.
- Any existing unit test has to change for a reason other than the default-on hide built-ins in the UI. `functionGraph` defaults to `hideBuiltins: false`, so the existing `functionParser` tests should pass untouched.

## Maintenance notes

- **The drill-down plan** adds "Double-click: open its flowchart" to `nodeHint` for function nodes in Functions mode (see the TODO), and adds double-click and Back to the cheat sheet.
- **The run & replay plans** add their controls (▶ Run, play/pause, speed, scrub) to the cheat sheet and give their buttons `title` hints. The cheat sheet is the single list of every control: keep it complete (D22).
- **New state keys** must go through `saveState`/`mergeState`. A bare `vscode.setState` silently wipes other settings.
- **The built-ins list** is for Python 3.12. Regenerate `pyBuiltins.js` with the command in its header when targeting a newer Python.
- **`self.` resolution is deliberately shallow:** direct methods only. Nested functions and `obj.method()` stay unresolved. The tests document both limits.
- **Reviewer focus:** cursor balance in `collectCalls`'s new branch; that the dialog really blocks the zoom keys; that the banner can't flash; and the three-theme contrast numbers in check 7's output.
