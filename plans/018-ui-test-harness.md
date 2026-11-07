# Plan 018: The repo has `npm run test:ui`, a headless-Chrome test of the real webview

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: report EVERY number you measure (before/after values, test counts, timings, sizes, audit counts) to the reviewer in a METRICS section, with the exact command. The reviewer logs them in `plans/METRICS.md` (the user asked that all metrics be recorded). Measure "before" on the base commit before changing anything.
>
> **Drift check (run first, after Step 1's checkout)**: `git diff --stat e434a2e..HEAD -- package.json .gitignore .vscodeignore .vscode-test.mjs webview/index.html webview/main.js webview/index.css test/ README.md`
> If any of these changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (first plan of 1.2; every later 1.2 plan uses it as a gate)
- **Effort**: S
- **Risk**: LOW (test-only; adds one devDependency; ships nothing)
- **Depends on**: none (base is the 1.1.0 release candidate)
- **Category**: tests / dx
- **Executor model**: sonnet / medium
- **Planned at**: commit `e434a2e` (branch `advisor/017-label-and-version`), 2026-11-06

## Why this matters

The 1.1 webview (pan/zoom, click-to-source, cursor highlight, follow-cursor, themes) was verified by a headless-Chrome harness that lives in a scratch folder and will be lost. VS Code's own test runner cannot see inside a webview, so without this harness nothing checks the real UI automatically. This plan moves the harness into the repo as `npm run test:ui`, so every later 1.2 plan (polish, run & replay, drill-down, collapse) is checked against the real panel, under the real Content-Security-Policy, by executors and reviewers alike (decision D24 in `plans/DECISIONS.md`).

## Current state

**The harness to port** (verified 9/9 PASS against `e434a2e` on 2026-11-06). Read all four files fully before starting:
`C:\Users\entit\AppData\Local\Temp\claude\640caed1b714a218\e77165e1-a18b-464f-9e3c-5105b60922ba\scratchpad\ui-harness\`
- `server.mjs` (85 lines): a `node:http` server. `harnessHtml(origin)` reads `webview/index.html` and fills the placeholders the way `extension.js` does, keeps the CSP meta intact, injects a nonce'd shim before the bundle, and adds a `<style>` with VS Code "Dark Modern"/"Light Modern" variable sets switched by `body.vscode-dark` / `body.vscode-light`. It serves only `webview/` and `dist/` (like `localResourceRoots`), and answers `/favicon.ico` with 204.
  - Key lines to change: `export const CHECKOUT = process.env.PYCHART_CHECKOUT || "C:\\Users\\entit\\projects\\pychart-1.1-test";`
  - The shim: `window.__posted=[];window.__state=undefined;window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState:()=>window.__state,setState:s=>{window.__state=s}});`
- `run.mjs` (365 lines): launches Chrome via `puppeteer-core`, records console errors, page errors, HTTP ≥ 400, failed requests and `securitypolicyviolation` events, then runs these checks, printing `[PASS]`/`[FAIL]` per check and setting `process.exitCode = failed.length ? 1 : 0`:
  R render time, 1 pan/zoom, 2 click-to-source, 3 cursor highlight (LF + CRLF), 4 follow cursor + whole file, 5 typing keeps zoom, 6 Functions mode, 7 themes, C no console/CSP errors.
  - Key lines to change:
    ```js
    const CHROME = process.env.CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const LF = fs.readFileSync(path.join(CHECKOUT, "sample", "demo.py"), "utf8").replace(/\r\n/g, "\n");
    ```
  - It writes `shots/*.png` and `results.json` next to itself.
- `package.json`: `{"name":"ui-harness","private":true,"type":"module","dependencies":{"puppeteer-core":"^25.12.0"}}`
- `README.md`: usage notes and a check table. Reuse its content.

**The fixture**: copy `C:\Users\entit\projects\pychart-1.1-test\sample\demo.py` (53 lines: `classify`, `load`, `class Cart` with `__init__`/`add_item`, `main`). The checks search for exact substrings in it (`results = []`, `if s < 0`, `qty -= 1`, `f = open(path)`, `results.append("pass")`, `print("all scores read")`, `return results`, and `    for s in scores:\n`). Copy it **byte for byte**.

**Repo facts at `e434a2e`:**
- `package.json` scripts:
  ```json
  "test:unit": "node --test \"test/unit/*.test.mjs\"",
  "test:coverage": "node --test --experimental-test-coverage --test-coverage-include=\"webview/cfg/**\" --test-coverage-lines=90 \"test/unit/*.test.mjs\"",
  "check:bundle": "node scripts/check-bundle.mjs",
  "bench": "node scripts/bench.mjs",
  "pretest": "npm run test:coverage && npm run build:webview && npm run check:bundle && npm run lint",
  "test": "vscode-test"
  ```
  devDependencies are listed alphabetically (`@lezer/python` … `globals`). There is no `puppeteer-core` yet.
- `.vscode-test.mjs`: `files: 'test/**/*.test.js'`. So files under `test/ui/` must NOT end in `.test.js`.
- `.vscodeignore` line 4: `test/**`. So `test/ui/` is already excluded from the `.vsix`.
- `.gitignore`: `node_modules`, `.vscode-test/`, `*.vsix`, `.env`, `dist/`.
- `eslint.config.mjs` applies rules only to `**/*.js`. `.mjs` files are parsed but get no rules (the same as the existing `test/unit/*.test.mjs` and `scripts/*.mjs`).
- `README.md` has a `## Development` section listing the npm scripts.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm ci` | exit 0 |
| Unit tests | `npm run test:unit` | `ℹ fail 0`, `ℹ pass 111` (unchanged by this plan) |
| Coverage gate | `npm run test:coverage` | exit 0 |
| Build | `npm run build:webview` | exit 0 |
| Bundle gate | `npm run check:bundle` | exit 0, `bundle: 1570943 bytes` (± small) |
| Bench | `npm run bench` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| UI tests (new) | `npm run test:ui` | exit 0, `10/10 passed` (9 checks plus R) |
| Packaging check | `npx --yes @vscode/vsce ls \| grep -c "^test/"` | `0` |

**Do NOT run `npm test`.** The disk is tight, and it downloads about 1 GB of VS Code. The reviewer runs it.

## Scope

**In scope** (create or modify only these):
- `test/ui/server.mjs` (create, ported)
- `test/ui/run.mjs` (create, ported)
- `test/ui/fixtures/demo.py` (create, exact copy)
- `test/ui/README.md` (create, from the scratch README, updated paths)
- `package.json`: the `devDependencies` entry and the `test:ui` script only
- `package-lock.json`: only what `npm install` adds for `puppeteer-core`
- `.gitignore`: add `test/ui/shots/` and `test/ui/results.json`
- `README.md`: one bullet in `## Development`

