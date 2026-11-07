# Plan 002: Stop tracking the webview bundle, remove dead template files, correct the README

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first, after Step 1's checkout)**: `git diff --stat 6ea6b96..HEAD -- .gitignore dist webview/script.js webview/styles.css vsc-extension-quickstart.md .vscodeignore README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-fix-command-id-and-manifest.md
- **Category**: tech-debt / docs
- **Planned at**: commit `6ea6b96` (origin/master), 2026-11-05

## Why this matters

`dist/webview/bundle.js` is a 3.5 MB minified esbuild output, and it is committed to git. Every `npm test` run rewrites it (the `pretest` script runs `build:webview`), so the working tree gets dirty. It can also drift silently from the `webview/*.js` sources it was built from. Packaging does not need it in git, because `vscode:prepublish` rebuilds it. Two empty files and the extension-template quickstart doc are leftovers from scaffolding. The README on master states wrong requirements: VS Code 1.75 when the manifest requires ^1.140.0, and a Python extension the code never uses. It also lost its development instructions in the rewrite.

## Current state

- `dist/webview/bundle.js`: tracked (`git ls-files dist` → `dist/webview/bundle.js`), about 3.5 MB. It is produced by this script in `package.json`:
  ```json
  "build:webview": "esbuild webview/main.js --bundle --minify --format=iife --outfile=dist/webview/bundle.js",
  "vscode:prepublish": "npm run build:webview",
  "lint": "eslint .",
  "pretest": "npm run build:webview && npm run lint",
  ```
  `extension.js` loads it at runtime: `path.join(context.extensionPath, 'dist', 'webview', 'bundle.js')`.
- `.gitignore` (whole file):
  ```
  node_modules
  .vscode-test/
  *.vsix
  .env
  ```
- `.vscodeignore` controls what goes into the packaged .vsix. It does NOT exclude `dist/`, which is correct: the bundle must ship. Line 7 is `vsc-extension-quickstart.md`.
- `webview/script.js` and `webview/styles.css` are tracked and 0 bytes, and nothing references them. `webview/index.html` loads only `{{styleUri}}` (index.css) and `{{scriptUri}}` (the bundle).
- `vsc-extension-quickstart.md` is the generic `yo code` template doc. Its only reference is `.vscodeignore:7`.
- `README.md` on master (full file, line numbers from `git show origin/master:README.md`):
  ```
   1  # PyChart for VS Code
   3  An extension for VSCode that creates flowcharts for Python functions as a webview on the user's right-side window.
   5  ## Features
   7  - Real-time parsing: automatically analyzes active Python file and extracts control structures (if/elif/else, for/while loops, function definitions, and returns)
   8  - Interactive webview: renders clean responsive Mermaid.js fowcharts directly within VSCode
  10  ## Installation
  ...
  17  ## Usage
  19  1. Run **PyChart: Open Visualizer** from the Command Palette ...
  22  ## Requirements
  24  - Visual Studio Code v1.75.0 or higher
  25  - Python extension for VS Code
  27  ### 1.0.0
  29  Initial release of PyChart
  ```
  `package.json` has `"engines": { "vscode": "^1.140.0" }` and no `extensionDependencies`. Nothing in `extension.js` uses the Python extension: it only checks `document.languageId === 'python'`, which VS Code provides by itself.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Build bundle | `npm run build:webview` | exit 0, writes `dist/webview/bundle.js` |
| Lint | `npm run lint` | exit 0, no output |
| List packaged files | `npx --yes @vscode/vsce ls` | lists files, including `dist/webview/bundle.js` (npx downloads vsce on first use) |
| Integration tests | `npm test` | `2 passing` (needs a desktop session) |

## Scope

**In scope** (the only files you should modify):
- `.gitignore`
- `dist/webview/bundle.js`: untrack only (`git rm --cached`). Keep the file on disk.
- `webview/script.js`, `webview/styles.css`, `vsc-extension-quickstart.md`: delete
- `.vscodeignore`: remove line 7 only
- `README.md`

**Out of scope** (do NOT touch):
- README line 7 (the Features bullet claiming control-structure extraction). It overstates what Timeline mode does today, but plan 005 changes Timeline behaviour, and the README wording should be settled with that. Leave the line exactly as is.
- `package.json` scripts, `webview/index.html`, `webview/index.css`, all `webview/*.js` source.
- `CHANGELOG.md`.

## Git workflow

- Branch: if plan 001 is merged, `git fetch origin && git checkout -b advisor/002-cleanup origin/master`. If not, branch from plan 001's branch: `git checkout -b advisor/002-cleanup advisor/001-fix-command-id`.
- One commit per step group is fine. Use short sentence-case messages like the repo history, e.g. `Stopped tracking webview bundle`, `Removed template leftovers`, `Fixed README requirements`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Branch

See Git workflow. Then run the drift check.

**Verify**: `git ls-files dist` → `dist/webview/bundle.js`

### Step 2: Untrack the bundle and ignore `dist/`

