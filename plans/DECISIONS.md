# Design Decisions Log

A short record of each significant decision: the context, the options, the choice,
and how to explain it. Pair the claims with numbers from [`METRICS.md`](METRICS.md).

---

## Product principle: the graph is interactive (2026-11-05)
> "What makes our product strong is that the graphs should be interactive." (the user)

- **Interactivity is the differentiator.** Static code-to-flowchart tools already exist; a diagram that is live-linked to the editor is what sets PyChart apart.
- **Tie-breaker:** when features compete for time, the interactive one wins (for example over export, or over covering more statement types).
- **Pitch:** "Most code-to-flowchart tools give you a picture. Ours is a live view of your code: click a box to jump to the line, move your cursor and the box lights up, step through the branches yourself."

## D1: Target learners, not professional developers (2026-11-05)
- **Context:** the tool had two modes pulling different ways. Timeline (what the code does) suits learners; Functions (call graph) suits navigating large codebases.
- **Options:** learners / working developers / both.
- **Choice:** learners. Optimize for understanding a single script or function.
- **Trade-off:** we drop multi-file call graphs and big-repo scaling, and gain a focused product with a clear story.
- **How I'd explain it:** "We picked one user, students learning Python, and let that decide every feature trade-off."

## D2: Build a real control-flow graph as the main feature (2026-11-05)
- **Context:** "Timeline" was a flat list of statements. The README promised if/elif/else and loop structure that wasn't there.
- **Options:** a true control-flow graph / deepen the call graph / several small extras.
- **Choice:** a control-flow graph with decision nodes, True/False edges, loop back-edges, and correct targets for `return`/`break`/`continue`. Functions mode stays as a secondary view.
- **Design note:** build the graph as its own plain data structure (nodes and edges), separate from both the parser and the renderer. Python's syntax tree comes in on one side and drawing happens on the other, so each part can be tested on its own and swapped out.
- **How I'd explain it:** "I wrote a control-flow-graph builder over a Lezer syntax tree. That meant modelling how break, continue, return, and try/finally actually transfer control."

## D3: Move off Mermaid.js toward an interactive renderer (2026-11-05)
- **Context:** Mermaid turns text into a static SVG. It can't link nodes back to source lines, it caps diagram text at 50,000 characters, and it accounts for most of a 3.4 MiB bundle.
- **Choice:** replace it (the specific library is still to be decided, see D6). Mermaid stays for the 1.0 release.
- **How I'd explain it:** "Mermaid got us a prototype fast, but a text-to-SVG pipeline couldn't support interaction, so we took control of layout and rendering."

## D4: Release early (2026-11-05)
- **Choice:** publish 1.0 once the bug-fix plans 001–006 land. The control-flow graph ships as 1.1.
- **Why:** a live Marketplace listing with real installs, and the discipline of a branch that's always releasable.

## D5: Python first, language-neutral core later (2026-11-05)
- **Choice:** Python only for now. The control-flow-graph model doesn't reference Lezer node names, so another language would only need a new front end.
- **Also decided:** rebrand later (see D8).

