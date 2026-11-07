# Plan 001: Make the "PyChart: Open Visualizer" command work again on master

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first, after Step 1's checkout)**: `git diff --stat 6ea6b96..HEAD -- package.json package-lock.json extension.js test/extension.test.js CHANGELOG.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P0 (the live Marketplace build is broken)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `6ea6b96` (origin/master), 2026-11-05

## Why this matters

Commit `6ea6b96` ("changed name and added publisher for deployment") renamed the extension to PyChart. It changed the command ID that `extension.js` registers, but it never edited `package.json`. The new name, version and publisher landed in the `package-lock.json` header instead. As a result, the only Command Palette entry ("Flowchart: Open Visualizer") calls a command that no longer exists, and VS Code reports "command 'flowchart-extension.openFlowchart' not found". The command the README tells users to run ("PyChart: Open Visualizer") does not exist at all. The existing integration test also calls the old ID, so it fails. The extension's only entry point is broken, and `vsce package` cannot pick up the intended publisher.

**This bug is live.** On 2026-11-05 the advisor confirmed that `JenniferGao.pychart-extension` **v1.0.0** is on the VS Code Marketplace (published 2026-10-10, 12 installs) and has this exact mismatch. Its packaged `package.json` contributes `flowchart-extension.openFlowchart`, while its `extension.js:90` registers `pychart-extension.openFlowchart`. So the fix must ship as **v1.0.1**: the Marketplace rejects re-publishing an existing version. The `name` must stay exactly `pychart-extension` and the `publisher` exactly `JenniferGao`. Those two make up the permanent extension ID, and changing either would publish a separate extension instead of updating this one.

## Current state

Files (read them with `git show origin/master:<path>` if you are not on master yet):

- `extension.js`: the extension host entry. On master, line 90 registers the command:
  ```js
  // extension.js:89-90 (origin/master)
  	context.subscriptions.push(
  		vscode.commands.registerCommand('pychart-extension.openFlowchart', openFlowchart),
  ```
  Line 50 creates the panel with viewType `'flowchartVisualizer'` and title `'PyChart Visualizer'`.
- `package.json`: the manifest. It still has the pre-rename identity and command:
  ```json
  // package.json:1-20 (origin/master)
  {
    "name": "flowchart-extension",
    "displayName": "flowchart-extension",
    "description": "Visualizes Python code as flowcharts in VS Code",
    "version": "0.0.1",
    "engines": {
      "vscode": "^1.140.0"
    },
    ...
    "contributes": {
      "commands": [
        {
          "command": "flowchart-extension.openFlowchart",
          "title": "Flowchart: Open Visualizer"
        }
      ]
    },
  ```
  There is no `"publisher"` key.
- `package-lock.json`: commit 6ea6b96 hand-edited its header, and that header is the source of truth for the intended identity:
  ```json
  // package-lock.json:1-10 (origin/master)
  {
    "name": "pychart-extension",
    "version": "1.0.0",
    "publisher": "JenniferGao",
    "lockfileVersion": 3,
    "requires": true,
    "packages": {
      "": {
        "name": "pychart-extension",
        "version": "1.0.0",
  ```
  npm does not support a top-level `"publisher"` key in a lockfile, so the next `npm install` will drop it. That is expected.
- `test/extension.test.js`: this is the VS Code integration test, and it uses the old ID twice:
  ```js
  // test/extension.test.js:23-25, 28-30
  		assert.ok(manifest.contributes.commands.some(command =>
  			command.command === 'flowchart-extension.openFlowchart'
  		));
  	...
  	test('opens the visualizer from its command', async () => {
  		await vscode.commands.executeCommand('flowchart-extension.openFlowchart');
  	});
  ```
- `README.md` (master), line 19: `Run **PyChart: Open Visualizer** from the Command Palette`. This already matches the target title, so do not edit it.

Conventions: the JS files use tab indentation and single quotes (`extension.js`, the tests). `package.json` uses 2-space indentation and double quotes. Match them.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `npm run lint` | exit 0, no output |
| Lockfile sync | `npm install --package-lock-only` | exit 0 |
| Integration tests | `npm test` | builds the webview, lints, launches VS Code 1.141 and runs mocha; "2 passing". Needs a desktop session. |
| Manifest/code consistency | see Step 4 | prints `OK` |

## Scope

**In scope** (the only files you should modify):
- `package.json`
- `package-lock.json`: only the change npm itself makes in Step 3
- `test/extension.test.js`
- `CHANGELOG.md` (Step 3b only)

**Out of scope** (do NOT touch):
- `extension.js`: it already has the intended ID. Do not rename the webview viewType `'flowchartVisualizer'` or anything else in it.
- `README.md`: plan 002 handles the README.
- `dist/webview/bundle.js` and everything under `webview/`.
- The `"description"` field, `engines`, scripts and dependencies in `package.json`.

## Git workflow

- Branch: `git fetch origin && git checkout -b advisor/001-fix-command-id origin/master`. The local `Prototype` branch is stale (its content is already merged into master), so do not base this work on it.
- One commit. Message style matches the repo history (short, sentence case), e.g. `Fixed command ID and manifest after PyChart rename`.
- Do NOT push or open a PR unless the operator told you to.

## Steps

### Step 1: Branch from master

Run `git fetch origin && git checkout -b advisor/001-fix-command-id origin/master`, then run the drift check above.

**Verify**: `git log -1 --format=%h` → `6ea6b96` (or a later commit if the drift check was clean). `grep -n "registerCommand" extension.js` → line 90 contains `'pychart-extension.openFlowchart'`.