1. Append a line `dist/` to `.gitignore`.
2. `git rm --cached dist/webview/bundle.js`

**Verify**:
- `git ls-files dist` → empty output
- `test -f dist/webview/bundle.js && echo present` → `present` (the file stays on disk; if it is missing, run `npm run build:webview`)
- `git status --short` lists ` D dist/webview/bundle.js` (staged deletion) and `.gitignore` modified, and does not list `dist/` as untracked

### Step 3: Confirm packaging still ships the bundle

Run `npm run build:webview`, then `npx --yes @vscode/vsce ls`.

**Verify**: the output contains `dist/webview/bundle.js`. If `vsce ls` errors about a missing publisher or repository, plan 001 is not applied to your branch, so STOP. A warning about a missing `repository` or `LICENSE` is fine and can be ignored. If `npx` cannot reach the network, record that and instead verify that `grep -n "dist" .vscodeignore` returns no matches (meaning `dist/` is not excluded from the package).

### Step 4: Delete dead template files

First confirm they are dead:
- `wc -c webview/script.js webview/styles.css` → both `0`
- `grep -rn "script.js\|styles.css" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.vscode-test --exclude-dir=dist --exclude-dir=plans --exclude=*.vsix .` → no matches
- `grep -rn "vsc-extension-quickstart" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.vscode-test --exclude-dir=plans --exclude=*.vsix .` → only `.vscodeignore:7`

Then run `git rm webview/script.js webview/styles.css vsc-extension-quickstart.md` and delete the line `vsc-extension-quickstart.md` from `.vscodeignore`.

**Verify**: `git ls-files webview` → `webview/functionParser.js webview/index.css webview/index.html webview/main.js webview/parser.js webview/render.js` (6 files, any order). `npm run build:webview && npm run lint` → exit 0.

### Step 5: Correct the README

Edit `README.md`:
1. Line 8: change `fowcharts` to `flowcharts`. Change nothing else on that line.
2. Requirements section: replace the two bullets with the single bullet `- Visual Studio Code 1.140.0 or higher`. Delete the `Python extension for VS Code` bullet.
3. Add this section at the end of the file, after the `### 1.0.0` block:
   ```markdown
   ## Development

   - `npm install` installs dependencies.
   - `npm run build:webview` bundles the webview (parser + Mermaid renderer) into `dist/webview/bundle.js`. This file is generated and not committed; `vsce package` rebuilds it automatically via `vscode:prepublish`.
   - `npm test` builds, lints, and runs the extension integration tests in a downloaded VS Code instance.
   ```
4. Do not touch line 7 (see Out of scope).

**Verify**:
- `grep -c "fowcharts\|1.75.0\|Python extension" README.md` → `0`
- `grep -n "1.140.0" README.md` → 1 match
- `grep -n "## Development" README.md` → 1 match
- `git diff README.md` shows no change to the line beginning `- Real-time parsing`

### Step 6: Full check

**Verify**: `npm run lint` → exit 0. `npm test` → `2 passing` (if no display is available, record that it was skipped). After `npm test`, `git status --short` must NOT list `dist/webview/bundle.js`, because it is now ignored.

## Test plan

- No new tests. The regression check here is "a test run leaves the tree clean". After `npm test` (or just `npm run build:webview`), `git status --short` shows nothing under `dist/`.

## Done criteria

- [ ] `git ls-files dist` → empty
- [ ] `grep -n "^dist/$" .gitignore` → 1 match
- [ ] `git ls-files webview/script.js webview/styles.css vsc-extension-quickstart.md` → empty
- [ ] `grep -n "quickstart" .vscodeignore` → no matches
- [ ] `grep -c "fowcharts\|1.75.0\|Python extension" README.md` → `0`, and the `## Development` section exists
- [ ] `npm run build:webview && npm run lint` → exit 0, and `git status --short` shows nothing under `dist/`
- [ ] `npx --yes @vscode/vsce ls` lists `dist/webview/bundle.js` (or the offline fallback is recorded)
- [ ] Only in-scope files changed (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `webview/script.js` or `webview/styles.css` is not 0 bytes, or something references either file.
- `vsce ls` does not list `dist/webview/bundle.js` after a build. That would mean packaging excludes it and the extension would ship broken.
- The repo has a CI workflow or release process (check `.github/workflows/`, which is empty at 6ea6b96) that expects `dist/` to be committed.
- Plan 001 is not applied on your base (`node -e "console.log(require('./package.json').publisher)"` prints `undefined`).

## Maintenance notes

- Anyone running the extension from source (F5 in VS Code) must now run `npm run build:webview` first, because the bundle is no longer in git. `.vscode/launch.json` has no preLaunchTask. A later change could add one that runs `npm run build:webview`.
- When plan 005 changes Timeline mode, revisit README line 7 so it describes what the diagram actually shows.
- Reviewer: the diff should show `dist/webview/bundle.js` as deleted from the index only. Check that the PR doesn't accidentally delete the file from disk in a way that breaks local debugging.