**Out of scope** (do NOT touch):
- Anything under `webview/`, `extension.js`, `scripts/`, `test/unit/`, `test/extension.test.js`. This plan changes no product code. If a check fails, report it; don't fix the product.
- `pretest`. Do not add `test:ui` to it (see Step 4).
- The scratch harness folder. Read it; don't modify it.

## Git workflow

- Branch: `git fetch origin` then `git checkout -b advisor/018-ui-test-harness advisor/017-label-and-version`. Use the base your reviewer names if different.
- Commits: short sentence case, like the repo history, e.g. `Added headless UI test harness`.
- Do NOT push.

## Steps

### Step 1: Branch, install, baseline

Check out as in Git workflow, run `npm ci`, run the drift check. Then record the baseline:
- `npm run test:unit` → `ℹ pass 111`, `ℹ fail 0`
- `npm audit 2>&1 | tail -1` → note the summary line (expected `9 vulnerabilities (1 low, 8 moderate)`)

**Verify**: `git log -1 --format=%h` → `e434a2e`.

### Step 2: Add puppeteer-core (exact pin, no browser download)

`npm install --save-dev --save-exact puppeteer-core@25.12.0`

`puppeteer-core` never downloads a browser (that's what plain `puppeteer` does). npm may re-sort `devDependencies` in `package.json`. If it does, restore the original order and keep only the new `"puppeteer-core": "25.12.0"` line, inserted alphabetically (after `globals`).

**Verify**:
- `node -e "console.log(require('./package.json').devDependencies['puppeteer-core'])"` → `25.12.0`
- `git diff package.json` → exactly one added line, plus a comma on the previous line
- `git diff --stat package-lock.json` → additions only for `puppeteer-core` and its dependencies. Check with `git diff package-lock.json | grep '^-' | grep -v '^---' | head`, which should show no removed or changed versions of existing packages.
- `ls ~/.cache/puppeteer 2>/dev/null` (and `%USERPROFILE%\.cache\puppeteer`) → no new Chrome download

### Step 3: Port the harness into `test/ui/`

Copy `server.mjs`, `run.mjs` and `README.md` into `test/ui/`, and `demo.py` into `test/ui/fixtures/demo.py`. Make exactly these changes:

1. **Repo root, not a checkout path.** In `server.mjs`:
   ```js
   const HERE = path.dirname(fileURLToPath(import.meta.url));
   export const CHECKOUT = process.env.PYCHART_CHECKOUT || path.resolve(HERE, "..", "..");
   ```
   Keep the env override, which is useful for testing another checkout.
2. **Fixture path.** In `run.mjs`, read `path.join(HERE, "fixtures", "demo.py")` instead of `CHECKOUT/sample/demo.py`.
3. **Fail clearly on a missing bundle.** Before launching Chrome: if `path.join(CHECKOUT, "dist", "webview", "bundle.js")` doesn't exist, print `dist/webview/bundle.js missing: run npm run build:webview first` and exit 1. (The script in Step 4 builds first anyway; this covers running `node test/ui/run.mjs` directly.)
4. **Browser discovery.** Replace the `CHROME` constant with `findBrowser()`, which returns the first path that exists:
   - `process.env.CHROME` (if set and the file exists)
   - Windows: `%ProgramFiles%\Google\Chrome\Application\chrome.exe`, `%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe`, `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`, `%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe`, `%ProgramFiles%\Microsoft\Edge\Application\msedge.exe`
   - macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`
   - Linux: `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/microsoft-edge`

   If none is found: print `SKIP: no Chrome/Edge found (set CHROME=<path>)` and exit **0**, so the test never breaks a machine without a browser. Print the browser path used at the start of a run.
5. **Output location.** Write `shots/` and `results.json` under `test/ui/` (they already are, relative to `HERE`). Add both to `.gitignore`:
   ```
   test/ui/shots/
   test/ui/results.json
   ```
6. **README.** In `test/ui/README.md`, update the run instructions to `npm run test:ui`, the env vars (`CHROME`, `PYCHART_CHECKOUT`), and remove the scratch paths. Keep the check table and the "Limits" section.

Change nothing else in the checks. The thresholds and logic were verified 9/9 against this exact code.

**Verify**: `node test/ui/run.mjs` (after `npm run build:webview`) → the last line is `10/10 passed` and the exit code is `0`. Results include R and C as separate rows, which is why there are 10 lines for 9 checks; report the exact count you see.

### Step 4: Add the `test:ui` script (NOT in `pretest`)

In `package.json` `scripts`, after `"bench"`:
```json
"test:ui": "npm run build:webview && node test/ui/run.mjs",
```
Do **not** add it to `pretest`. **Why:** `pretest` gates every `npm test` and must stay fast, offline and browser-independent. `test:ui` needs a local Chrome/Edge, starts a browser and takes tens of seconds. It's run explicitly before each release and by reviewers for UI-affecting plans. Add this bullet to `README.md` `## Development`:
```markdown
- `npm run test:ui` runs the webview in headless Chrome/Edge (found automatically, or set `CHROME=<path>`), under the real CSP, and checks pan/zoom, click-to-source, cursor highlight, follow-cursor, Functions mode and themes. Run it before every release. Screenshots land in `test/ui/shots/`.
```

**Verify**:
- `npm run test:ui` → exit 0, `10/10 passed`. Record the wall time with `time npm run test:ui`.
- The no-browser path. Put `findBrowser(candidates = defaultCandidates())` in `test/ui/server.mjs` and export it, so the list can be injected. `run.mjs` calls `findBrowser()`, and when it returns `null`, it prints the SKIP line and exits 0. Check it with `node --input-type=module -e "import {findBrowser} from './test/ui/server.mjs'; console.log(findBrowser(['/nope/chrome']), findBrowser() !== null)"`, which should print `null true`. (Importing `server.mjs` must not start the server: it only starts when run directly, as the scratch version already does.)

### Step 5: Prove it is isolated from the other test runners

**Verify**:
- `npm run test:unit` → still `ℹ pass 111` (the `test/unit/*.test.mjs` glob doesn't match `test/ui/`)
- `node -e "const {globSync}=require('fs');console.log(globSync('test/**/*.test.js'))"` → `[ 'test\\extension.test.js' ]` (or the `/` form), so vscode-test won't pick up the ui files
- `npx --yes @vscode/vsce ls | grep -c "^test/"` → `0`
- `npm run lint` → exit 0
- `git status --short` after running `test:ui` → `test/ui/shots/` and `results.json` do **not** appear (they're gitignored)

### Step 6: Full gate and commit

Run `npm run test:unit`, `npm run test:coverage`, `npm run build:webview`, `npm run check:bundle`, `npm run bench`, `npm run lint` and `npm run test:ui`. All must exit 0. Then run `npm audit 2>&1 | tail -1` and report the before/after summary. puppeteer-core may add advisories; report any that are high or critical.

Commit (one or two commits). `git status --short` must be clean.

## Test plan

- No new unit tests. This plan *is* a test suite.
- The ported suite must reproduce the scratch result exactly: `[PASS]` for R, 1–7 and C.
- Pattern: the scratch `run.mjs`, unchanged except for the Step 3 edits.

## Done criteria

- [ ] `npm run test:ui` exits 0 and prints `[PASS]` for every check (R, 1, 2, 3, 4, 5, 6, 7, C)
- [ ] `package.json` has `"puppeteer-core": "25.12.0"` (exact) and the `test:ui` script; `pretest` is unchanged
- [ ] `npm run test:unit` → `ℹ pass 111`, `ℹ fail 0` (unchanged)
- [ ] `npx @vscode/vsce ls | grep -c "^test/"` → `0`
- [ ] `test/ui/shots/` and `test/ui/results.json` are gitignored; `git status --short` is clean after a run
- [ ] `test:coverage`, `build:webview`, `check:bundle`, `bench` and `lint` all exit 0
- [ ] No files outside the in-scope list changed (`git diff --stat e434a2e..HEAD`)

## STOP conditions

Stop and report back (do not improvise) if:

- Any check FAILs on this unmodified product code. It passed 9/9 in the scratch harness at `e434a2e`, so a failure means the port changed something. Report the failing check's output.
- `npm install puppeteer-core@25.12.0` tries to download a browser, or changes the version of any existing package in the lockfile.
- `npm audit` reports a **high or critical** advisory introduced by puppeteer-core.
- vscode-test or `test:unit` would pick up a file under `test/ui/`.
- The disk runs out (ENOSPC).

## Maintenance notes

- **Every later 1.2 plan extends `test/ui/run.mjs`** with checks for its own feature (019: contrast, hide built-ins, tooltips, cheat sheet, tip banner; 020+: play/pause/scrub, cross-function playback; drill-down; collapse). Keep each check self-contained, with a `report(n, …)` call and a screenshot.
- **Theme variables** in `server.mjs` are hand-copied from Dark Modern/Light Modern. If `index.css` starts using a new `--vscode-*` variable, add it to **both** theme blocks, or the check will read an empty colour.
- **This is Chrome, not the VS Code webview host.** Real editor offsets, the host's `reveal` handling and real themes still need a human F5 pass before each release. `test/ui/README.md` "Limits" says so.
- Reviewer: check that the diff of `run.mjs` against the scratch copy is limited to the Step 3 edits (`diff` the two files).