## D6: ELK layout with our own SVG rendering (2026-11-05)
- **Context:** leaving Mermaid means owning layout (node positions, edge routes) and drawing.
- **Options:** elkjs + custom SVG / @dagrejs/dagre + custom SVG / Cytoscape.js.
- **Choice:** elkjs (the Eclipse Layout Kernel's "layered" algorithm, built for flowcharts) with our own SVG.
- **Why:** ELK breaks cycles for loop back-edges, routes edges at right angles, and supports nested groups such as loop bodies. With our own SVG, each element carries its source range, so click-to-source and highlighting are easy, and the diagram can use VS Code theme colours directly.
- **Watch:** elkjs is a large compiled library. Measure the bundle size against Mermaid's 3.4 MiB before and after.
- **Measured (2026-11-05):** elkjs 0.12.0 bundles to 1.39 MiB, 59% smaller than Mermaid. A 150-node layout takes about 150 ms. **Pinned version:** `elkjs@0.12.0`, released July 2026. That's mature, whereas 0.12.1 is only a week old.
- **How I'd explain it:** "Layout is the hard problem in graph drawing. I delegated it to a proven layered-layout engine and kept rendering in my own hands so the graph could be interactive."

## D7: Views and levels, starting with follow-the-cursor (2026-11-05)
- **Long-term vision:** drill-down levels. An overview of functions comes first; click a function to open its control-flow view, and so on.
- **First step:** the control-flow view follows the cursor (the function it's in, or module-level code), with a whole-file toggle. The drill-down levels come later.
- **How I'd explain it:** "We designed for progressive disclosure: a learner sees one function's logic at a time instead of a wall of boxes."

## D8: Keep the published extension ID; rebrand only the display name (2026-11-05)
- **Context:** `JenniferGao.pychart-extension` is already on the Marketplace. The ID (publisher.name) is permanent; renaming it would create a new extension and lose its installs.
- **Choice:** keep the ID and change `displayName` when a new brand is chosen.
- **Found during this decision:** published v1.0.0 is broken. Its manifest command ID doesn't match the code. Plan 001 now ships the fix as v1.0.1, marked P0.

## D9: The full interactivity set (2026-11-05)
- **Choice:** build all five interactions: click a node to jump to its source line, highlight the node for the cursor's line, pan and zoom, collapse/expand blocks, and step-through tracing. How to split them across releases is still open.
- **Enabler:** every graph node carries its source range (`from`/`to` offsets from the syntax tree). That one field powers click-to-source, cursor highlighting and step-through.
- **How I'd explain it:** "The diagram and the editor stay linked in both directions. Click a box and you land on the code; move through the code and its box lights up."

## D10: Plan for drill-down with a view stack; drop Mermaid-only work (2026-11-05)
- **Choice:** the panel holds a stack of views ("functions overview", "control-flow graph of `foo`"). 1.1 ships with one cursor-following view, and drill-down later just pushes more views. Today's Functions call graph becomes the future top level.
- **Dropped:** plan 005 (Timeline rewrite) and plan 007 (Mermaid theming). 1.1 replaces both, so the effort went to the live-product fixes (001–004, 006, 008, 009).
- **How I'd explain it:** "I cut work that the next release would throw away. Fixing the timeline would have polished a view we were about to delete."

## D11: Ship in stages (2026-11-05)
- **1.1:** the control-flow graph, the elkjs + SVG renderer, the view stack, click-to-source, cursor highlighting, pan/zoom.
- **1.2:** collapse/expand, plus step-through mode (a), where the learner walks the graph and picks True or False at each diamond. Mode (b), lighting nodes live from the VS Code debugger, comes only if there's time.
- **Why:** with 1–2 months part-time, staging means there's always a finished, published release to point to.

## D12: "Done" targets for 1.1, each a resume line (2026-11-05)
| Target | Goal | How measured |
|---|---|---|
| Bundle size | Smaller than the Mermaid build's 3,547,257 bytes | `ls -l dist/webview/bundle.js` |
| Re-render time | 200-line function: keystroke → updated diagram **< 300 ms** (to be tightened later) | timing in the webview (`performance.now()`) |
| Correctness | A unit test per control statement (if/elif/else, for/while incl. `else`, break/continue, return, try/except/finally, with, match), each asserting the expected edges | `npm run test:unit` |
| Coverage | ≥ 90% line coverage on the control-flow builder | `node --test --experimental-test-coverage` |
- **Ownership:** the user (CongAlex) is the main developer. Jennifer owns the `JenniferGao` publisher account and handles non-code work. The user is asking her for publisher access so releases don't wait on her (first needed for 1.0.1).
- **Naming:** choose the new display name just before 1.1, so the rebrand launches with the new renderer.
- **Export (SVG/PNG):** backlog, low priority. Screenshots cover the need. It stays cheap to add later because the renderer outputs SVG.
- **Coverage, explained:** the share of the builder's lines that run during the tests. It shows which Python features have no test at all, but not whether the tests check the right answer. That's why it's paired with the edge-asserting tests.

## D13: 1.1 architecture: a pipeline of pure stages (2026-11-05)
- **Pipeline:** Python source → Lezer tree → **scope** (`findScope`: the function the cursor is in, or the module) → **graph builder** (`buildCfg`: tree → plain `{nodes, edges}`) → **layout** (elkjs) → **SVG** (our renderer) → **interactions**.
- **Graph data model (the contract between stages):** each node has `id`, `kind` (`start | end | statement | decision | loop | return | raise | break | continue | call | ...`), `label`, and `from`/`to` source offsets. Each edge has `source`, `target`, and an optional `label` (`True | False | loop | exception`). It contains no Mermaid syntax and no Lezer types, so every stage can be unit-tested on plain data, and the front end could be swapped for another language later (D5). Edge labels in use (plan 010): `True | False | loop | exception | next | done | return | break | continue`.
- **Functions mode moves to the new renderer as well.** Otherwise Mermaid stays in the bundle, and Mermaid plus elkjs (~4.8 MiB) would miss the < 3.4 MiB target. The call graph is rebuilt to output the same `{nodes, edges}` shape.
- **Layout runs on the main thread first, with a web worker only if measurement shows it's needed.** The probe measured ~150 ms for 150 nodes, which fits the 300 ms budget. A worker adds content-security-policy and blob-URL complexity, so it waits until the numbers require it.
- **How I'd explain it:** "Each stage is a pure function over plain data. That made the control-flow logic testable in milliseconds without a browser, and the renderer swappable."


## D14: What the "< 300 ms re-render" target measures (2026-11-05)
- **Problem:** plan 009 added a 150 ms delay in the extension before sending edits, and the webview already waits 100 ms. If the clock started at the keystroke, 250 ms of the 300 ms budget would be deliberate waiting, not work.
- **Choice:** the target measures the **render pipeline**: from the code arriving in the webview to the SVG being on screen (parse → `findScope` → `buildCfg` → ELK layout → SVG). It's timed with `performance.now()` in the webview and reproduced by a Node benchmark of everything except DOM painting.
- **Also:** the total deliberate delay goes down to ≤ 150 ms (host 100 ms + webview 50 ms), so the time from keystroke to diagram stays under about 450 ms.
- **How I'd explain it:** "I separated intentional debounce from processing time. Users stop typing, then the pipeline renders a 200-line function in under 300 ms."

## D15: How the control-flow builder works (plan 010, 2026-11-05)
- **Pending-edge construction:** each statement builder takes a list of "pending" edges (loose arrow ends waiting for a target) and returns the new loose ends. A sequence just threads them through; an `if` returns the union of its branches' ends. This one idea composes every construct without special cases.
- **Abrupt exits through `finally`:** `break`, `continue`, `return` and `raise` inside a `try` with `finally` are routed into the `finally` block first, then re-routed from the end of the `finally` body to their real target. That's Python's actual semantics. A stack of "finally frames" decides whether a jump crosses a `finally` block.
- **Unreachable code is kept and flagged** (`unreachable: true`), not dropped. A learner sees that code after `return` never runs.
- **Half-typed code:** the parser recovers from syntax errors, so a statement with no `Body` falls back to a plain node. The diagram doesn't break mid-keystroke.
- **Known simplifications:** one `exception` edge per `try`, not one per statement; the exception type in `except E` doesn't pick a handler.
- **How I'd explain it:** "Each statement takes the dangling arrows from before it and returns its own dangling arrows. Loops, branches and try/finally all fall out of that. The trickiest part was `return` inside `try/finally`, which has to visit the `finally` block before leaving."

## D16: How the interactions stay fast (plans 013–015, 2026-11-05)
- **Highlight without re-layout:** each SVG node carries `data-from`/`data-to`. A cursor move runs `nodeAtOffset` (the smallest source range containing the cursor wins, about 0.5 µs) and toggles a CSS class. ELK runs only when the code or the function in view changes.
- **One pure decision function for rendering:** `renderAction(shown, rendering, wanted)` returns `highlight | cancel-and-highlight | wait | render`. Cursor moves never cancel useful work, and a stale render can't overwrite the right diagram. Because it's a pure function, every race case has a unit test.
- **Message ordering:** the host skips cursor messages while a code update is pending, so the webview never applies a new-document offset to old text.
- **Quality gates in `pretest`:** bundle-size check, render benchmark (median < 300 ms) and builder coverage (≥ 90%) fail the build on regression.
- **How I'd explain it:** "The expensive step, graph layout, only runs when the structure changes. Everything that happens as you move the cursor is a sub-microsecond lookup plus a CSS class."

## D17: 1.1 release decisions (2026-11-06)
- **Name:** keep **PyChart** for now; the rebrand is postponed. The ID stays `JenniferGao.pychart-extension`.
- **Arrow label:** when an `if`'s False branch is also a loop's back-edge, label it **False**, not `loop`. Learners read the condition first, and the upward arrow already shows the loop.
- **Version:** **1.1.0**, not 2.0.0. Timeline → Flow migrates saved settings automatically, so nothing breaks for users.
- **Must-have confirmed:** pan and zoom on the diagram ("I NEED to scroll around and zoom"). It's already built in plan 014 and is a must-pass item in the manual check before publishing.

## D18: 1.2 direction: visualize real execution, not quiz the learner (2026-11-06)
- **The user's words:** "ideally we won't have to manually choose… a mode where it automatically runs", and "I care less about quizzing the learner and more about helping the user visualize what's going on."
- **Choice:** step-through is driven by **real execution**. PyChart runs the file, records the lines executed, and plays the path back on the graph: current-node glow, visited tint, visit counts, play/pause/speed/scrub. Exceptions and `try/finally` follow what actually happened. Manual True/False stepping is only a fallback for code that can't run.
- **1.2 order (agreed):** polish (borders, hide built-ins, `self.method()` links) → run-and-trace replay → simple drill-down (Functions → Flow + Back) → collapse/expand.
- **How I'd explain it:** "The diagram shows not just what the code *could* do but what it *did*. We record a real run and replay it on the flowchart, so loops visibly go round and the exception path lights up when an error actually happens."

## D19: Two modes, live and run (2026-11-06)
- **Live mode (default, always on):** the static control-flow graph updates as you type. Nothing executes.
- **Run mode (only on ▶ Run):** PyChart runs the file with the user's selected Python interpreter under a small tracer (`sys.settrace`), records every executed line with its local variables and printed output, then **replays** the recording on the graph: current-node glow, visited tint, visit counts, play/pause/speed/scrub, a variables pane and an output pane synced to the step.
- **Chosen over** following the VS Code debugger live: replay gives automatic playback and scrubbing. Following the debugger could be added later on top of the same highlighting.
- **How I'd explain it:** "Typing never runs your code; the diagram just reflects its structure. Press Run and you get a recording of what actually happened, played back on the flowchart with the variable values at every step."

## D20: Run-mode behaviour (2026-11-06)
- **Editing ends playback:** any edit drops the recording and returns to live mode, with a "Code changed: ▶ Run to trace again" note. A stale path would highlight the wrong boxes.
- **Follows execution across functions:** playback switches the graph to whichever function is executing, with the title showing the call chain (`main › classify`). Each call has its own visit counts.
- **Limits:** the whole file runs like `python file.py`. It stops at 10,000 steps or 10 s and says so. `input()` isn't supported in v1, with a clear message.

## D21: Drill-down, collapse and variable display (2026-11-06)
- **Drill-down:** single click = jump to code (the same in every view). Double-click/Enter on a function in the Functions view opens its Flow graph. A ← Back button (Alt+←) and a breadcrumb (`Functions › classify`) show where you are. **Requirement from the user:** the UI must tell people what each input does (see D22).
- **Collapse/expand:** a ▸/▾ toggle on `for`/`while`/`if`/`try` folds the body into one box ("`for s in scores` · 7 steps"). Everything starts expanded, fold state is remembered per function for the session, and a folded box still glows and shows its total visit count during playback.
- **Variables in playback:** a strip under the graph shows the current function's variables, with values that just changed highlighted (`s: 73 → 12`). Hovering a visited box shows its last-seen values. A collapsible output strip is synced to the step. Values are not drawn inside boxes (that would force a re-layout on every step).

## D22: Make every control discoverable (2026-11-06)
- **Hover hints** on boxes and Run controls; a **"?" cheat sheet** of all mouse and keyboard controls; a **first-time tip banner** (dismissible, shown once).
- **Why:** the user asked that the UI "tell the user what inputs do what". Interactive features are worthless if nobody finds them.

## D23: 1.2 "done" targets, each a resume line (2026-11-06)
| Target | Goal |
|---|---|
| Tracing overhead | a 10,000-step run records in < 2 s extra |
| Playback step update (highlight + variables + output) | < 16 ms (one frame) |
| Tracer + replay logic coverage | ≥ 90% line, plus headless UI checks for play/pause/scrub/cross-function |
| Bundle | < 2 MB |
- **The user:** "Make sure to record all metrics." Every measurement goes in METRICS.md.

## D24: The headless UI test harness moves into the repo (2026-11-06)
- `npm run test:ui` drives the real panel (real CSP) in the installed Chrome via puppeteer-core, with no browser download. It's the first plan of 1.2 so every later plan is checked against the real UI.

## D25: Briefing: how Mermaid was replaced and how interaction works (2026-11-06)
- **Pipeline:** Python → Lezer tree → `buildCfg` {nodes, edges with from/to} → `toElk` → **elkjs computes positions only** → `toSvg` (our drawing: `data-from`/`data-to` on every box, theme CSS variables, escaped text) → `main.js` wiring. Mermaid was a black box that turned text into a static SVG. Owning the drawing is what made interaction possible. The bundle went from 3.5 → 1.57 MB.
- **Camera:** one SVG group with `translate(tx,ty) scale(s)`. Wheel → `panBy`; Ctrl+wheel/pinch → `zoomAt` keeps the point under the pointer fixed (`t' = p − (p − t)·k`); drag starts after a 4 px threshold (so clicks still work); Fit picks a scale ≤ 1 and centres. The layout never re-runs for these.
- **Click-to-source:** one delegated click listener → the box's `data-from/to` → `{type:'reveal'}` message → the host validates it and moves the editor selection.
- **Highlight:** the host sends the cursor offset (50 ms) → `nodeAtOffset` (smallest containing range, about 0.5 µs) → a CSS class. `renderAction` decides highlight-only vs re-layout.

## D26: ▶ Run saves the file first (2026-11-06, from plan 020)
- **Choice:** Run saves the document before tracing, the same as VS Code's "Run Python File". It doesn't trace an unsaved temp copy.
- **Why:** error messages, `__file__` and relative imports then refer to the real file. A temp copy would show a temp path in tracebacks.
- **Status:** flagged to the user, who can override it (an option is to never save and trace a temp copy instead).

## D27: The render benchmark is sensitive to machine load, so build headroom (2026-11-06)
- **Observed:** the same commit benchmarked at 167–202 ms earlier and at 316–324 ms later, with about 1 GB of RAM free and a nearly full disk. An interleaved A/B test proved the slowdown was the machine, not plan 019.
- **Implication:** "< 300 ms" is true on a normal machine but has no margin under memory pressure. ELK layout is about 95% of the cost.
- **Follow-up:** add a perf plan to 1.2 to tune ELK (e.g. `elk.layered.thoroughness`, the node-placement strategy) and cache layouts per function, aiming for ≤ 150 ms median so the claim survives a loaded machine. Measure with the same interleaved A/B method.

## D28: How the tracer works (plan 020, 2026-11-06)
- **Isolation:** `python/tracer.py` (stdlib only) runs the file via `runpy.run_path` under `sys.settrace`, recording only frames from the target file. The trace JSON goes to a temp file passed as an argument, **never stdout**, so the program's own prints can't corrupt it.
- **Safety:** spawned without a shell (an argument list, not a command string); a 15 s outer kill; the tracer's own limits are 10,000 steps / 10 s, using a `BaseException` subclass so `except Exception:` in user code can't swallow it; randomly named temp files, deleted in `finally`.
- **Interpreter choice:** ms-python's active environment → its execution command → `python` → `py -3` → `python3`, each checked with `--version`.
- **A CPython 3.12 pitfall found:** reading `frame.f_locals` on a *module* frame from a trace function writes the dict back afterwards and corrupts inlined comprehensions. The tracer reads `f_globals` for module frames instead.
- **How I'd explain it:** "The recorder is a 300-line pure-stdlib Python script. It can't break the user's program output, can't be stopped by their exception handling, and found a real CPython 3.12 edge case along the way."
