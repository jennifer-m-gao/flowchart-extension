# Plan 022: Double-clicking a function in the Functions view opens its flowchart, with Back and a breadcrumb

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: report every number you measure (test counts, timings, coverage,
> bundle bytes, before/after values) in your report, with the command that
> produced it. The user requires every metric to be recorded; the reviewer
> copies them into `plans/METRICS.md`. Measure "before" on your base commit
> before changing anything.
>
> **Drift check (run first, after branching)**: `git diff --stat e434a2e..HEAD -- webview/main.js webview/viewStack.js webview/viewState.js webview/index.html webview/index.css webview/cfg/ test/ui/`
> Plans 018–021 are **expected** to have changed these paths (018 adds
> `test/ui/`; 019 adds tooltips, the "?" cheat sheet and a tip banner; 021 adds
> run/replay UI to `main.js`). That is not drift. **Before editing, read the
> live `webview/main.js`, `webview/viewStack.js`, `webview/viewState.js` and
> `test/ui/run.mjs` in full.** If the interfaces listed under "Expected
> touch points after 018–021" differ materially from what you find, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (event handling in the webview; must not break click-to-source or replay)
- **Executor model**: opus / medium
- **Depends on**: plans 018 (`npm run test:ui`), 019 (tooltips + cheat sheet), 021 (replay UI)
- **Category**: feature (direction D7/D21)
- **Planned at**: commit `e434a2e` (branch `advisor/017-label-and-version`), 2026-11-06

## Why this matters

PyChart has two views: **Flow** (the control-flow graph of one function) and
**Functions** (the call graph of the file). The user's long-term vision (D7) is
"levels": start at the overview of functions, click into one, see its flow.
The view stack built in plan 013 was designed for exactly this, so a simple
version is cheap. After this plan: in the Functions view, **double-click** (or
**Enter**) on a function opens that function's flowchart; **← Back** (or
**Alt+←**) returns to the overview with the same zoom; a breadcrumb shows where
you are (`Functions › Cart.add_item`). A single click still jumps to the code,
the same as in every other view (D21).

## Current state

Read these at the base commit with `git show e434a2e:<path>`; the live branch
will have more code from plans 018–021.

- `webview/viewStack.js` (whole file at e434a2e) — the view stack this plan uses:
  ```js
  export function createViewStack(initial) {
    const stack = [initial];
    return {
      current: () => stack[stack.length - 1],
      push: (view) => { stack.push(view); },
      pop: () => { if (stack.length > 1) stack.pop(); return stack[stack.length - 1]; },
      replace: (view) => { stack[stack.length - 1] = view; },
      depth: () => stack.length,
    };
  }
  ```
- `webview/main.js` at e434a2e — the parts this plan touches:
  - Views are created from the toolbar controls:
    ```js
    const viewFromControls = () => modeSelector.value === "functions"
      ? { kind: "functions" }
      : { kind: "flow", follow: !wholeFile.checked };
    const views = createViewStack(viewFromControls());
    ```
  - `onControlChange()` does `views.replace(viewFromControls()); lastRendered = null; update();`
  - In `update()`, a flow view resolves its scope like this:
    ```js
    const scope = view.follow
      ? findScope(tree, code, cursorOffset)
      : { node: tree.topNode, kind: "module", name: "<module>", qualifiedName: "<module>" };
    next = { code, viewKind: "flow", follow: view.follow, scopeKey: scopeKey(scope),
             fitKey: `flow:${view.follow}:${scope.kind}:${scope.qualifiedName}` };
    graph = () => buildCfg(scope.node, code);
    scopeTitle.textContent = (scope.qualifiedName === "<module>" ? "Module" : scope.qualifiedName)
      + (view.follow ? "" : " (whole file)");
    ```
  - The Functions view: `next = { code, viewKind: "functions", follow: false, scopeKey: "", fitKey: "functions" }` and `graph = () => functionGraph(tree, code)`.
  - Pan/zoom state lives in module variables `viewport`, `fittedKey`, `userMoved`; `mountSvg(fitKey)` refits only when `fitKey !== fittedKey`, otherwise re-applies `viewport`.
  - Click-to-source: one delegated listener —
    ```js
    display.addEventListener("click", (event) => {
      const node = !dragged && event.target.closest?.(".cfg-node[data-from]");
      if (node) { reveal(node); }
    });
    ```
  - Keyboard: `document.addEventListener("keydown", …)` handles Enter/Space on a focused `.cfg-node[data-from]` (→ `reveal`) and **returns early when `event.altKey` is set**, so Alt+← must be handled before that early return.
