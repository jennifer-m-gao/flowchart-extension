# Plan 012: Graphs are laid out by ELK and drawn as our own SVG (Functions mode switches over first)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (bundle bytes, timings, test counts, coverage) in your
> report's METRICS section with the command used (the reviewer copies them into `plans/METRICS.md`).
> Measure "before" on your base commit before changing anything.
>
> **Drift check (run first, after Step 1's checkout)**:
> `git diff --stat 617cf26..HEAD -- webview/main.js webview/functionParser.js webview/index.css webview/index.html package.json`
> Expected: empty, **except** that your base also contains `webview/cfg/buildCfg.js` (plan 010) and
> `webview/cfg/findScope.js` (plan 011) plus their tests. Those are prerequisites, not drift. If any of the five listed
> files changed, compare against "Current state"; on a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/010-cfg-builder.md, plans/011-find-scope.md (both must be in your base branch)
- **Category**: direction (1.1 feature)
- **Executor model**: opus / high
- **Planned at**: commit `617cf26` (branch `advisor/009-extension-host-lifecycle`, the 1.0.1 tip), 2026-11-05

## Why this matters

PyChart 1.1 replaces Mermaid (a text → static picture tool) with a renderer we control, because the product's core
principle is that **the graph is interactive**. Clicking a box must jump to its line, and moving the cursor must light up its box.
Mermaid can't link boxes back to source positions, and it caps diagrams at 50,000 characters. This plan builds the
three pure stages after the graph builder: **toElk** (graph data → ELK input), **layout** (elkjs computes positions and
edge routes), and **toSvg** (positions → an SVG string where every node carries its source range). It then switches
**Functions mode** to the new pipeline as the first end-to-end user of it. The Flow view (plan 013) and the interactions (plan 014)
build on it. Mermaid stays in the bundle until plan 015 deletes it.

Decisions this plan must follow (quoted from `plans/DECISIONS.md`):
- D6: "elkjs (the Eclipse Layout Kernel's 'layered' algorithm, built for flowcharts) with our own SVG … each element
  carries its source range, so click-to-source and highlighting are easy, and the diagram can use VS Code theme colours
  directly." Pinned version: `elkjs@0.12.0`.
- D13: the pipeline is "a pure function over plain data" at each stage. Layout "runs on the main thread first, with a
  web worker only if measurement shows it's needed." Functions mode "moves to the new renderer as well … rebuilt to output
  the same `{nodes, edges}` shape."

## Current state

**Graph data contract** (from plan 010, `webview/cfg/buildCfg.js` in your base):
```js
buildCfg(scopeNode, code) → {
  nodes: [{ id, kind, label, from, to, unreachable? }],  // id: "start" | "end" | "n0", "n1", …
  edges: [{ source, target, label? }]
}
// kind:  start | end | statement | decision | loop | return | raise | break | continue | try | except | finally | def
// edge label: True | False | next | done | loop | exception | return | break | continue  (omitted when unlabeled)
// labels are plain text (≤ 60 chars, may contain < > & " '); NO escaping has been applied.
```
Before coding, confirm it: `node --input-type=module -e "import {parser} from '@lezer/python'; import {buildCfg} from './webview/cfg/buildCfg.js'; const s='if a < b:\n  x = 1\n'; console.log(JSON.stringify(buildCfg(parser.parse(s).topNode, s)))"`
→ JSON with `nodes` and `edges` matching the shape above.

**Functions mode today** (`webview/functionParser.js` at 617cf26, lines 1–40) builds a Mermaid string:
```js
import { escapeLabel } from "./escapeLabel.js";
...
export function parseFunctions(tree, code) {
  const functions = new Map();
  findFunctions(tree.cursor(), code, functions, []);
  const nodeIds = new Map([...functions.keys()].map((name, index) => [name, `function${index}`]));
  const externalIds = new Map();
  const edges = new Set();
  let nextId = nodeIds.size;
  for (const [caller, calls] of functions) {
    for (const calledName of calls) {
      // Bare calls only reach top-level defs; nested defs and methods are not callable by bare name.
      let target = functions.has(calledName) && !calledName.includes(".") ? nodeIds.get(calledName) : externalIds.get(calledName);
      if (target === undefined) {
        target = `external${nextId++}`;
        externalIds.set(calledName, target);
      }
      edges.add(`${nodeIds.get(caller)} --> ${target}`);
    }
  }
  let mermaidCode = "flowchart TD\n";
  for (const [name, id] of [...nodeIds, ...externalIds]) {
    mermaidCode += `    ${id}["${escapeLabel(name)}"]\n`;
  }
  ...
```
`functions` is a `Map<qualifiedName, Set<calledBareName>>`, filled by `findFunctions(cursor, code, functions, scope)`.
It records **no source ranges** today.

**Webview entry** (`webview/main.js:44-62` at 617cf26):
```js
async function renderCurrentCode() {
  const revision = ++renderRevision;
  try {
    const tree = parser.parse(currentCode);
    const diagram = diagramMode === "functions"
      ? parseFunctions(tree, currentCode)
      : parseCode(tree, currentCode);
    const svg = await renderDiagram(diagram);
    if (revision !== renderRevision) {
      return;
    }
    display.setAttribute("role", "img");
    display.setAttribute("aria-label", `${diagramMode} flowchart`);
    display.innerHTML = svg;
```
`renderDiagram` is the Mermaid wrapper in `webview/render.js`.

**CSP** (`webview/index.html:6`): `default-src 'none'; img-src {{cspSource}} data:; style-src {{cspSource}} 'unsafe-inline'; script-src 'nonce-{{nonce}}';`.
There's no `'unsafe-eval'` and no `worker-src`. Verified at planning time: `elkjs@0.12.0/lib/elk.bundled.js` contains **0** occurrences
of `eval(` / `new Function` / `Function(`. It only creates a `Worker` when you pass `workerUrl`. Without it, it runs
in-thread ("FakeWorker"), so the current CSP is sufficient. Inline `<svg>` is plain DOM, and `style-src 'unsafe-inline'`
already allows SVG `style` attributes, although we use classes anyway.

**Measured at planning time** (Node 24.21, elkjs 0.12.0): bundled alone, 1,460,473 bytes. Layered layout of a synthetic
150-node CFG takes a median of about 150 ms. The current bundle (Mermaid) is about 3,548,684 bytes, so after this plan it will be
about 5.0 MB **temporarily**. Plan 015 removes Mermaid.

**Conventions**: webview code is ESM (`webview/package.json` = `{ "type": "module" }`), with named exports, double quotes,
2-space indent and semicolons. Unit tests live in `test/unit/*.test.mjs` using `node:test` + `node:assert/strict`. Copy the
skeleton of `test/unit/functionParser.test.mjs`. CSS uses VS Code theme variables only (see `webview/index.css`:
`color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Add dep | `npm install --save-dev --save-exact elkjs@0.12.0` | exit 0; `package.json` has `"elkjs": "0.12.0"` |
| Unit tests | `npm run test:unit` | exit 0, `ℹ fail 0` |
| Coverage | `node --test --experimental-test-coverage "test/unit/*.test.mjs"` | table incl. `webview/render/*.js` |
| Lint | `npm run lint` | exit 0 |
| Build | `npm run build:webview` | exit 0 (a size warning is fine) |
| Bundle size | `wc -c dist/webview/bundle.js` | a number (report it) |

**Do NOT run `npm test`.** The disk is nearly full, and `npm test` downloads a ~1 GB copy of VS Code. The reviewer runs
the integration tests. If any command reports `ENOSPC`, STOP.

## Scope

**In scope**:
- `package.json`, `package-lock.json`: the elkjs devDependency only
- `webview/render/toElk.js`, `webview/render/layout.js`, `webview/render/toSvg.js`, `webview/render/renderGraph.js` (create)
- `webview/functionParser.js`: add `functionGraph`; make `parseFunctions` a thin adapter over it
- `webview/main.js`: Functions mode uses the new pipeline; Timeline stays on Mermaid
- `webview/index.css`: styles for the new SVG classes
- `test/unit/toElk.test.mjs`, `test/unit/toSvg.test.mjs`, `test/unit/layout.test.mjs` (create)
- `test/unit/functionParser.test.mjs`: retarget at `functionGraph` (see Step 6)
- `scripts/fixture200.mjs` (create: the deterministic 200-line fixture, reused by plan 015)

**Out of scope**:
- `webview/render.js` (Mermaid), `webview/parser.js` (Timeline), `webview/escapeLabel.js`: deleted in plans 013/015, not here.
- Follow-cursor, the Flow view, the toolbar and `extension.js`: plan 013. Click/highlight/pan/zoom event wiring: plan 014.
  This plan only **emits** the attributes those plans need.
- `webview/cfg/*`: plans 010/011 own them. Import them; don't change them.
- A web worker for layout (D13: only if measurements require it).

## Git workflow

- Branch: `git checkout -b advisor/012-elk-svg-renderer <base>`, where `<base>` is the branch your reviewer names (it merges
  plans 010 + 011 on top of 617cf26). Then `npm ci`.
- Commits: short sentence case, e.g. `Added ELK layout and SVG renderer`, `Moved functions mode to the new renderer`. Do NOT push.

## Steps

### Step 1: Branch, install, baseline

Checkout per Git workflow, then `npm ci`, then run the drift check, then the `buildCfg` confirmation one-liner from "Current state".
**Verify**: `npm run test:unit` → `ℹ fail 0` (record pass/todo counts). `npm run build:webview && wc -c dist/webview/bundle.js`
→ record the "before" bundle bytes.

### Step 2: Add elkjs and prove it bundles under our CSP

`npm install --save-dev --save-exact elkjs@0.12.0`.
**Verify**:
- `node -e "console.log(require('./package.json').devDependencies.elkjs)"` → `0.12.0`
- `grep -c "eval(\|new Function" node_modules/elkjs/lib/elk.bundled.js` → `0`
- `git diff --stat` → only `package.json` and `package-lock.json`

### Step 3: `webview/render/toElk.js` (pure)

```js
export const FONT_PX = 12;          // must match .cfg-node text font-size in index.css
export const CHAR_W = 7.2;          // monospace average width at 12px
export function nodeSize(node) { ... }   // → { width, height }
export function toElk(graph) { ... }      // → ELK JSON graph
```
Sizing rules (deterministic, no DOM measuring):
- `textW = ceil(label.length * CHAR_W)`
- `statement | return | raise | break | continue | try | except | finally | def | function | external`:
  `width = max(80, textW + 24)`, `height = 32`
- `decision | loop` (diamonds): `width = max(96, textW + 56)`, `height = 56`
- `start | end` (stadium): `width = max(72, textW + 32)`, `height = 32`

Output:
```js
{
  id: "root",
  layoutOptions: {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",          // loop back-edges point upward
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", // keep source order
    "elk.spacing.nodeNode": "24",
    "elk.layered.spacing.nodeNodeBetweenLayers": "32",
    "elk.spacing.edgeLabel": "4",
    "elk.edgeLabels.inline": "true"
  },
  children: graph.nodes.map(n => ({ id: n.id, ...nodeSize(n) })),
  edges: graph.edges.map((e, i) => ({
    id: `e${i}`, sources: [e.source], targets: [e.target],
    ...(e.label ? { labels: [{ text: e.label, width: ceil(e.label.length * 6.6) + 8, height: 14 }] } : {})
  }))
}
```
Do not copy `kind`, `label`, `from` or `to` into the ELK graph. `renderGraph` merges them back by id (Step 5).
**Verify**: `npm run lint` → exit 0.

### Step 4: `webview/render/layout.js`

```js
import ELK from "elkjs/lib/elk.bundled.js";
const elk = new ELK();               // no workerUrl → runs in-thread (D13)
export function layout(elkGraph) { return elk.layout(elkGraph); }   // → Promise<laid-out graph>
```
**Verify**: `node --input-type=module -e "import {layout} from './webview/render/layout.js'; layout({id:'r',layoutOptions:{'elk.algorithm':'layered'},children:[{id:'a',width:10,height:10},{id:'b',width:10,height:10}],edges:[{id:'e',sources:['a'],targets:['b']}]}).then(g=>console.log(g.children.map(c=>c.id+':'+c.y).join(' '), g.edges[0].sections.length))"`
→ prints two ids with numeric y values and `1`.
If importing `elkjs/lib/elk.bundled.js` from an ESM module fails in Node (it's CommonJS), use
`import ELKModule from "elkjs/lib/elk.bundled.js"; const ELK = ELKModule.default ?? ELKModule;`, and note it.

### Step 5: `webview/render/toSvg.js` (pure) + `renderGraph.js`

`toSvg(laidOut, graph)` → an SVG **string**. `laidOut` is ELK's result; `graph` is the original `{nodes, edges}` (for kind,
label and ranges). Requirements:
- Root: `<svg xmlns="http://www.w3.org/2000/svg" class="cfg" viewBox="0 0 W H" width="W" height="H">`, where
  `W = laidOut.width + 32`, `H = laidOut.height + 32`, with all content inside `<g class="cfg-root" transform="translate(16,16)">`.
  (Plan 014 replaces this transform for pan/zoom, so keep exactly one `.cfg-root` group.)
- `<defs>` with one arrowhead marker: `<marker id="cfg-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="cfg-arrowhead"/></marker>`.
- **Edges first** (so nodes paint over them). For each ELK edge, find the original edge by index (`e${i}`):
  `<g class="cfg-edge cfg-edge--<label or plain>">`, then `<path d="M sx,sy L bx,by … L ex,ey" marker-end="url(#cfg-arrow)"/>`
  built from `sections[0].startPoint`, `bendPoints`, `endPoint`. If there's a label, add
  `<text class="cfg-edge-label" x=… y=…>` at the ELK label's `x + width/2`, `y + height - 3`, with `text-anchor="middle"`.
- **Nodes**: `<g class="cfg-node cfg-node--<kind>[ is-unreachable]" data-id="<id>" data-kind="<kind>" [data-from="<from>" data-to="<to>"] transform="translate(x,y)" tabindex="0" role="button" aria-label="<kind>: <label>">`.
  Omit `data-from`/`data-to` when `from` is null/undefined (externals in Functions mode). Shape by kind:
  - `decision`, `loop`: a diamond, `<polygon points="w/2,0 w,h/2 w/2,h 0,h/2"/>`
  - `start`, `end`: a stadium, `<rect width=w height=h rx=h/2/>`
  - everything else: `<rect width=w height=h rx="4"/>`
  - then `<text x=w/2 y=h/2 dominant-baseline="central" text-anchor="middle">label</text>`
- **Escaping**: one helper `xml(s)` replacing `& < > " '` with `&amp; &lt; &gt; &quot; &#39;`, applied to **every**
  interpolated string (labels, aria-labels, kinds, ids). Numbers are formatted with `Math.round(n * 10) / 10`.
- No colors and no inline `style` in the output: classes only.

`webview/render/renderGraph.js`:
```js
import { toElk } from "./toElk.js";
import { layout } from "./layout.js";
import { toSvg } from "./toSvg.js";
export async function renderGraph(graph) { return toSvg(await layout(toElk(graph)), graph); }
```
**Verify**: `npm run lint` → exit 0.

### Step 6: Functions mode produces graph data

In `webview/functionParser.js`:
- Record each defined function's source range when it's created in `findFunctions`: `from` = the
  `DecoratedStatement` parent's `from` if the parent is one, otherwise the `FunctionDefinition`'s `from`, and `to` = the def's `to`.
  The cursor gives you the node: `cursor.node`. Store a parallel `Map<qualifiedName, {from, to}>`, or change the map value
  to `{ calls: Set, from, to }`. Either is fine; keep the call-resolution logic and ID scheme from plan 006 unchanged.
- New export `functionGraph(tree, code)` → `{ nodes, edges }`:
  - defined functions: `{ id: "function<i>", kind: "function", label: qualifiedName, from, to }`
  - externals: `{ id: "external<n>", kind: "external", label: bareName, from: null, to: null }`
  - edges: `{ source, target }`, unique, in the same order as today's Mermaid edges.
- `parseFunctions(tree, code)` becomes an adapter: build `functionGraph`, then emit the **identical** Mermaid string as
  today (same header, same `id["escaped label"]` lines, same `-->` lines, same order). It stays only until plan 015.

Retarget `test/unit/functionParser.test.mjs`: keep every existing case, but assert on `functionGraph` output (labels, ids,
`source → target` pairs). Keep **exactly one** test calling `parseFunctions` with the old whole-output expected string
(`'flowchart TD\n    function0["a"]\n    external1["b"]\n    function0 --> external1\n'` for `"def a():\n  b()\n  b()\n"`)
as the adapter's regression guard. Add: a decorated def's `from` equals the decorator's offset; externals have `from === null`.
**Verify**: `npm run test:unit` → `ℹ fail 0`.

### Step 7: Unit tests for the renderer

- `test/unit/toElk.test.mjs`: the sizes for a short and a long label of each shape class; every node becomes an ELK child
  with the same id; every edge becomes an ELK edge; labelled edges carry `labels[0].text`; layoutOptions has
  `"elk.algorithm": "layered"` and `"elk.direction": "DOWN"`.
- `test/unit/toSvg.test.mjs`: use a **hand-written** laid-out fixture (no ELK). Assert:
  - a `decision` node renders a `<polygon`, and `start` renders `rx=` equal to half its height;
  - `data-from`/`data-to` are present for cfg nodes and absent for an external node;
  - a label `a < b & "c"` appears as `a &lt; b &amp; &quot;c&quot;` and the raw `<` never appears inside any `<text>`;
  - `aria-label`, `tabindex="0"` and `role="button"` are present;
  - an `is-unreachable` class appears on a node with `unreachable: true`;
  - exactly one `class="cfg-root"`.
- `test/unit/layout.test.mjs` (smoke, real ELK): `renderGraph(buildCfg(parser.parse(src).topNode, src))` for
  `src = "x = 0\nwhile x < 3:\n  if x == 1:\n    break\n  x += 1\nprint(x)\n"`. Assert the string starts with `<svg`, contains
  as many `class="cfg-node` as there are nodes, and the Start node's translate y is less than the End node's (top-to-bottom).
**Verify**: `npm run test:unit` → `ℹ fail 0`. Coverage → `toElk.js` and `toSvg.js` ≥ 90% lines (report the numbers).

### Step 8: Styles

Append to `webview/index.css`, using only theme variables (with fallbacks):
```css
.cfg { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
.cfg-node rect, .cfg-node polygon { fill: var(--vscode-editorWidget-background); stroke: var(--vscode-editorWidget-border, var(--vscode-contrastBorder, #888)); stroke-width: 1; }
.cfg-node--decision polygon, .cfg-node--loop polygon { fill: var(--vscode-editor-inactiveSelectionBackground); }
.cfg-node--start rect, .cfg-node--end rect { fill: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background)); }
.cfg-node text { fill: var(--vscode-editor-foreground); }
.cfg-node.is-unreachable { opacity: 0.5; }
.cfg-node.is-unreachable rect, .cfg-node.is-unreachable polygon { stroke-dasharray: 4 3; }
.cfg-node:focus { outline: none; }
.cfg-node:focus rect, .cfg-node:focus polygon { stroke: var(--vscode-focusBorder); stroke-width: 2; }
.cfg-edge path { fill: none; stroke: var(--vscode-editorLineNumber-foreground, #888); stroke-width: 1.2; }
.cfg-edge--True path { stroke: var(--vscode-testing-iconPassed, #3fb950); }
.cfg-edge--False path { stroke: var(--vscode-testing-iconFailed, #f85149); }
.cfg-edge--exception path { stroke: var(--vscode-errorForeground, #f85149); stroke-dasharray: 5 3; }
.cfg-edge--loop path { stroke-dasharray: 2 2; }
.cfg-arrowhead { fill: var(--vscode-editorLineNumber-foreground, #888); }
.cfg-edge-label { fill: var(--vscode-descriptionForeground); font-size: 10px; }
```
**Verify**: `grep -c "var(--vscode" webview/index.css` increases. `grep -n "#[0-9a-fA-F]\{3,6\}" webview/index.css` shows only fallbacks inside `var(...)`.

### Step 9: Switch Functions mode in `main.js`

In `renderCurrentCode`: if `diagramMode === "functions"`, compute `svg = await renderGraph(functionGraph(tree, currentCode))`.
Otherwise keep `renderDiagram(parseCode(tree, currentCode))` (Timeline, still Mermaid until plan 013). Update the imports
(`functionGraph` instead of `parseFunctions`). Everything else (revision check, `display.innerHTML = svg`, error path,
`updateCount`) stays the same. Empty Functions graph (no defs): `renderGraph` with zero nodes must not throw. If ELK
rejects an empty graph, return early with `display.textContent = "No functions in this file."` and note it.
**Verify**: `npm run lint` → exit 0. `npm run build:webview` → exit 0. `grep -c "parseFunctions" webview/main.js` → `0`.
Record `wc -c dist/webview/bundle.js` (expected about 5.0 MB; it drops in plan 015).

### Step 10: Fixture + timing metric

Create `scripts/fixture200.mjs` exporting `makeFunction(lines = 200)`. It returns a deterministic Python source string of one
function, `def big(xs):`, whose body cycles through these blocks until it has ≥ `lines` lines:
- an `if/elif/else` with assignments;
- a `for … in …:` containing an `if … : continue`;
- a `while … :` with a `break`;
- a `try/except/finally`;
- two plain assignments.

No randomness.
Measure in Node (5 warm-ups, then 10 runs, report the median and max):
```js
const src = makeFunction(200); const t = parser.parse(src); const fn = t.topNode.getChild("FunctionDefinition");
const g = buildCfg(fn, src);  // then time: await renderGraph(g)
```
**Verify**: prints the node/edge counts and timings. Report them (no gate here; plan 015 adds the < 300 ms gate).

### Step 11: Full gate

**Verify**: `npm run test:unit` → `ℹ fail 0`. `npm run lint` → exit 0. `npm run build:webview` → exit 0. `git status --short`
→ clean after your commits. The commits touch only in-scope files.

## Test plan

- New: `toElk.test.mjs` (≥ 5 tests), `toSvg.test.mjs` (≥ 6), `layout.test.mjs` (1–2 smoke tests with real ELK).
- Retargeted: `functionParser.test.mjs`. The same cases now run against `functionGraph`, plus one adapter regression test.
- Coverage: `toElk.js`, `toSvg.js` ≥ 90% lines.
- The reviewer runs the VS Code integration tests (`npm test`) and opens Functions mode manually.

## Done criteria

- [ ] `package.json` devDependencies has `"elkjs": "0.12.0"` (exact)
- [ ] `webview/render/{toElk,layout,toSvg,renderGraph}.js` exist; `toElk`/`toSvg` import nothing DOM-related
- [ ] `grep -n "style=" webview/render/toSvg.js` → no matches (classes only)
- [ ] `functionGraph` is exported; `parseFunctions` output is byte-identical to before (the adapter test passes)
- [ ] `main.js` Functions mode uses `renderGraph(functionGraph(...))`
- [ ] `npm run test:unit` exits 0 with `ℹ fail 0`; `npm run lint` exits 0; `npm run build:webview` exits 0
- [ ] METRICS reports: bundle bytes before/after, the 200-line fixture's node/edge counts, renderGraph median/max ms, and coverage of toElk/toSvg

## STOP conditions

- `grep "eval(\|new Function"` on `elk.bundled.js` is non-zero (a different version got installed). The webview CSP has no
  `'unsafe-eval'`, so ELK would fail at runtime.
- `npm run build:webview` fails to resolve something inside elkjs (e.g. `web-worker`). Report the exact error rather than
  adding externals or polyfills on your own.
- ELK's output has edges without `sections` or nodes without `x`/`y` for a normal CFG. Report a minimal graph that does this.
- The 200-line fixture's `renderGraph` median exceeds **1,000 ms** in Node. That would mean layout options or graph size
  are wrong, so report before continuing.
- Keeping `parseFunctions` byte-identical seems to require changing the plan-006 resolution logic.
- `ENOSPC`.

## Maintenance notes

- **Plan 013** feeds `buildCfg(findScope(...).node, code)` into `renderGraph` for the Flow view.
- **Plan 014** relies on: `data-id` / `data-from` / `data-to` on `.cfg-node` groups, exactly one `.cfg-root` group (it
  owns that group's `transform` for pan/zoom), and `tabindex/role/aria-label` already on nodes.
- **Plan 015** deletes `parseFunctions`, `escapeLabel.js`, `render.js` and Mermaid, and uses `scripts/fixture200.mjs` for the benchmark gate.
- Node sizes are estimated from character counts (no DOM measuring). If labels clip with a proportional editor font,
  raise `CHAR_W` or measure via a hidden `<canvas>` later. Don't do that in this plan.
- If layout ever exceeds the 300 ms budget (D12/D14), the next step is a web worker: elkjs supports `workerUrl`, which needs a
  `worker-src` CSP entry and a separate bundled worker file. D13 defers this until measurements show it's needed.
- 1.2 (collapse/expand) will need ELK compound nodes, which means hierarchical children. Keep `toElk` the single place that knows ELK's JSON.
