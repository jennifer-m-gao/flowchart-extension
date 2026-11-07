# Plan 021: ▶ Run plays the recorded execution back on the flowchart

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: report every number you measure (test counts, timings, sizes, before/after values) in your report, each with its command and commit. The maintainer records ALL metrics.
>
> **Drift check (run first, after branching)**: `git diff --stat e434a2e..HEAD -- webview/main.js webview/index.html webview/index.css scripts/check-bundle.mjs`
> Plans 018 (test:ui), 019 (polish, including the "?" cheat sheet and hover hints) and 020 (tracer, `webview/run/mapTrace.js`, the host `run` handler) land before this one. Their changes are expected. Read `webview/main.js` **in full** before editing. STOP only if the render pipeline (`update()` → `renderGraph` → `mountSvg` → `highlight()`) or the `.cfg-node[data-id]` markup no longer exists.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (it's the biggest UI change since 1.1)
- **Depends on**: plans/020 (the trace format, `mapTrace.js`, the host `run` handler) and plans/018 (`test:ui`)
- **Category**: feature (1.2 Run & replay, part 2 of 2)
- **Executor model**: opus / high
- **Planned at**: commit `e434a2e`, 2026-11-06

## Why this matters

The user wants to **see what their code actually did** (D18). That means: press ▶ Run, and the flowchart replays the real run.
- The current box glows and visited boxes get a tint with visit counts, so loops visibly go round.
- The view follows execution into each function, with a title like `main › classify`.
- A strip shows the variables, with values that just changed highlighted (`s: 73 → 12`), and printed output appears in step.
- Play, pause, step, speed and a scrubber control playback.

Typing never runs code. Any edit ends playback and returns to live mode (D19, D20). Each playback step must update in **under 16 ms** (D23), so playback stays smooth.

## Current state

- **Trace format v1** (produced by plan 020's `python/tracer.py`, posted by the host as `{type:"trace", trace, codeVersion}`):
  - `trace.events`: an array of `{"e":"call"|"line"|"return"|"exception", "c":callId, "q":qualname (co_qualname, e.g. "A.m.<locals>.inner"), "l":line (1-based), "d":depth, "n"?:repeat count, "v"?:{"set":{name:repr},"del":[names]}, "x"?:excType}`
  - `trace.output`: `[stepIndex, "out"|"err", text]`
  - `trace.reason`: one of `"done"`, `"limit"`, `"input-not-supported"`, `"exit"`, `"exception"`
  - `trace.exception`: `{type, message, line}`
  - The host also posts `{type:"runStatus", state:"running"|"done"|"error", reason?, message?}`.
- `webview/run/mapTrace.js` (plan 020) exports `normalizeQualname`, `lineStarts`, `mapStepToNode(graph, code, line, starts)` and `scopeForStep(qualname, scopes)`. `call` events → the scope's `start` node; `return` events → `end`.
- `webview/main.js` today (`git show e434a2e:webview/main.js`): `update()` builds a graph for the current view, renders it with `renderGraph(graph)` (ELK layout, about 150 ms for 200 lines) and mounts the SVG via `mountSvg(fitKey)`, which sets up the pan/zoom root `.cfg-root`. `highlight()` toggles `.is-current` on `.cfg-node[data-id="…"]`. The keyboard handler (lines 282–305) uses `+`/`=`, `-` and `0`, and Enter/Space on a focused node. It ignores events with modifiers and events inside `select, input`.
- `webview/render/renderGraph.js`: `renderGraph(graph) = toSvg(await layout(toElk(graph)), graph)`. Every node is a `<g class="cfg-node cfg-node--<kind>" data-id data-kind data-from data-to transform=…>` containing a `rect`/`polygon` and a `text`.
- CSS (`webview/index.css`): `.cfg-node.is-current rect, … polygon { stroke: var(--vscode-editorCursor-foreground…); stroke-width: 2.5 }`. Colours always come from `--vscode-*` variables.
- `scripts/check-bundle.mjs`: `LIMIT = 3565158`. The bundle is currently about 1,570,943 bytes.
- `test/ui/run.mjs` (plan 018) drives the real panel in headless Chrome. It posts host messages with `window.postMessage`, reads `window.__posted`, and saves screenshots.
- Conventions: ESM, double quotes, 2-space indent, `node:test` unit tests in `test/unit/*.test.mjs`. Keep logic pure and DOM glue thin; plan 014 did this with `viewport.js`/`nodeAtOffset.js`.

## Decisions already made (do not revisit)

- Run starts **only** from the ▶ Run button, or the keyboard shortcut below. Never automatically (D19).
- **Any `setCode` whose code differs from the code that was run** ends playback. Live mode resumes and a note says `Code changed — ▶ Run to trace again` (D20).
- **Follow execution across functions.** The title shows the call chain, and each call has its own visit counts (D20).
- **Values aren't drawn inside boxes.** They go in a variables strip plus hover tooltips (D21).
- The bundle stays under 2 MB (D23). This plan lowers `check:bundle`'s `LIMIT` to **2,000,000**.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Unit tests | `npm run test:unit` | exit 0 |
| Coverage | `npm run test:coverage` | exit 0 (`webview/run/**` ≥ 90% line; plan 020 added the include) |
| Build + bundle gate | `npm run build:webview && npm run check:bundle` | exit 0, under the new 2,000,000 limit |
| Bench | `npm run bench` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| UI tests | `npm run test:ui` | exit 0, including the new run-mode checks |
| Do NOT run | `npm test` | (the disk is tight; the reviewer runs the VS Code integration tests) |

## Scope

**In scope**:
- `webview/run/player.js` (create; pure)
- `webview/run/scopes.js` (create; uses Lezer + `findScope` to list every function scope with its qualifiedName and node)
- `webview/main.js` (run-mode glue), `webview/index.html` (Run button, run toolbar, strips), `webview/index.css` (run classes)
- The cheat sheet / hint markup from plan 019. Add the run controls to it, wherever 019 put it.
- `test/unit/player.test.mjs`, `test/unit/scopes.test.mjs` (create)
- `test/ui/run.mjs` and `test/ui/fixtures/` (extend with run-mode checks)
- `scripts/check-bundle.mjs` (`LIMIT` → 2000000)

**Out of scope**:
- `python/tracer.py` and `extension.js`. Plan 020 owns them. If the trace format is missing something you need, STOP and report.
- `webview/cfg/*` and `webview/render/*`. Use them unchanged.
- Collapse/expand (plan 023) and drill-down (plan 022). Leave hooks only; see Maintenance notes.

## Git workflow

- Branch: `git checkout -b advisor/021-replay-ui <plan-020 branch>` (the reviewer names it), then `npm ci`.
- Commits: short sentence case, e.g. `Added replay player`, `Added run toolbar and replay rendering`, `Added run-mode UI tests`.
- Do NOT push.

## Steps

### Step 1: `webview/run/scopes.js`

`listScopes(tree, code)` → `Map<qualifiedName, { node, qualifiedName }>`, containing `"<module>"` → the top node plus every `FunctionDefinition` in the tree. Get each function's qualifiedName by calling `findScope(tree, code, fnNode.from)`, which keeps it identical to the follow-cursor naming.

Tests (`test/unit/scopes.test.mjs`): methods (`Cart.add_item`), nested functions (`outer.inner`), decorated, async, and the `<module>` entry.

**Verify**: `npm run test:unit` → 0 fail.

### Step 2: `webview/run/player.js` (pure; the core of this plan)

```
export function loadTrace(trace, { scopes, graphFor, code })
  // graphFor(scopeKey) -> {nodes, edges} (the caller passes a cached buildCfg).
  // Precompute ONE entry per "line"/"call"/"return" event:
  //   { scopeKey, nodeId, callId, line, chain:[qualnames outer->inner], callOrdinal:{k, of} }
  // - nodeId via mapTrace (call -> start, return -> end, line -> mapStepToNode)
  // - chain from the call/return stack (normalised qualnames; "<module>" omitted unless it's alone)
  // - full locals per entry by applying the "v" diffs per callId; changedKeys = keys set in this entry
  //   (with the previous value kept for "old -> new")
  // - output: concatenate all chunks into one string with a prefix-end index per step (seek is a slice, not a join)
  // Returns { steps, reason, exception, total }.
export function createPlayer(loaded)  // state: { index, playing, speed }
  // next(), prev(), seek(i) clamped to [0, total-1]; play()/pause()/toggle(); setSpeed(1..20 steps/s)
export function frameAt(loaded, index)
  // -> { step, scopeKey, nodeId, chain, callOrdinal, locals, changed:{name:[old,new]},
  //      visits: Map<nodeId, count> for steps of the SAME callId with idx <= index (a node's "n" repeats count as 1 visit),
  //      visited: Set<nodeId>, lastSeen: Map<nodeId, locals>, outputText }
```
Performance: `frameAt` must be cheap for any index. Keep, per callId, its sorted step indices so visits/lastSeen only scan that call's steps up to `index` (≤ 10k, well under 1 ms). Don't scan the whole trace per frame.

**Verify**: `npm run lint` → exit 0.

### Step 3: Player tests (`test/unit/player.test.mjs`)

Use a **committed fixture trace**:
1. Create a deterministic `test/ui/fixtures/demo-run.py`. Use the 1.1 sample `demo.py` but with fixed scores, e.g. `scores = [5, -1, 70, 101, 40]`, no `random`, and no file I/O. Have `load()` read a path that doesn't exist inside its `try`, so the exception path is exercised.
2. Generate its trace with plan 020's tracer into `test/ui/fixtures/demo-run.trace.json`.
3. Add `scripts/make-fixture-trace.mjs` to regenerate it, and run it once.

Cases:
- `total` is the number of line/call/return events. `seek` clamps; `prev` at 0 stays 0; `next` at the end stays at the end and `playing` becomes false.
- **Follow across functions:** an index inside `classify` has `scopeKey === "classify"` and `chain` deep-equals `["main","classify"]`. `callOrdinal` is `{k:1, of:1}`, and `{k:2, of:3}` style for a function called several times. Add a fixture call to show the latter.
- **Visits:** within one `classify` call, the `for` loop node's visit count equals elements + 1. A `continue` returns to the loop node, and `break` prevents later body visits.
- **Locals and changes:** at a step after `s` changes, `changed.s` is `[old, new]`. `results` accumulates. A function's locals don't leak into another call's frame.
- **Output:** `outputText` at the last step equals the program's whole stdout, and at an early step it is a prefix.
- **Exception and finally:** for the `load()` path, an `except` node is visited and the `finally` body is visited before `load`'s `end`.
- **Reason:** propagated from the trace.
- **Perf:** `frameAt` over all indices sequentially. Report the max and median ms; each should be **< 2 ms**.

**Verify**: `npm run test:unit` → 0 fail. `npm run test:coverage` → `player.js` and `scopes.js` ≥ 90% line. Report the %.

### Step 4: Markup and CSS

`index.html`:
- **Toolbar:** a `▶ Run` button (`#run`, with title "Run this file and replay it (Ctrl+Enter)").
- **Run toolbar** (`#run-bar`, hidden in live mode): `⏮` (`#run-prev`), `▶/⏸` (`#run-play`), `⏭` (`#run-next`), a speed range input (`#run-speed`, 1–20, default 4, label "steps/s"), a scrubber range input (`#run-scrub`), a step counter (`#run-pos`, e.g. "14 / 212"), and `■ Back to live` (`#run-stop`).
- **Variables strip** (`#run-vars`).
- **Collapsible output strip** (`<details id="run-output"><summary>Output</summary><pre></pre></details>`).
- **Banner** (`#run-banner`, `role="status"`).

`index.css` adds `.is-step` (the current step: thicker, brighter stroke using `--vscode-debugIcon-continueForeground` with a `--vscode-focusBorder` fallback), `.is-visited` (fill tint using `--vscode-editor-findMatchHighlightBackground`), `.cfg-badge` (small text, top-right of the node), and `.run-changed` (highlight in the variables strip, using `--vscode-diffEditor-insertedTextBackground`). Colours only via `--vscode-*` variables with fallbacks, as in the rest of `index.css`. Add the run controls to plan 019's cheat sheet:

> ▶ Run / Ctrl+Enter: run & replay · Space: play/pause · ← →: step · Home/End: first/last step · Esc: back to live

**Verify**: `npm run build:webview` → exit 0, and `npm run lint` → exit 0.

### Step 5: Run-mode glue in `main.js`

State: `mode = "live" | "running" | "replay"`. Also keep `runCode` (the code string at the moment Run was pressed), `loaded`, `player`, a timer, and `layoutCache: Map<string /* code + "\u0000" + scopeKey */, { svg, graph, contentW, contentH }>`.

1. **#run click / Ctrl+Enter:** `runCode = currentCode`. Post `{type:"run"}`. Show "Running…" in the banner and disable `#run`.
2. **runStatus error:** show the message in the banner, re-enable Run, and stay in live mode.
3. **trace message:** if `currentCode !== runCode`, show the "Code changed — ▶ Run to trace again" banner and ignore the trace. Otherwise:
   - Build `scopes = listScopes(tree, code)`.
   - `graphFor = key => buildCfg(scopes.get(key).node, code)`, memoised.
   - `loaded = loadTrace(...)` and `player = createPlayer(loaded)`. Set `mode = "replay"`.
   - Show `#run-bar`, set the scrubber max to `total-1`, and show a reason banner when `reason !== "done"`: limit → `Stopped after 10,000 steps (or 10 s)`, input-not-supported → `input() isn't supported yet`, exception → `ValueError: bad (line 12)`, exit → `Program exited (code N)`.
   - Then call `showStep(0)`.
4. **`showStep(i)`:** this is the hot path; measure it with `performance.now()`, keep `lastStepMs`, and log it with `console.debug`.
   - `f = frameAt(loaded, i)`.
   - If `f.scopeKey` differs from the shown scope: mount the SVG from `layoutCache`, or render once with `renderGraph` and cache it. Mount via the existing `mountSvg`, keyed so it fits only on the first show of that scope.
   - Then, **without re-layout**:
     - Remove the old `.is-step`, `.is-visited` and badges.
     - Add `.is-step` to `f.nodeId`.
     - Add `.is-visited` plus a `<text class="cfg-badge">` holding the count (only when ≥ 2) for each node in `f.visits`. Create badge elements with `document.createElementNS` and append them to the node `<g>`, positioned using that node's rect/polygon width from its bbox.
     - Set `title` attributes / `<title>` children holding the `lastSeen` locals on visited nodes.
   - Title: `f.chain.join(" › ")`, plus ` (call k/of)` when `of > 1`.
   - Variables strip: `name: value` items; changed ones get `.run-changed` and show `old → new`.
   - Output `<pre>`: `f.outputText`, scrolled to the bottom.
   - Scrubber value = `i`, and `#run-pos` shows the position.
5. **Playback:** `play()` uses `setTimeout` chained at `1000/speed`, calling `next()` then `showStep`, and stops at the end. Space toggles. ← and → step (pausing first). Home and End jump. Dragging the scrubber seeks. Esc or `#run-stop` → back to live (see 6). Keys apply only in replay mode and are ignored inside `select`/`input` (except the scrubber's own arrows) and when modifiers are held. Keep the existing `+ - 0` zoom keys working.
6. **Leaving replay:** on `#run-stop`/Esc, or on a `setCode` whose `code !== runCode`:
   - Stop the timer and hide `#run-bar` and the strips.
   - Clear the run classes and badges, and set `mode = "live"`.
   - Call `update()` so the live view re-renders.
   - On `setCode`, also show the banner `Code changed — ▶ Run to trace again` (D20).
   
   `setCursor` messages in replay mode don't change the scope; they may still highlight with `.is-current`, which is fine.
7. **Click-to-source** keeps working in replay. Clicking a node still posts `reveal`.

**Verify**: `npm run lint` → exit 0. `npm run build:webview && npm run check:bundle` → exit 0, after Step 6 lowers the limit.

### Step 6: Bundle limit

Set `LIMIT = 2000000` in `scripts/check-bundle.mjs`, with the comment `// 2 MB, D23 (1.2) target`.

**Verify**: `npm run check:bundle` → exit 0. Report the bytes and the %.

### Step 7: UI tests (`test/ui/run.mjs`)

Add a run-mode section. It uses `demo-run.py` as the code (via `setCode`) and the committed `demo-run.trace.json`, so it doesn't depend on Python.
1. Clicking `#run` makes `__posted` include `{type:"run"}`.
2. Post `{type:"trace", trace, codeVersion: 1}` → `#run-bar` is visible, the title starts with `<module>` or `main`, and exactly one `.is-step` node exists.
3. **Play:** click play, wait 600 ms at speed 20 → the index advanced by more than 5 steps. **Pause:** click pause, wait 300 ms → the index is unchanged.
4. **Scrub:** set the scrubber to the first step inside `classify` (find it from the trace in the test) and dispatch `input` → the title is `main › classify`, the SVG has the `classify` graph's node count, and `.is-step` sits on the expected node id.
5. **Variables:** at a step where `s` changes, a `.run-changed` item shows `s:` and `→`.
6. **Output:** at the last step, the output `<pre>` text equals the fixture's expected stdout.
7. **Badges:** at the end of `classify`'s first call, the `for` loop node has a `.cfg-badge` whose text equals its visit count.
8. **Edit ends replay:** post `setCode` with an added line → `#run-bar` is hidden, the banner says "Code changed", and the live graph is shown.
9. **Step-update time:** seek through every step with `→` and read `lastStepMs` (expose it as `window.__lastStepMs` for the harness). Report the median and p95. Cross-function switches count separately: report the first-switch time (layout) and the cached-switch time. **Gate: the p95 of same-scope steps < 16 ms** (D23).
10. **No console errors / CSP violations** during run mode, and screenshots `shots/run-*.png` for the playing, cross-function, variables and output states.

**Verify**: `npm run test:ui` → exit 0 with all run-mode checks PASS.

### Step 8: Full gate and metrics

Run, and report each key line:
- `npm run test:unit` (counts before/after)
- `npm run test:coverage` (the `webview/run/**` %)
- `npm run build:webview` and `npm run check:bundle` (bytes; must be < 2,000,000)
- `npm run bench`
- `npm run lint`
- `npm run test:ui` (all checks, with the step-time median/p95, first/cached switch times and screenshot paths)

Also report `loadTrace` time for the fixture and for a synthetic 10,000-step trace (build one in a unit test from repeated fixture events). The target is < 100 ms; report it, but it isn't a gate.

`git status --short` must be clean after your commits.

## Test plan

- `test/unit/scopes.test.mjs` (≥ 5 cases) and `test/unit/player.test.mjs` (≥ 10 cases, including perf), both on the committed fixture trace.
- `test/ui/run.mjs`: 10 run-mode checks against the real panel with a simulated host. Pattern: the existing checks in the same file (plan 018).
- `npm run test:coverage` enforces ≥ 90% line on `webview/run/**`.

## Done criteria

- [ ] `npm run test:unit` 0 fail; `npm run test:coverage` exit 0 (`player.js`, `scopes.js` ≥ 90%)
- [ ] `npm run test:ui` exit 0; same-scope step update **p95 < 16 ms**, with the numbers reported
- [ ] `npm run check:bundle` exit 0 with `LIMIT = 2000000`; bytes reported
- [ ] An edit during replay returns to live mode with the "Code changed" note (UI check 8)
- [ ] The cheat sheet lists the run controls
- [ ] lint, build and bench exit 0; only in-scope files changed

## STOP conditions

- A step update needs a re-layout for same-scope steps to get correct highlighting. It must be class/attribute toggles only.
- The p95 same-scope step time is ≥ 16 ms after badge DOM reuse and avoiding `innerHTML` rebuilds. Report the profile.
- The trace format lacks something you need (e.g. column info). Report it; don't change the tracer.
- The bundle would exceed 2,000,000 bytes.
- Plan 019's cheat-sheet location can't be found.

## Maintenance notes

- **Plan 023 (collapse/expand):** a folded box must still glow and show the total visit count (D21). Have `frameAt` consumers map hidden node ids to their fold owner. Keep the `visits` Map as the source of truth.
- **Plan 022 (drill-down):** the view stack gains Functions → Flow views. Replay always forces Flow-follow-execution; leaving replay restores the previous view.
- **Debugger-follow (future):** the same `showStep`-style highlighting could be driven by debugger `stopped` events instead of a recorded trace. Keep `showStep` decoupled from where steps come from.
- **Reviewer focus:** that `showStep` does no layout for same-scope steps; that `runCode` vs `currentCode` gating is right; that keyboard handlers don't swallow keys in inputs; and that badges are cleaned up on every step.