### Step 2: Fix the identity and command in `package.json`

Edit only these keys:
- `"name": "pychart-extension"`
- `"displayName": "PyChart"`
- `"version": "1.0.1"` (1.0.0 is already published and cannot be reused)
- Add `"publisher": "JenniferGao"` directly after `"version"`.
- In `contributes.commands[0]`, set `"command": "pychart-extension.openFlowchart"` and `"title": "PyChart: Open Visualizer"`.

**Verify**: `node -e "const p=require('./package.json');console.log(p.name,p.version,p.publisher,p.contributes.commands[0].command,p.contributes.commands[0].title)"` → `pychart-extension 1.0.1 JenniferGao pychart-extension.openFlowchart PyChart: Open Visualizer`

### Step 3: Let npm normalise the lockfile

Run `npm install --package-lock-only`.

**Verify**: `git diff package-lock.json` shows only header changes:
- the two `"version": "1.0.0"` lines (top level, and under `packages[""]`) become `"1.0.1"`;
- the unsupported `"publisher": "JenniferGao",` line may be removed. npm drops that key, and that's fine because the publisher now lives in `package.json`.

The `name` lines must stay unchanged. `git diff --stat package-lock.json` should report at most 2 insertions and 3 deletions. If any dependency entry changed, run `git checkout package-lock.json` and STOP.

### Step 3b: Add a changelog entry

In `CHANGELOG.md`, add a `## [1.0.1]` section above `## [Unreleased]` containing one bullet: `- Fix "command not found" when running the visualizer command (manifest and code used different command IDs).`

**Verify**: `grep -n "1.0.1" CHANGELOG.md` → one match.

### Step 4: Update the integration test

In `test/extension.test.js`, replace both occurrences of `'flowchart-extension.openFlowchart'` (line 24 and line 29) with `'pychart-extension.openFlowchart'`. Change nothing else.

**Verify**:
- `grep -rn "flowchart-extension.openFlowchart" --exclude-dir=node_modules --exclude-dir=.vscode-test --exclude-dir=.git --exclude-dir=dist --exclude=*.vsix .` → no matches. (The `plans/` files mention the old ID, so either also pass `--exclude-dir=plans` or ignore matches under `plans/`.)
- Manifest/code consistency check:
  ```
  node -e "const fs=require('fs');const id=require('./package.json').contributes.commands[0].command;const src=fs.readFileSync('extension.js','utf8');console.log(src.includes(\"registerCommand('\"+id+\"'\")?'OK':'MISMATCH '+id)"
  ```
  → `OK`

### Step 5: Lint and run the integration tests

**Verify**:
- `npm run lint` → exit 0, no output.
- `npm test` → ends with `2 passing`. This launches a real VS Code window. If no desktop session is available (headless or CI without xvfb), record "npm test not run: no display" in your report, and treat the Step 4 consistency check as the gate. `npm test` also rebuilds `dist/webview/bundle.js`, which is a tracked file. If it shows as modified afterwards, run `git checkout dist/webview/bundle.js` before committing so the commit stays in scope.

## Test plan

- No new tests. The existing `test/extension.test.js` cases become the regression tests. One checks that the manifest contributes the new ID, and the other runs it, which fails with "command not found" if the IDs disagree.
- Verification: `npm test` → `2 passing`, or the Step 4 `OK` check when no display is available.

## Done criteria

- [ ] `node -e "const p=require('./package.json');console.log(p.name,p.version,p.publisher)"` prints `pychart-extension 1.0.1 JenniferGao`
- [ ] `CHANGELOG.md` has a `1.0.1` entry
- [ ] You did **not** run `vsce publish`. Publishing needs the maintainer's Marketplace token and is a human step. Report "ready to publish 1.0.1" instead.
- [ ] The Step 4 consistency one-liner prints `OK`
- [ ] The Step 4 grep for `flowchart-extension.openFlowchart` (excluding plans/, node_modules, dist, .vscode-test, *.vsix) finds nothing
- [ ] `npm run lint` exits 0
- [ ] `npm test` reports `2 passing`, or the report says it was skipped for lack of a display
- [ ] `git status` shows only `package.json`, `package-lock.json`, `CHANGELOG.md` and `test/extension.test.js` modified (plus `plans/README.md` and `plans/METRICS.md`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `extension.js` on your branch does NOT register `'pychart-extension.openFlowchart'`. That would mean someone already changed the direction of the fix, or the maintainers want to keep the old `flowchart-extension.*` ID. In that case the fix flips (change `extension.js` instead), and that needs a human decision.
- `npm install --package-lock-only` changes any dependency entry (anything beyond the header `version` and `publisher` lines).
- `npm test` fails for a reason other than "no display", for example a test assertion on the HTML.
- The publisher `JenniferGao` is rejected by `vsce` or the maintainers say a different publisher ID is registered on the Marketplace.

## Maintenance notes

- The command ID in `package.json` → `contributes.commands` and the string in `vscode.commands.registerCommand` must always match. Any future rename must change both, plus `test/extension.test.js`. Plan 003 adds unit tests. If it's cheap, a later change could add this consistency check to them so the check doesn't need a VS Code instance.
- The webview viewType `'flowchartVisualizer'` was left alone on purpose. Changing it would only matter if a `WebviewPanelSerializer` is added later, because restored panels are matched by viewType.
- Reviewer: the lockfile diff should touch only the header: two `version` lines 1.0.0 → 1.0.1, and possibly the removed `publisher` line.