- `webview/functionParser.js` → `functionGraph(tree, code)` returns nodes
  `{ id, kind: "function", label: <qualified name>, from, to }` for defined
  functions (label is the qualified name, e.g. `Cart.add_item`, `outer.inner`)
  and `{ id, kind: "external", label, from: null, to: null }` for callees
  that are not defined in the file (e.g. `print`).
- `webview/render/toSvg.js` gives every node group `class="cfg-node cfg-node--<kind>"`,
  `data-id`, `data-kind`, and `data-from`/`data-to` when the node has a source range.
- `webview/cfg/findScope.js` — the naming rules to reuse: a function's
  qualified name is the names of enclosing `FunctionDefinition`/`ClassDefinition`
  nodes joined with `.`, then its own name (`VariableName` child). A decorated
  function's start is its `DecoratedStatement` parent.
- `webview/index.html` toolbar: `#diagram-mode` select, `#whole-file` checkbox,
  `#fit-view` button, `#scope-title` span.

### Expected touch points after 018–021 (verify in the live code)

- **018:** `npm run test:ui` runs `test/ui/run.mjs`, which loads the real panel
  in headless Chrome with a simulated VS Code host (it posts `setCode`/`setCursor`
  and records what the panel posts in `window.__posted`). Checks follow a common
  pattern in that file — add yours the same way.
- **019:** nodes have hover hints (SVG `<title>` or equivalent) and there is a
  "?" cheat sheet listing every control, plus a one-time tip banner. Find where
  the hint text for **Functions-view function nodes** and the cheat-sheet rows
  are produced.
- **021:** run/replay mode exists (▶ Run, player, visit counts, cross-function
  follow). Replay may push or switch views itself. **Drill-down must not run
  while a replay is active**: if replay mode is on, double-click does nothing
  (or follows whatever rule 021 uses for user navigation during replay — match
  it and say which in NOTES).

## Decisions (made; do not revisit)

- **Double-click/Enter opens; single click jumps.** In the Functions view a
  `dblclick` also fires two `click`s first. Revealing on the first click would
  move focus to the editor mid-double-click. So **in the Functions view only**,
  delay the single-click reveal by **250 ms** and cancel it if a `dblclick`
  arrives. In the Flow view, click stays immediate (nothing to double-click there).
- **Only defined functions drill.** `data-kind="function"` nodes drill;
  `external` nodes (built-ins like `print`) do not (double-click on them does
  nothing besides the normal behaviour).
- **Drilled view object:** `{ kind: "flow", follow: false, qualname }`. While
  drilled, follow-the-cursor is off (the cursor still highlights nodes in that
  function).
- **Back** pops one level. It restores the Functions view's zoom exactly as it
  was (save `{ viewport, fittedKey, userMoved }` on the Functions view object
  before pushing; restore it on pop, before re-rendering).
- **Changing the Mode select or Whole-file checkbox resets the stack** to a
  single view (no stale Back).
- **Nothing persists across reloads** (the drilled level is not saved in `setState`).
- **Function deleted by an edit:** if, after a `setCode`, the drilled `qualname`
  no longer resolves, pop automatically and show a short note in
  `#scope-title`'s area: `"<qualname>" no longer exists`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Unit tests | `npm run test:unit` | exit 0, `ℹ fail 0` |
| Coverage gate | `npm run test:coverage` | exit 0 (≥ 90% lines on `webview/cfg/**`) |
| Build | `npm run build:webview` | exit 0 |
| Bundle gate | `npm run check:bundle` | exit 0 |
| Render benchmark | `npm run bench` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| UI tests | `npm run test:ui` | exit 0, all checks PASS |

Do **NOT** run `npm test` (disk is tight; the reviewer runs the VS Code
integration tests).

## Scope

**In scope:**
- `webview/cfg/findFunction.js` (create) — the pure resolver
- `test/unit/findFunction.test.mjs` (create)
- `webview/main.js` — drill/back wiring, delayed single click in Functions view, auto-pop
- `webview/index.html`, `webview/index.css` — Back button + breadcrumb
- The 019 hint text and cheat sheet (wherever they live) — wording only
- `test/ui/run.mjs` (or the file 018 uses for checks) — new checks

**Out of scope:**
- `webview/viewStack.js` — its API is enough; don't change it.
- `buildCfg.js`, `functionParser.js`, renderer modules — no graph changes.
- Breadcrumb navigation by clicking crumbs, deeper levels (e.g. drilling into a
  loop), persisting the level across reloads — deferred.
