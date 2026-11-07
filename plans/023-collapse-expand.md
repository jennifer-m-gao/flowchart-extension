# Plan 023: Loops, ifs and try blocks can be folded into one box and unfolded again

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: report every number you measure (test counts, coverage, node
> counts, timings, bundle bytes, before/after values) in your report, with the
> command that produced it. The user requires every metric to be recorded; the
> reviewer copies them into `plans/METRICS.md`. Measure "before" on your base
> commit before changing anything.
>
> **Drift check (run first, after branching)**: `git diff --stat e434a2e..HEAD -- webview/cfg/buildCfg.js webview/render/ webview/main.js webview/viewState.js webview/index.css test/unit/buildCfg.test.mjs test/ui/`
> Plans 018–022 are **expected** to have changed several of these (018 adds
> `test/ui/`; 019 adds hover hints to `toSvg.js` and a cheat sheet; 021 adds
> replay classes/visit counts and a per-function layout cache; 022 adds
> drill-down). Not drift. **`webview/cfg/buildCfg.js` should be unchanged
> since e434a2e except the plan-017 line** (`label: e.label ?? "loop"`); if it
> changed otherwise, compare with the excerpts below and STOP on a mismatch.
> **Read the live `main.js`, `toSvg.js`, `toElk.js`, `viewState.js` and the
> 021 replay module in full before editing.**

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (graph transform correctness; interaction with replay and layout caching)
- **Executor model**: opus / high
- **Depends on**: plans 018 (test:ui), 019 (hints, cheat sheet), 021 (replay), 022 (drill-down: shares click handling)
- **Category**: feature (D21)
- **Planned at**: commit `e434a2e` (branch `advisor/017-label-and-version`), 2026-11-06

## Why this matters

Long functions produce tall flowcharts. Folding a loop or an `if` into a single
box ("`for s in scores` · 8 steps") lets the user focus on the part they care
about, and during a replay (plan 021) a folded loop can still be watched: the
box glows whenever execution is inside it and shows how many steps ran there.
Agreed behaviour (D21): a ▸/▾ toggle on every `for`/`while`/`if`/`try` box;
everything starts expanded; fold state is remembered per function for the
session; folding re-lays-out the graph, but cursor highlighting never does.

## Current state

- `webview/cfg/buildCfg.js` builds `{ nodes, edges }`. Nodes are
  `{ id, kind, label, from, to, unreachable? }`; ids are `"start"`, `"n0"…`, `"end"`.
  Kinds: `start, end, statement, decision, loop, return, raise, break, continue, def, try, except, finally`.
  Every node is created through one function:
  ```js
  // buildCfg.js (e434a2e) ~line 55
  function addNode(kind, label, from, to, unreachable, id = "n" + counter++) {
    const n = { id, kind, label, from, to };
    if (unreachable) n.unreachable = true;
    nodes.push(n);
    byId.set(id, n);
    return id;
  }
  ```
  The compound builders (excerpts, e434a2e):
  ```js
  function buildIf(node, pending, ctx) {
    const cls = clauses(node);
    if (!cls.length) return simple(node, pending);
    const exits = [];
    let current = pending;
    for (const c of cls) {
      if (c.kw === "else") { exits.push(...buildBody(c.body, current, ctx)); current = []; }
      else {
        const d = makeNode("decision", header(c.from, c.body), c.from, c.body.from, current);
        exits.push(...buildBody(c.body, [{ source: d, label: "True" }], ctx));
        current = [{ source: d, label: "False" }];
      }
    }
    return [...exits, ...current];
  }
  function buildLoop(node, pending, ctx, enterLabel, exitLabel) {
    …
    const loop = makeNode("loop", header(node.from, cls[0].body), node.from, cls[0].body.from, pending);
    const entry = { loopId: loop, breaks: [], frameDepth: ctx.frames.length };
    ctx.loops.push(entry);
    const bodyExits = buildBody(cls[0].body, [{ source: loop, label: enterLabel }], ctx);
    connect(bodyExits.map(e => ({ source: e.source, label: e.label ?? "loop" })), loop);
    ctx.loops.pop();
    let exits = [{ source: loop, label: exitLabel }];
    const elseClause = cls.find(c => c.kw === "else");
    if (elseClause) exits = buildBody(elseClause.body, exits, ctx);
    return [...exits, ...entry.breaks];
  }
  function buildTry(node, pending, ctx) {
    …
    const tryId = makeNode("try", header(tryClause.from, tryClause.body), tryClause.from, tryClause.body.from, pending);
    // the `finally` node is created with addNode(...) right after, before the body
    … // handlers: makeNode("except", …); else body; finally body; abrupt routing
  }
  ```
  `elif` decisions are created inside the **same** `buildIf` call as the first `if`.
  `break`/`return` edges that leave a compound statement are added **later**
  (via `entry.breaks` / `routeAbrupt`), from nodes inside it to nodes outside it.
