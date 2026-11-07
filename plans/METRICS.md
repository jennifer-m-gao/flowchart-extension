# PyChart: Project Metrics Log

Measured numbers for talking about the project (portfolio, resume, reviews).
**Rules:** log only numbers you actually measured, and give the command, the
commit, and the date for each. Each plan adds a "before → after" row when it
lands. Don't round in your favor.

## Baseline: `origin/master` @ `6ea6b96`, 2026-11-05

### Codebase size
| Metric | Value | How measured |
|---|---|---|
| Extension host source | 114 lines (`extension.js`) | `git show origin/master:<file> \| wc -l` |
| Webview source (JS) | 240 lines (main 67, parser 61, functionParser 95, render 17) | same |
| Webview markup/styles | 92 lines (index.html 24, index.css 68) | same |
| Test code | 31 lines, 2 integration tests, **0 unit tests** | `test/extension.test.js` |
| Shipped webview bundle | 3,547,257 bytes (~3.4 MiB, minified, Mermaid 11.17.2 inlined) | `ls -l dist/webview/bundle.js` |
| Packaged `.vsix` | 1,002,058 bytes (~0.96 MiB), from the `Prototype` build | `ls -l *.vsix` |

### Quality and health
| Metric | Value | How measured |
|---|---|---|
| Parser unit-test coverage | 0 tests on `parseCode` / `parseFunctions` | repo inspection |
| ESLint | 0 errors, 0 warnings | `npx eslint .` |
| `npm audit` (all deps) | 12 advisories: 1 critical, 8 moderate, 3 low | `npm audit` |
| Critical advisory in shipped code | 1 (dompurify 3.4.16 via mermaid; fixed in 3.4.17) | `npm ls dompurify` |
| Marketplace: `JenniferGao.pychart-extension` | v1.0.0 published 2026-10-10, **12 installs**; the command is **broken in the published build** (manifest/code ID mismatch, confirmed by unpacking the .vsix) | Marketplace gallery API + downloaded vsix |
| Command Palette entry works on master | **No**: the manifest ID doesn't match the registered ID | plan 001 |

### Parser correctness (baseline bugs, reproduced)
| Metric | Value | How measured |
|---|---|---|
| Timeline output growth with nesting depth | 5-deep → 511 chars; 10 → 1,719; 20 → 8,714; **30-deep → 25,009 chars** of Mermaid from 1,165 chars of Python (21×, quadratic) | node one-liner over `parseCode` (see plan 005) |
| Timeline output, flat code | ~36–41 chars of Mermaid per statement (100 → 3,627; 1,000 → 40,527) | same |
| Mermaid render limit | 50,000 chars (`maxTextSize`): a 30-deep file already uses 50% of it | grep in bundle |
| Augmented assignments shown (`x += 1`, `y -= 2`) | **0 of 2** (wrong grammar node names) | `parseCode` on a 3-line sample |
| Functions mode: 10 calls to the same function | **10 duplicate edges** (should be 1) | `parseFunctions` on a sample |

## 1.1 feasibility: elkjs probe (2026-11-05, scratchpad, Node 24.21, this dev machine)

| Metric | Value | How measured |
|---|---|---|
| elkjs 0.12.0 bundled alone (esbuild, minified IIFE) | **1,460,473 bytes (1.39 MiB)**, 442,480 gzipped: **59% smaller** than the Mermaid bundle (3,547,257) | `esbuild entry.js --bundle --minify`, entry imports `elkjs/lib/elk.bundled.js` |
| elkjs 0.9.3 / 0.11.0 bundled | 1,457,814 / 1,477,369 bytes | same |
| ELK layered layout, synthetic CFG (chain + a branch every 5 nodes + a back-edge every 20) | 50 nodes: median **46 ms**; 150 nodes: median **145–164 ms** (max 196); 300 nodes: median **235–271 ms** (max 493 on a cold run) | `bench.mjs`, 5 runs after 1 warm-up, `performance.now()` |
| Implication | A 200-line function (~150–200 nodes) spends ~50–65% of the 300 ms budget in layout alone, so layout must run off the UI thread (web worker) and re-layout must be skipped when the graph is unchanged | derived from the above |