- Replay logic from 021 beyond the "no drill during replay" rule.

## Git workflow

- Branch: `git checkout -b advisor/022-drill-down <base>` where `<base>` is the
  branch your reviewer names (the tip of 021).
- Commits: short sentence case, e.g. `Added function resolver by qualified name`,
  `Added drill-down from Functions view with Back and breadcrumb`.
- Do NOT push.

## Steps

### Step 1: Branch, install, baseline

Branch, `npm ci`, run the drift check, read the four live files named above.
Record baseline: `npm run test:unit` counts, `npm run test:ui` check count.

**Verify**: both commands exit 0; write the numbers down for METRICS.

### Step 2: Pure resolver `findFunctionByQualname`

Create `webview/cfg/findFunction.js`:

```js
// Returns the FunctionDefinition node whose qualified name (as findScope/functionGraph
// build it: enclosing FunctionDefinition/ClassDefinition names joined with ".") equals
// `qualname`, or null. First match in document order wins.
export function findFunctionByQualname(tree, code, qualname) { … }
```

Use the same naming rule as `findScope.js` (read it). Return the
`FunctionDefinition` node (not the `DecoratedStatement`) so `buildCfg(node, code)`
works unchanged.

Write `test/unit/findFunction.test.mjs` (pattern: `test/unit/findScope.test.mjs`):
1. top-level `def f` → found, `node.name === "FunctionDefinition"`
2. method `Cart.add_item` → found
3. nested `outer.inner` → found; plain `inner` → `null`
4. `f.C.m` (function → class → method) → found
5. decorated function → found, and `buildCfg(result, code)` returns a graph whose start label begins with `def`
6. unknown name → `null`; empty code → `null`
7. two classes each with `__init__` → `A.__init__` and `B.__init__` resolve to different nodes

**Verify**: `npm run test:unit` → 0 fail; `node --test --experimental-test-coverage "test/unit/*.test.mjs"` → report `findFunction.js` line %. It must be ≥ 90%. (It is under `webview/cfg/`, so `npm run test:coverage` also gates it.)

### Step 3: Back button and breadcrumb markup

In `webview/index.html`, add to the toolbar, before `#scope-title`:
`<button id="back-view" type="button" title="Back to Functions (Alt+←)" hidden>← Back</button>`
Make `#scope-title` capable of showing a breadcrumb (plain text is fine:
`Functions › Cart.add_item`). Style `#back-view` like `#fit-view` in `index.css`.

**Verify**: `npm run build:webview` → exit 0; `npm run lint` → exit 0.

### Step 4: Drill, Back, auto-pop in `main.js`

1. In `update()`, handle a flow view with `qualname`:
   ```js
   const fn = findFunctionByQualname(tree, code, view.qualname);
   if (!fn) { /* auto-pop: see 4.4 */ }
   const scope = { node: fn, kind: "function", name: view.qualname.split(".").pop(), qualifiedName: view.qualname };
   next = { code, viewKind: "flow", follow: false, scopeKey: scopeKey(scope), fitKey: `drill:${view.qualname}` };
   graph = () => buildCfg(fn, code);
   // title: "Functions › " + view.qualname
   ```
   Keep the existing `follow` / whole-file branches unchanged.
2. **Drill:** a `dblclick` listener on `#display`: if `views.current().kind === "functions"`,
   not dragged, replay not active, and `event.target.closest(".cfg-node--function")`,
   then: save `{ viewport, fittedKey, userMoved }` onto the current (Functions) view
   object, `views.push({ kind: "flow", follow: false, qualname: node label text })`,
   `lastRendered = null`, `update()`. Get the qualname from the node's data (prefer
   adding nothing to toSvg: read the label from the graph via `data-id` →
   `currentGraph.nodes`). Enter on a focused `.cfg-node--function` in the Functions
   view does the same (Enter currently reveals — in the Functions view, Enter now
   drills; Space still reveals). Document that choice in the cheat sheet.
3. **Delayed single click in the Functions view:** in the click listener, when the
   current view is Functions, schedule `reveal(node)` with `setTimeout(…, 250)` and
   clear that timer in the `dblclick` handler. Flow view: unchanged (immediate).
4. **Back / auto-pop:** a `goBack(note)` function: if `views.depth() > 1`, `views.pop()`,
   restore `{ viewport, fittedKey, userMoved }` from the now-current view object,
   `lastRendered = null`, `update()`; if `note`, show it in the title area until the
   next render. Wire: `#back-view` click, and **Alt+ArrowLeft** in the keydown handler
   **before** the existing `altKey` early return. Auto-pop from `update()` when the
   resolver returns `null`, with note `"<qualname>" no longer exists`.
