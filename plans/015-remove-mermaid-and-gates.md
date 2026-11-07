# Plan 015: Mermaid is gone, and 1.1's targets are enforced by scripts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: this plan *produces* PyChart 1.1's headline numbers. Report every number with its command in your
> METRICS section: bundle bytes before/after, bench median/p95, and coverage %. The reviewer copies them into `plans/METRICS.md`.
> Measure "before" on your base commit before changing anything.
>
> **Drift check (run first, after Step 1's checkout)**:
> `git diff --stat 617cf26..HEAD -- webview/render.js webview/escapeLabel.js package.json`
> Expected: `render.js` and `escapeLabel.js` unchanged; `package.json` changed only by plan 012 (`"elkjs": "0.12.0"`). Also confirm
> that `grep -rn "render.js\|renderDiagram" webview --include=*.js` matches only inside `webview/render.js` itself (plan 013 removed
> the last caller). If not, STOP.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: plans/014-interactions.md (it runs last; it deletes what 012–013 left behind)
- **Category**: direction / tech-debt (1.1 release gates)
- **Executor model**: sonnet / medium
- **Planned at**: commit `617cf26` (1.0.1 tip), 2026-11-05

## Why this matters

1.1's "done" is defined by four measurable targets (D12 in `plans/DECISIONS.md`):

| Target | Goal |
|---|---|
| Bundle size | smaller than the Mermaid build's 3,547,257 bytes, i.e. **< 3.4 MiB** |
| Re-render time | a 200-line function renders in **< 300 ms** (D14: the pipeline, from code received to SVG string, excluding the deliberate debounce) |
| Correctness | a unit test per control statement (plan 010) |
| Coverage | **≥ 90% line coverage** on the control-flow builder |

Until Mermaid is removed, the bundle contains both renderers (about 5 MB). This plan deletes Mermaid and its leftovers, then turns
each target into a script that **fails** when the target is missed, so the numbers stay true after 1.1. Those numbers are
the resume lines the maintainer asked for.

## Current state (after plans 012–014, verify in your base)

- `webview/render.js` (617cf26, unchanged since):
  ```js
  import mermaid from "mermaid";
  mermaid.initialize({ startOnLoad: false, theme: "dark", themeVariables: { … } });
  export async function renderDiagram(code) {
    const { svg } = await mermaid.render(`flowchart-${Date.now()}`, code);
    return svg;
  }
  ```
  No longer imported by `main.js` after plan 013.
- `webview/escapeLabel.js` (Mermaid entity escaping, `#lt;` etc.): only used by `parseFunctions` in `webview/functionParser.js`.
  `test/unit/escapeLabel.test.mjs` tests it.
- `webview/functionParser.js`: `functionGraph(tree, code)` (used by `main.js`) plus `parseFunctions(tree, code)`, the Mermaid
  adapter kept only for one regression test in `test/unit/functionParser.test.mjs` (plan 012 Step 6).
- `package.json` (617cf26 + plan 012):
  ```json
  "scripts": {
    "build:webview": "esbuild webview/main.js --bundle --minify --format=iife --outfile=dist/webview/bundle.js",
    "vscode:prepublish": "npm run build:webview",
    "lint": "eslint .",
    "test:unit": "node --test \"test/unit/*.test.mjs\"",
    "pretest": "npm run test:unit && npm run build:webview && npm run lint",
    "test": "vscode-test"
  },
  "devDependencies": { …, "elkjs": "0.12.0", …, "mermaid": "^11.4.1", … }
  ```
- `scripts/fixture200.mjs` (plan 012) exports `makeFunction(lines = 200)`, a deterministic 200-line Python function.
- `.vscodeignore` excludes `test/**`, `node_modules/**` and others, but not `scripts/**`.
- **Verified at planning time on Node 24.21**: `node --help` lists `--test-coverage-include`, `--test-coverage-exclude`,
  `--test-coverage-lines`, `--test-coverage-branches` and `--test-coverage-functions`. A run with `--test-coverage-lines=101` exits **1**
  (so the threshold actually fails the command), and `--test-coverage-include="<path>"` restricts the report to matching files.
- **Measured at planning time**: esbuild bundling only `elkjs/lib/elk.bundled.js` + `@lezer/python` (minified IIFE) = **1,554,872 bytes**.
  The real bundle adds our own modules (tens of KB), so expect about 1.6 MB.
- 3.4 MiB = 3,565,158.4 bytes, so the gate is `size < 3565158`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Uninstall | `npm uninstall mermaid` | exit 0 |
| Unit tests | `npm run test:unit` | `ℹ fail 0` |
| Coverage gate | `npm run test:coverage` | exit 0; the buildCfg row ≥ 90 |
| Bench | `npm run bench` | prints median/p95; exit 0 |
| Bundle gate | `npm run build:webview && npm run check:bundle` | exit 0 |
| Lint | `npm run lint` | exit 0 |

**Do NOT run `npm test`** (the disk is nearly full; the reviewer runs it). On `ENOSPC`, STOP.

## Scope

**In scope**: delete `webview/render.js`, `webview/escapeLabel.js` and `test/unit/escapeLabel.test.mjs`; `webview/functionParser.js`
(remove `parseFunctions` and the `escapeLabel` import); `test/unit/functionParser.test.mjs` (remove the adapter test);
`package.json`/`package-lock.json` (remove mermaid; add scripts); create `scripts/bench.mjs` and `scripts/check-bundle.mjs`;
`.vscodeignore` (add `scripts/**`); `README.md`; `CHANGELOG.md`.

**Out of scope**: any behaviour change in `webview/cfg/*`, `webview/render/*`, `webview/interact/*`, `main.js` or `extension.js`.
If a gate fails, **report it**; don't tune code to pass it here. Bumping `package.json` `version` and publishing are the user's release step.

## Git workflow
- Branch: `git checkout -b advisor/015-remove-mermaid <base>` (normally plan 014's branch), then `npm ci`.
- Commits, e.g. `Removed Mermaid`, `Added bench, coverage and bundle gates`, `Updated README and changelog for 1.1`. Do NOT push.

## Steps

### Step 1: Branch, install, before-metrics
Checkout, `npm ci`, drift check. Then record:
- `npm run build:webview && wc -c dist/webview/bundle.js` → **bundle before** (expected about 5.0 MB)
- `npm run test:unit` counts.

### Step 2: Delete the Mermaid path
- `git rm webview/render.js webview/escapeLabel.js test/unit/escapeLabel.test.mjs`
- In `webview/functionParser.js`: delete `parseFunctions` and the `escapeLabel` import. Keep `functionGraph` and all helpers.
- In `test/unit/functionParser.test.mjs`: delete the single `parseFunctions` adapter test (and its import).
- `npm uninstall mermaid`.

**Verify**:
- `grep -rn "mermaid\|escapeLabel\|parseFunctions\|renderDiagram" webview test --include=*.js --include=*.mjs` → no matches
- `node -e "console.log(require('./package.json').devDependencies.mermaid)"` → `undefined`
- `npm ls dompurify` → empty (it came only from mermaid)
- `git diff --stat package-lock.json` shows only removals (many lines). Spot-check that `node_modules/elkjs` and `node_modules/@lezer/python` are still present.
- `npm run test:unit` → `ℹ fail 0`; `npm run build:webview` → exit 0; `wc -c dist/webview/bundle.js` → **bundle after** (record it).

### Step 3: `scripts/check-bundle.mjs` + script
```js
import { statSync } from "node:fs";
const LIMIT = 3565158; // 3.4 MiB, D12 target
const size = statSync(new URL("../dist/webview/bundle.js", import.meta.url)).size;
console.log(`bundle: ${size} bytes (limit ${LIMIT}, ${((size / LIMIT) * 100).toFixed(1)}%)`);
if (size >= LIMIT) { console.error("bundle size gate FAILED"); process.exit(1); }
```
Add `"check:bundle": "node scripts/check-bundle.mjs"` to the package.json scripts.
**Verify**: `npm run check:bundle` → prints the size and exits 0.

### Step 4: `scripts/bench.mjs` + script
Times the pure pipeline, exactly as the webview runs it apart from DOM insertion:
```js
import { parser } from "@lezer/python";
import { makeFunction } from "./fixture200.mjs";
import { findScope } from "../webview/cfg/findScope.js";
import { buildCfg } from "../webview/cfg/buildCfg.js";
import { renderGraph } from "../webview/render/renderGraph.js";
const LIMIT_MS = 300; // D12/D14
const code = makeFunction(200);
const offset = code.indexOf("\n") + 3;          // inside the function body
async function once() {
  const t0 = performance.now();
  const tree = parser.parse(code);
  const scope = findScope(tree, code, offset);
  const graph = buildCfg(scope.node, code);
  await renderGraph(graph);                      // toElk → ELK layout → toSvg
  return { ms: performance.now() - t0, nodes: graph.nodes.length, edges: graph.edges.length };
}
```
Run 3 warm-ups, then 10 measured runs. Print `lines`, `nodes`, `edges`, `median`, `p95` (sorted index `ceil(0.95*n)-1`), `max`, and exit 1 if `median >= LIMIT_MS`.
Add `"bench": "node scripts/bench.mjs"`.
**Verify**: `npm run bench` → prints the stats and exits 0. If it exits 1, that's a STOP (report the numbers; don't optimise here).

### Step 5: Coverage gate script
Add:
```json
"test:coverage": "node --test --experimental-test-coverage --test-coverage-include=\"webview/cfg/**\" --test-coverage-lines=90 \"test/unit/*.test.mjs\""
```
**Verify**:
- `npm run test:coverage` → the report lists only `webview/cfg/*` files, `buildCfg.js` line % ≥ 90, exit 0.
- Prove the gate bites: run the same command with `--test-coverage-lines=101` and confirm exit code 1. Don't commit that.
- If the include glob matches nothing (an empty table), try `--test-coverage-include="webview/cfg/*.js"`, and note which form worked.

### Step 6: Wire the gates into `pretest`
```json
"pretest": "npm run test:coverage && npm run build:webview && npm run check:bundle && npm run lint",
```
(Keep `test:unit` as a standalone script for quick runs.)
**Verify**: run the pretest chain manually, **without** `npm test`:
`npm run test:coverage && npm run build:webview && npm run check:bundle && npm run lint` → exit 0.

### Step 7: Packaging hygiene
Add `scripts/**` to `.vscodeignore`. These are dev tools; the extension doesn't need them at runtime.
**Verify**: `npx --yes @vscode/vsce ls 2>/dev/null | grep -c "^scripts/"` → `0`, and `grep -c "dist/webview/bundle.js"` on the same output → `1`.
If `npx` can't download vsce, record it and check `.vscodeignore` by eye.

### Step 8: README + CHANGELOG
- `README.md` "Features": replace the bullet beginning `- Real-time parsing` and the Mermaid bullet with:
  - **Flow view**: an interactive control-flow graph of the function under your cursor: decisions, loops and `break`/`continue`/`return` drawn where control really goes.
  - **Follows your cursor**: move into another function and the diagram follows. A "Whole file" toggle shows module-level flow.
  - **Click to jump**: click any box to select its code. The box for your cursor's line is highlighted.
  - **Pan and zoom**: drag, Ctrl+wheel or pinch, and Fit.
  - **Functions view**: a call graph of the file's functions.

  In "Development", add `npm run test:unit`, `npm run test:coverage`, `npm run bench` and `npm run check:bundle`, one line each.
- `CHANGELOG.md`: add `## [1.1.0]` above `## [1.0.1]` with bullets for the above, and "Replaced Mermaid with an ELK layout + custom SVG
  renderer (bundle X → Y bytes)", filled in with **your measured numbers**. Do **not** change `package.json` `version`.

**Verify**: `grep -c "Mermaid" README.md` → `0`; `grep -n "1.1.0" CHANGELOG.md` → 1 match.

### Step 9: Full gate
`npm run test:unit` → `ℹ fail 0`; `npm run test:coverage` exit 0; `npm run bench` exit 0; `npm run build:webview && npm run check:bundle` exit 0;
`npm run lint` exit 0; `git status --short` clean after the commits.

## Test plan

- No new behaviour tests (this plan deletes and measures). The gates themselves are the tests: `test:coverage` (≥ 90% on
  `webview/cfg`), `bench` (median < 300 ms), `check:bundle` (< 3.4 MiB). Step 5 proves the coverage gate fails when it should.
- The reviewer runs `npm test`: the pretest now runs all gates, then the 3 VS Code integration tests.

## Done criteria

- [ ] `grep -rn "mermaid" package.json webview test` → no matches; `npm ls mermaid dompurify` → empty
- [ ] `webview/render.js`, `webview/escapeLabel.js`, `test/unit/escapeLabel.test.mjs` deleted; `parseFunctions` gone
- [ ] `npm run check:bundle` exit 0 (bundle < 3,565,158 bytes)
- [ ] `npm run bench` exit 0 (median < 300 ms)
- [ ] `npm run test:coverage` exit 0 (≥ 90% lines on `webview/cfg/**`), and the 101% dry run exits 1
- [ ] `pretest` runs coverage, build, bundle and lint gates
- [ ] README/CHANGELOG updated with measured numbers; `package.json` version unchanged
- [ ] METRICS: bundle bytes before/after (and % reduction vs 3,547,257), bench lines/nodes/edges/median/p95/max, coverage % per `webview/cfg` file, unit test counts

## STOP conditions

- The drift check shows something still importing `render.js`/`renderDiagram` (plan 013 incomplete).
- `npm uninstall mermaid` removes or changes `elkjs` or `@lezer/python` entries in the lockfile.
- Any gate fails (bundle ≥ limit, bench median ≥ 300 ms, coverage < 90%). **Report the numbers.** Fixing performance or coverage is
  a separate plan, so don't change thresholds or code to pass.
- `--test-coverage-include` / `--test-coverage-lines` aren't recognised by the Node version in your environment (`node -v`; planning used 24.21).
- `ENOSPC`.

## Maintenance notes

- The thresholds live in code: `LIMIT` in `scripts/check-bundle.mjs`, `LIMIT_MS` in `scripts/bench.mjs`, and `--test-coverage-lines` in package.json. D14
  says to tighten the render target later; change `LIMIT_MS` and record it in `plans/DECISIONS.md`.
- `bench` runs in Node, not the webview. The webview adds DOM insertion plus highlight. If users report lag, add a `performance.now()`
  span around `display.innerHTML = …` and compare.
- If layout ever pushes the bench over budget, the next step is the ELK web worker (D13), not raising the limit.
- 1.2 work (collapse/expand, step-through) must keep all three gates green. That's the point of putting them in `pretest`.