## Changes log

Add a row per landed plan. Measure "after" with the same command as "before".

| Date | Plan | Metric | Before | After | Commit | Command |
|---|---|---|---|---|---|---|
| 2026-11-05 | 001 | Manifest command ID matches registered ID | `MISMATCH flowchart-extension.openFlowchart` | `OK` | 6be88e5 | consistency one-liner (plan 001 Step 4) |
| 2026-11-05 | 001 | VS Code integration tests (incl. running the command) | command not found on live 1.0.0 | **2/2 passing** (471 ms) | 6be88e5 | `npm test` (re-run by reviewer) |
| 2026-11-05 | 002 | Git-tracked files | 23 | 19 | aae5dd2 | `git ls-files | wc -l` |
| 2026-11-05 | 002 | Build output tracked in git | 3,550,910 bytes | 0 (generated on build; `vsce ls` still ships it) | aae5dd2 | `git ls-files dist`, `vsce ls` |
| 2026-11-05 | 003 | Parser unit tests | 0 | **10 passing + 8 todo** (known bugs pinned) | b2932ab | `npm run test:unit` |
| 2026-11-05 | 003 | Unit test run time | n/a (only a ~VS Code launch suite) | **157–172 ms** test time (1.2 s incl. npm startup) | b2932ab | `npm run test:unit`, `time` |
| 2026-11-05 | 003 | Line coverage: parser.js / functionParser.js | 0% / 0% | **100% / 94.7%** | b2932ab | `node --test --experimental-test-coverage` |
| 2026-11-05 | 004 | Unit tests | 10 pass + 8 todo | **19 pass + 6 todo** | a16660e | `npm run test:unit` |
| 2026-11-05 | 004 | Label escapers (copies / chars escaped) | 2 drifted copies; `<` `>` unescaped | **1 shared, escapes & " < > \n**; 100% line coverage | a16660e | grep + coverage |
| 2026-11-05 | 006 | Unit tests | 19 pass + 6 todo | **26 pass + 3 todo** | 272a03c | `npm run test:unit` |
| 2026-11-05 | 006 | Functions mode: 10 calls to one function | 10 duplicate edges | **1 edge**; same-named methods kept apart (`A.__init__` / `B.__init__`); nested calls attributed once | 272a03c | unit tests 1–3 |
| 2026-11-05 | 006 | functionParser.js line coverage | 94.7% | **95.6%** (uncovered: defensive no-name paths) | 272a03c | `node --test --experimental-test-coverage` |
| 2026-11-05 | 008 | `npm audit` | 12 (1 critical, 8 moderate, 3 low) | **11 (0 critical)**; remaining are dev-only tooling + low katex | 672de10 | `npm audit` |
| 2026-11-05 | 008 | dompurify bundled in shipped webview | 3.4.16 (critical advisory) | **3.4.17** | 672de10 | `npm ls dompurify`, grep bundle |
| 2026-11-05 | 009 | VS Code integration tests | 2 passing | **3 passing** (adds repeated open/close) | 617cf26 | `vscode-test` (reviewer) |
| 2026-11-05 | 009 | Listeners left in `context.subscriptions` per panel open/close | 2 leaked per cycle | **0** (disposed with the panel) | 617cf26 | code review + grep |
| 2026-11-05 | 009 | Host → webview full-text posts while typing | 1 per keystroke | **1 per 150 ms pause** (debounced) | 617cf26 | code review |
| 2026-11-05 | 011 | `findScope` (cursor → enclosing function) | n/a | **16 cases, 100% line + branch coverage**; unit tests 26 → 42 passing | 1f6afb3 | `node --test --experimental-test-coverage` |
| 2026-11-05 | 010 | Control-flow builder line / branch coverage | n/a (new) | **100% / 96.2%** (target ≥ 90% line) | 320a5aa | `node --test --experimental-test-coverage` |
| 2026-11-05 | 010 | Unit tests | 26 pass | **59 pass** (+33: every control statement + nested combos + half-typed input) | 320a5aa | `npm run test:unit` |
| 2026-11-05 | 010 | Graph build time, generated 200-line function (162 nodes, 201 edges) | n/a | **~0.74 ms** median (parse ~14 ms) | 320a5aa | plan 010 Step 6 script |
| 2026-11-05 | 012 | Full render (parse→graph→ELK layout→SVG), 200-line fixture: 194 nodes, 256 edges | n/a | **163–192 ms median** (layout ≈ 95% of it; max 376 ms on one run) | 3bbde8a | Node bench, 10 runs ×3 |
| 2026-11-05 | 012 | Render modules line coverage (toElk, layout, toSvg, renderGraph) | n/a | **100%** (toSvg branches 92.9%) | 3bbde8a | coverage |
| 2026-11-05 | 012 | Unit tests | 75 pass | **94 pass** | 3bbde8a | `npm run test:unit` |
| 2026-11-05 | 012 | Bundle (temporary: Mermaid + elkjs both shipped) | 3,548,800 B | 5,059,368 B (Mermaid removed in 015) | 3bbde8a | `wc -c` |
| 2026-11-05 | 013 | Shipped webview bundle | 3,548,800 B (1.0.1, Mermaid) | **1,567,207 B (−56%)**: Mermaid no longer imported, so the bundler drops it | 23748e8 | `npm run build:webview`, size |
| 2026-11-05 | 013 | Typing delays (host + webview) | 150 + 100 ms | **100 + 50 ms** (D14) | 23748e8 | code |
| 2026-11-05 | 013 | Re-layout on cursor move within the same function | n/a | **none** (scope key unchanged → skip) | 23748e8 | `viewState` unit tests |
| 2026-11-05 | 014 | Cursor-highlight lookup (`nodeAtOffset`), 194-node graph | n/a | **~0.5 µs per lookup**, no re-layout | 69cedcb | Node, 21×1,000 calls |
| 2026-11-05 | 014 | Unit tests | 94 pass | **119 pass**; interaction modules 100% line/branch coverage; all files 99.2% line | 69cedcb | test:unit + coverage |
| 2026-11-05 | 014 | Interactions shipped | 0 | **click/Enter → jump to line; cursor → node highlight; drag pan, Ctrl+wheel/pinch zoom, Fit, +/−/0 keys** | 69cedcb | integration 3/3 |
| 2026-11-05 | 015 | **1.1 gate: bundle** | 3,547,257 B (1.0.x, Mermaid) | **1,570,933 B (−55.7%)**; `check:bundle` 44.1% of the 3.4 MiB limit | d944caf | `npm run check:bundle` (reviewer re-run) |
| 2026-11-05 | 015 | **1.1 gate: render, 200-line function** (194 nodes, 256 edges) | n/a | **median 190–192 ms**, p95 232–269 ms (limit 300) | d944caf | `npm run bench` ×3 (reviewer re-run) |
| 2026-11-05 | 015 | **1.1 gate: graph-builder coverage** | n/a | **100% line**, 98.7% branch (limit 90%, enforced in `pretest`) | d944caf | `npm run test:coverage` (reviewer re-run) |
| 2026-11-05 | 015 | `npm audit` | 12 (1 critical) at 1.0.0 | **9 (0 critical, 0 high)**, all in dev test tooling, none shipped | d944caf | `npm audit` |
| 2026-11-05 | 015 | Lockfile | Mermaid + transitive deps | **−1,323 lines** removed | d944caf | `git diff --stat` |
| 2026-11-05 | 015 | Tests | 0 unit, 2 integration (1.0.0) | **110 unit + 3 integration**, all passing | d944caf | `npm run test:unit`, `vscode-test` |
| 2026-11-06 | 016 | Render benchmark variance (same commit) | 1 run under load: median 290.8 ms | 5 quiet runs: **median 186–202 ms**, p95 221–255 ms | ea210e6 | `npm run bench` ×5 (reviewer) |
| 2026-11-06 | 017 | Unit tests | 110 pass | **111 pass** (+ False-label regression test; verified it fails on the old builder) | 77d0a6f | `npm run test:unit` + old/new comparison |
| 2026-11-06 | 1.1 UI check | Headless-Chrome UI checks against the real panel (real CSP, simulated VS Code host) | 0 automated UI checks | **9/9 pass**: pan/zoom exact (Ctrl+wheel keeps the pointer fixed within 0.1 px), click-to-source exact range, highlight 0.4–1.5 ms, follow-cursor, zoom kept while typing, Functions mode, themes 6.8–10.6:1 text contrast, 0 console/CSP errors | e434a2e | scratch `ui-harness/run.mjs` (reviewer re-ran) |
| 2026-11-06 | 1.1 UI check | Code → diagram on screen, in the browser | n/a | **85 ms median** (includes 50 ms debounce) | e434a2e | ui-harness, 5 runs |
| 2026-11-06 | 018 | `npm run test:ui` in repo (headless Chrome, real panel CSP) | scratch only | **9/9 pass, 8.9 s wall** (incl. build); 0 browser downloads | 845f7f8 | `time npm run test:ui` (reviewer re-ran) |
| 2026-11-06 | 018 | `npm audit` after adding puppeteer-core | 9 (0 high) | 25.12.0: 12 (3 high, via zod) → **pinned 25.16.0: 9 (0 high)** | 845f7f8 | `npm audit` |
| 2026-11-06 | 019 | Box border vs background (Dark Modern / Light Modern / Light+) | 1.72 / 1.67 / 1.33 : 1 | **3.59 / 4.59 / 5.02 : 1** (≥ 3 WCAG 1.4.11) | 0a58997 | test:ui check 7 |
| 2026-11-06 | 019 | Start/End text contrast, Light+ | 3.82 : 1 (old palette) | **5.43 : 1** (VS Code 1.145.1 values) | 0a58997 | test:ui check 7 |
| 2026-11-06 | 019 | Functions view of demo.py, built-ins hidden | 10 nodes / 9 edges | **5 nodes / 3 edges**; `Cart()` → `Cart.__init__` | 0a58997 | test:ui check 8 |
| 2026-11-06 | 019 | Unit / UI checks | 111 / 9 | **126 / 14** (incl. a negative control proving the banner-clipping check catches the bug) | 0a58997 | test:unit, test:ui |
| 2026-11-06 | 019 | Bundle | 1,570,943 B | 1,574,802 B (+3.9 KB) | 0a58997 | check:bundle |
| 2026-11-06 | 019 | **Bench under memory pressure (1 GB RAM free, A/B interleaved)** | base 845f7f8: 316–324 ms | 019: 314–328 ms → **019 adds ≤ ~10 ms; machine is ~60% slower than earlier (167–202 ms)**. The < 300 ms claim holds only on an unloaded machine | 0a58997 | `npm run bench` A/B ×3 |
| 2026-11-06 | 020 | **Tracer overhead**, 10,932-step run (big.py) | untraced median 94 ms | traced median 737 ms → **+643 ms** (target < 2 s) | 94454a9 | 5+5 interleaved spawnSync runs |
| 2026-11-06 | 020 | Trace size for 10,932 steps | n/a | 882,031 B JSON (14,334 events) | 94454a9 | tracer output |
| 2026-11-06 | 020 | Infinite-loop safety (10 s cap tested at 1 s) | n/a | stops at 1,000 ms (tracer), 1.4 s wall; JSON write sped up from 2.3 s → 1.4 s | 94454a9 | infinite.py ×3 |
| 2026-11-06 | 020 | Unit tests | 126 | **145** (+8 real-Python tracer tests, +11 trace→node mapping) ; mapTrace.js 100% line | 94454a9 | test:unit, coverage |
| 2026-11-06 | 020 | CPython 3.12 bug avoided | n/a | reading module `f_locals` in a tracer corrupted comprehensions (printed `[]`): fixed by using `f_globals` for module frames | 94454a9 | scratch repro |
| 2026-11-06 | 021 | **Playback step update** (highlight + variables + output), same function | n/a | **median 0.2 ms, p95 1.1–1.2 ms** (target < 16 ms) | 42cada9 | test:ui R9, n=76 (reviewer re-ran: PASS) |
| 2026-11-06 | 021 | Step into another function | n/a | cached layout 1.0 ms median; first visit (ELK) 25 ms median | 42cada9 | test:ui R9 |
| 2026-11-06 | 021 | Player on a 10,017-step trace | n/a | load 24.7 ms; seek median 0.35 ms (max 1.9) | 42cada9 | player unit tests |
| 2026-11-06 | 021 | Tests | 145 unit / 14 UI | **166 unit / 24 UI**; player.js 100% line, scopes.js 100% | 42cada9 | test:unit, test:ui, coverage |
| 2026-11-06 | 021 | Bundle | 1,574,802 B | 1,584,333 B (limit lowered to **2,000,000**, 79.2%) | 42cada9 | check:bundle |
| 2026-11-06 | 021 | Replay correctness (demo-run.py, scores [5,−1,70,101,40]) | n/a | visit counts for 4 / if<0 4 / elif 3 / if≥50 2 match Python semantics; `s: 5 → −1` diff shown | 42cada9 | reviewer read screenshots |
| 2026-11-07 | 1.2.0 RC | Unit tests / coverage | 166 | **166 pass; 100% line (cfg + run), 96.83% branch** | 509c248 | test:coverage |
| 2026-11-07 | 1.2.0 RC | UI checks | 24/24 | **24/24 pass**; same-scope step p95 0.8 ms | 509c248 | test:ui |
| 2026-11-07 | 1.2.0 RC | Integration tests | 3/3 | **3/3 pass** | 509c248 | npm test |
| 2026-11-07 | 1.2.0 RC | Bench, 200-line function | n/a | 294 ms right after npm test (loaded), **221 ms median / 278 p95** rerun (limit 300) | 509c248 | npm run bench ×2 |
| 2026-11-07 | 1.2.0 RC | Bundle | 1,584,333 B | 1,584,954 B (79.2% of 2,000,000) | 509c248 | check:bundle |
| 2026-11-07 | 1.2.0 RC | Package contents | n/a | 26 files, 0 from plans/ | 509c248 | vsce ls |

## Resume-ready bullets

Fill these in only from rows in the changes log above.

- Rebuilt a VS Code extension (PyChart) that turns Python into **interactive control-flow graphs**: click a node to jump to its source line, the node under the cursor highlights live, and pan/zoom works on graphs of 190+ nodes.
- Wrote a **control-flow-graph builder** over a Lezer syntax tree covering if/elif/else, loops with `else`, break/continue, and return/raise routed through `try/finally`. **100% line coverage**, backed by 110 unit tests.
- Replaced Mermaid.js with **ELK layered layout + a custom SVG renderer**: bundle **−55.7%** (3.55 MB → 1.57 MB); a 200-line function re-renders in **~190 ms median** (target < 300 ms).
- Added CI-style quality gates (bundle-size, render-time benchmark, coverage ≥ 90%) wired into `pretest`, so regressions fail the build.
- Shipped a hotfix for a broken Marketplace release (command-ID mismatch affecting all installs), cleared the **only critical security advisory** (12 → 9 advisories, 0 critical), and took tests from **0 → 113** (110 unit + 3 integration).