5. `#back-view.hidden = views.depth() === 1` after every render.
6. In `onControlChange()`, reset to a single view (e.g. pop until depth 1, then `replace`).

**Verify**: `npm run lint` → exit 0; `npm run build:webview` → exit 0; `npm run test:unit` → 0 fail.

### Step 5: Hints and cheat sheet

Update the 019 hover hint for Functions-view **function** nodes to:
`Click: go to code · Double-click: open its flowchart` (external nodes keep their
existing hint). Add cheat-sheet rows: **Double-click / Enter (Functions view)** —
open that function's flowchart; **← Back / Alt+←** — return to Functions.

**Verify**: grep shows the new strings in the source; `npm run build:webview` → exit 0.

### Step 6: UI checks

Add checks to the 018 harness (follow its existing pattern; use `sample/demo.py`
or the fixture 018 uses):
1. **Drill by double-click:** switch to Functions; double-click the `Cart.add_item`
   node → the graph is that function's CFG (contains a `while qty > 0` loop node),
   breadcrumb reads `Functions › Cart.add_item`, Back is visible.
2. **No reveal on double-click:** `window.__posted` contains **no** `reveal` from that double-click.
3. **Single click still reveals** (Functions view): one click on `classify` → exactly one
   `reveal` posted after ~250 ms, with `from` at `def classify`.
4. **Back keeps zoom:** zoom/pan the Functions view, drill, press Back → the
   `.cfg-root` transform equals the one before drilling (tolerance 0.5 px / 0.001 scale).
5. **Alt+← works** like Back. **Enter** on a focused function node drills.
6. **External nodes don't drill:** double-click `print` → still the Functions view.
7. **Auto-pop:** drill into `load`, then post `setCode` with `def load` removed →
   Functions view shown, note mentions `"load" no longer exists`.
8. **Drill render time:** time from the double-click to the new SVG in the DOM;
   report the median of 5.

**Verify**: `npm run test:ui` → exit 0, all checks PASS (old and new).

### Step 7: Full gate

**Verify**: `npm run test:unit`, `npm run test:coverage`, `npm run build:webview`,
`npm run check:bundle`, `npm run bench`, `npm run lint`, `npm run test:ui` all exit 0.
`git status --short` clean after committing.

## Test plan

- Unit: `test/unit/findFunction.test.mjs` (≥ 7 cases above), modelled on `test/unit/findScope.test.mjs`.
- UI: 8 checks in the 018 harness (Step 6).
- Verification: `npm run test:unit` and `npm run test:ui` → all pass.

## Done criteria

- [ ] `webview/cfg/findFunction.js` exports `findFunctionByQualname`; its line coverage ≥ 90%
- [ ] `npm run test:unit`, `test:coverage`, `build:webview`, `check:bundle`, `bench`, `lint`, `test:ui` all exit 0
- [ ] The 8 UI checks in Step 6 exist and pass
- [ ] `grep -n "Double-click" ` finds the new hint and cheat-sheet text
- [ ] `git diff --stat <base>..HEAD` touches only in-scope files
- [ ] Report includes every metric (test counts before/after, coverage %, bundle bytes, bench median, drill render median)

## STOP conditions

Stop and report back (do not improvise) if:
- The live `viewStack.js` API differs from the excerpt, or `main.js` no longer has
  a single `update()` + `renderAction` render path (plan 021 restructured it).
- The 018 harness can't dispatch a real `dblclick` (report what it supports).
- Delaying the Functions-view single click makes the existing "click to source"
  UI check fail and the fix would need changing that check's expectation by more
  than adding a wait.
- Plan 021's replay mode navigates views in a way that conflicts with pushing a
  drilled view (e.g. it replaces the stack).
- The bundle gate or bench fails.

## Maintenance notes

- Deeper levels (drill into a loop; clickable breadcrumb crumbs) slot into the same
  stack: each level is a view object; keep `{ viewport, fittedKey, userMoved }` per level.
- If Functions-view nodes ever get a different click action, revisit the 250 ms delay.
- Plan 023 (collapse/expand) adds a fold toggle glyph inside nodes; its click must be
  excluded from both click-to-source and drill. Keep `closest(".cfg-fold")` checks first.
- Reviewer: check the double-click path posts no `reveal`, Back restores zoom exactly,
  and Mode/Whole-file changes reset the stack.