- `webview/render/toElk.js` sizes boxes from the label: `nodeSize(node)`
  (decision/loop: `max(96, textW + 56)` × 56; start/end: × 32; other: `max(80, textW + 24)` × 32),
  `CHAR_W = 7.2`.
- `webview/render/toSvg.js` draws each node as
  `<g class="cfg-node cfg-node--<kind>" data-id … data-from … data-to … tabindex="0" role="button" aria-label="…">`
  with a polygon (decision/loop), a pill (start/end) or a rect, then the label `<text>`.
- `webview/main.js`: one delegated `click` listener does click-to-source for
  `.cfg-node[data-from]`; `renderAction(lastRendered, inFlight, next)` in
  `webview/viewState.js` decides render vs highlight using `shouldRender`,
  which compares `code`, `viewKind`, `follow` and (flow) `scopeKey`.
  `highlight()` uses `nodeAtOffset(currentGraph.nodes, cursorOffset, currentCode)`
  (smallest containing `[from, to)` wins) and toggles `.is-current`.

### Verified at planning time (prototype, not committed)

Adding a `parent` field via a group stack (Step 2's design) to a copy of
`buildCfg.js` and running it on `classify` in `sample/demo.py` gave:

```
start  start      -                def classify(scores)
n0     statement  -                results = []
n1     loop       -                for s in scores
n2     decision   for s in scores  if s < 0
n3     continue   if s < 0         continue
n4     decision   if s < 0         elif s > 100      ← elif belongs to the first if's group
n5     break      if s < 0         break
n6     decision   for s in scores  if s >= 50
n7     statement  if s >= 50       results.append("pass")
n8     statement  if s >= 50       results.append("fail")
n9     statement  for s in scores  print("all scores read")   ← the loop's else-body is in the loop's group
n10    return     -                return results
end    end        -                End
```
Folding the loop (`n1`) hid **8** nodes (13 → 5 visible), and rerouting/deduping
left exactly: `def classify → results = [] → for s in scores → return results → End`.
Use these numbers as the expected values in tests and metrics.

### Expected touch points after 018–022 (verify in the live code)

- **019:** nodes have a hover hint; the "?" cheat sheet lists controls.
- **021:** replay sets classes on nodes (current glow, visited tint) and shows
  per-node visit counts, keyed by **node id**; there is a per-function layout
  cache. Find the function that maps an executed line/offset to a node id and
  the cache key.
- **022:** the Functions view uses `dblclick`; the click listener has a 250 ms
  delay in the Functions view only.

## Decisions (made; do not revisit)

- **Grouping metadata lives in `buildCfg`.** Each node may get `parent` = the id
  of the innermost compound node whose statement contains it. Compound = the
  first `decision` of an `if` (its `elif`s and all branch bodies belong to it), a
  `loop` (its body **and its `else` body**), a `try` (body, handlers, `else`,
  `finally`). `with` and `match` are not foldable in this plan. Nodes outside any
  compound have no `parent`. This is backward compatible (an extra field).
- **`collapseCfg(graph, collapsedIds)`** is a pure function:
  - `visible(id)` = the **outermost** collapsed ancestor of `id` (walking `parent`), else `id` itself.
  - Hidden nodes are removed. The anchor stays (same id) and becomes a summary:
    `kind: "collapsed"`, `label: "<anchor label> · N steps"` (N = number of hidden
    nodes), `from: anchor.from`, `to: max(to over anchor + hidden)` so the cursor
    anywhere inside the statement highlights the summary. Keep `foldOf: <anchor's original kind>`.
  - Edges: map both ends through `visible`; drop edges whose ends are the same
    summary; **edges leaving a summary lose their label**; dedupe by `(source, target, label)`.
  - Every node that has children (in the uncollapsed graph) gets `fold: "open"` or
    `fold: "closed"`; others get nothing.
  - Returns `{ nodes, edges, visibleOf: Map<originalId, visibleId> }` (the map is for replay).
- **Fold keys must survive edits.** Node ids (`n7`) shift when lines are added
  above. Store folds per function as **stable keys**: `${kind}:${label}#${k}`, where
  `k` is the index among nodes with the same kind+label in that function (in
  graph order). Convert keys ↔ ids at render time.
- **State:** in memory per function `qualifiedName` (Map of Sets), mirrored into
  `vscode.setState({ …existing, folds: { [qualname]: [keys] } })`. Starts expanded.
- **Toggle glyph:** drawn in `toSvg` for nodes with `fold`: a small
  `<g class="cfg-fold" data-fold="<id>"><title>Fold/unfold</title><text>▾ or ▸</text></g>`
  at the box's top-left. `toElk.nodeSize` adds 14 px of width for nodes with `fold`.
  Clicking it toggles and **never** triggers click-to-source or drill-down. It's
  keyboard reachable: focused node + `[` folds / `]` unfolds (add to the cheat sheet).
- **Re-render rule:** folding changes the graph, so it must re-layout. Add a `folds`
  string (sorted fold keys for the current function) to the `next` objects in
  `update()` and make `shouldRender` also compare `prev.folds !== next.folds`.
  Cursor moves never change `folds`, so highlighting stays layout-free. If 021
  caches layouts per function, include the fold string in the cache key.
- **Replay:** current-node and visited classes and visit counts are applied to
  `visibleOf.get(id)`. A summary's count is the **sum** over the anchor and its
  hidden nodes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Unit tests | `npm run test:unit` | exit 0, `ℹ fail 0` |
| Coverage gate | `npm run test:coverage` | exit 0 (≥ 90% lines on `webview/cfg/**`) |
| Build | `npm run build:webview` | exit 0 |
| Bundle gate | `npm run check:bundle` | exit 0 |
| Render benchmark | `npm run bench` | exit 0 (folding must not slow the unfolded path) |
| Lint | `npm run lint` | exit 0 |
| UI tests | `npm run test:ui` | exit 0, all PASS |

Do **NOT** run `npm test` (the reviewer runs the VS Code integration tests).

## Scope

**In scope:**
- `webview/cfg/buildCfg.js` — `parent` emission only (no other behaviour change)
- `webview/cfg/collapseCfg.js` (create) and `webview/cfg/foldKeys.js` (create; key ↔ id helpers)
- `test/unit/buildCfg.test.mjs` (add parent tests), `test/unit/collapseCfg.test.mjs` (create), `test/unit/foldKeys.test.mjs` (create)
- `webview/render/toSvg.js`, `webview/render/toElk.js` — glyph + width
- `webview/viewState.js` (+ its unit test) — `folds` in `shouldRender`
- `webview/main.js` — fold state, toggle handling, replay mapping
- `webview/index.css` — glyph style; summary node style (`.cfg-node--collapsed`, dashed border)
- the 019 cheat sheet and hint text — fold rows
- `test/ui/` checks

**Out of scope:**
- Folding `with`/`match`, folding in the Functions view, "fold all/unfold all" buttons — later.
- Changing any edge or node produced by `buildCfg` other than adding `parent`.
- Persisting folds across VS Code restarts beyond what `setState` gives.

## Git workflow

- Branch: `git checkout -b advisor/023-collapse-expand <base>` (the branch your reviewer names: the tip of 022).
- Commits, e.g.: `Emitted parent grouping from buildCfg`, `Added collapseCfg graph transform`, `Added fold toggles to the flow view`.
- Do NOT push.

## Steps

### Step 1: Branch, install, baseline

Branch, `npm ci`, drift check, read the live files. Record baselines: unit
counts, `test:ui` count, bench median, bundle bytes, and for `classify` in
`sample/demo.py` the node and edge counts (expected 13 nodes).

**Verify**: all commands exit 0; numbers written down.

### Step 2: Emit `parent` in `buildCfg` (tests first)

Add tests to `test/unit/buildCfg.test.mjs`:
1. `classify` from `sample/demo.py` (or an inline copy): the `parent` labels match the
   table in "Verified at planning time" exactly (start/n0/n10/end have no parent).
2. `try/except/else/finally`: try body, the except node, handler body, else body and
   the finally node all have `parent` = the try node; nodes after the try have none.
3. `while` with `else`: the else body has `parent` = the loop node.
4. Nested `if` inside `if`: inner body → inner decision; inner decision → outer decision.
5. Module scope with a `def`: the `def` node has no parent; `with` body has the
   enclosing compound (if any) as parent, not the with statement.
6. Every existing buildCfg test still passes (edges/nodes otherwise identical).

Then implement: a closure-level `const groups = [];` in `buildCfg`; in `addNode`, set
`n.parent = groups[groups.length - 1]` when `groups.length`; in `buildIf` push the
**first** decision's id right after creating it and pop before returning; in
`buildLoop` push `loop` after creating it and pop after the else body; in `buildTry`
push `tryId` right after creating it (before the `finally` node is added) and pop
just before each `return`. Make sure every `return` path pops exactly once.

**Verify**: `npm run test:unit` → 0 fail; `npm run test:coverage` → exit 0; `npm run bench` → exit 0 (report median before/after; it should not change measurably).

### Step 3: `collapseCfg` and fold keys (tests first)

`test/unit/collapseCfg.test.mjs`:
1. Fold the loop of `classify` → 5 nodes; edges exactly
   `start→n0, n0→n1, n1→n10, n10→end` (labels: none on `n1→n10`); `n1.kind === "collapsed"`,
   label `"for s in scores · 8 steps"`, `foldOf === "loop"`, `fold === "closed"`.
2. Fold only the inner `if s >= 50` → `n7`, `n8` hidden; the summary keeps its incoming
   `False` edge from `n4`; no edge references a hidden id.
3. Fold an `if/elif/else` chain → the elif decision is hidden with it.
4. Fold a `try/finally` containing `return` → edges from the summary to `end` exist; no duplicates.
5. Nested: fold both the loop and the inner if → same result as folding the loop only.
6. `collapsedIds` empty → output equals input nodes/edges (plus `fold: "open"` on nodes with children).
7. Invariants on every case (helper): every edge endpoint exists; no self-loop on a
   summary; no duplicate `(source,target,label)`; `visibleOf` maps every original id.
8. Round trip: unfolding (empty set) after folding returns the original graph.

`test/unit/foldKeys.test.mjs`: keys are stable when a line is inserted above the
loop (ids shift, keys don't); two identical `if x:` statements get `#0` and `#1`.

**Verify**: `npm run test:unit` → 0 fail; coverage for `collapseCfg.js` and
`foldKeys.js` ≥ 90% lines (report %); `npm run test:coverage` → exit 0.

### Step 4: Draw the toggle

`toElk.nodeSize`: +14 px width when `node.fold`. `toSvg`: for `node.fold`, draw the
`.cfg-fold` group (▾ open, ▸ closed) inside the node group's top-left corner; for
`kind === "collapsed"` draw a rect with class `cfg-node--collapsed` (dashed border in
CSS). Add unit assertions to the existing `toSvg`/`toElk` tests: the glyph is present
with `data-fold`, the width grows by 14, the label is XML-escaped.

**Verify**: `npm run test:unit` → 0 fail; `npm run build:webview` → exit 0.

### Step 5: Wire it in `main.js`

1. Fold state: `Map<qualname, Set<key>>`, restored from `vscode.getState().folds`.
2. In `update()` for flow views: build the CFG, compute the current function's
   collapsed ids from its keys, `collapseCfg`, render the collapsed graph; put
   `folds: <sorted keys joined>` into `next`; include it in any layout-cache key.
3. `viewState.shouldRender`: also compare `folds`. Add a unit test: same code+scope,
   different folds → render; same folds → highlight.
4. Click handling: at the **top** of the delegated click (and dblclick) handler,
   `const fold = event.target.closest?.(".cfg-fold")`; if found, toggle that node's
   key, `setState`, `update()`, and `return` (no reveal, no drill).
5. Keyboard: `[` / `]` on a focused foldable node.
6. Replay (021): wherever a node id gets the current/visited class or a visit
   count, use `visibleOf.get(id) ?? id`, summing counts for summaries.
7. `highlight()` keeps working unchanged because the summary's `[from, to)` covers its body.

**Verify**: `npm run lint`, `npm run build:webview`, `npm run test:unit` → all exit 0.

### Step 6: Cheat sheet and hints

Add rows: **▸/▾ (or `[` / `]` on a focused box)** — fold/unfold a loop, if or try.
The glyph's `<title>` is `Fold/unfold`.

**Verify**: grep finds the new text; build exits 0.

### Step 7: UI checks (018 harness)

1. Fold the `for s in scores` loop in `classify` → node count 13 → 5; summary label
   contains `· 8 steps`; glyph shows ▸.
2. Clicking the glyph posts **no** `reveal`; clicking the summary box itself does post a reveal.
3. Unfold → back to 13 nodes.
4. Cursor inside the folded loop body (`setCursor` at `results.append("pass")`) →
   the summary node has `is-current`; no re-layout happened (assert the SVG element is
   the same object / render counter `#time-track` unchanged).
5. Fold state survives typing: fold, then `setCode` with a line inserted above the
   loop → still folded.
6. Replay (021): fold the loop, run → the summary glows during steps inside the loop
   and its count equals the sum of the hidden nodes' counts from an unfolded run.
7. The cheat sheet lists the fold controls.
8. **Fold re-render time:** time from glyph click to the new SVG; report the median of 5.

**Verify**: `npm run test:ui` → exit 0, all PASS (old and new).

### Step 8: Full gate

**Verify**: `npm run test:unit`, `npm run test:coverage`, `npm run build:webview`,
`npm run check:bundle`, `npm run bench`, `npm run lint`, `npm run test:ui` all exit 0;
`git status --short` clean after committing.

## Test plan

- Unit: parent emission (≥ 5 cases), `collapseCfg` (≥ 8 cases + invariant helper),
  fold keys (≥ 2), `toSvg`/`toElk` glyph assertions, `shouldRender` with folds.
  Pattern: existing `test/unit/buildCfg.test.mjs` helpers.
- UI: 8 checks (Step 7) in the 018 harness.

## Done criteria

- [ ] `buildCfg` emits `parent` exactly as in the verified table; all old buildCfg tests unchanged and passing
- [ ] `collapseCfg.js` and `foldKeys.js` exist; line coverage ≥ 90% each; `npm run test:coverage` exits 0
- [ ] Folding `classify`'s loop gives 5 nodes / 4 edges (unit + UI)
- [ ] Glyph click posts no reveal; cursor highlight inside a folded body does not re-render
- [ ] All gates exit 0 (unit, coverage, build, bundle, bench, lint, test:ui)
- [ ] Report includes every metric: unit/UI counts before/after, coverage %, bundle bytes, bench median before/after, node counts folded/unfolded, fold re-render median

## STOP conditions

Stop and report back (do not improvise) if:
- Adding `parent` changes any existing buildCfg test expectation (it must be purely additive).
- The prototype numbers (13 → 5 nodes, 8 hidden) don't reproduce on `classify`.
- 021's replay keys visit counts by something other than node id, so `visibleOf`
  can't be applied without restructuring replay.
- Folding requires changing how `nodeAtOffset` works (it shouldn't: the summary's range covers its body).
- Bench median rises by more than 10% on the unfolded path.

## Maintenance notes

- Future "fold all / unfold all" = setting every foldable key; folding in the
  Functions view would need a different grouping (by class), not `parent`.
- If `buildCfg` grows new compound statements (`with`, `match`), push/pop them on
  `groups` the same way and they become foldable automatically.
- Fold keys depend on labels; a label change (editing the loop header) unfolds that
  loop. Acceptable; documented here so nobody "fixes" it with ids.
- Reviewer: check every `return` path in the three builders pops `groups` exactly once,
  and that summary edges never carry labels.
