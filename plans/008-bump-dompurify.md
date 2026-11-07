# Plan 008: Upgrade the bundled DOMPurify past the critical advisory

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first, after Step 1's checkout)**: `git diff --stat 6ea6b96..HEAD -- package.json package-lock.json`
> If either file changed since this plan was written, re-run Step 2's
> baseline and compare it with "Current state"; if `dompurify` is already
> ≥ 3.4.17, mark this plan REJECTED ("already fixed") in `plans/README.md`
> and stop.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-fix-command-id-and-manifest.md (only as a base branch; there is no code dependency)
- **Category**: security
- **Planned at**: commit `6ea6b96` (origin/master), 2026-11-05

## Why this matters

`npm audit` reports a **critical** advisory against `dompurify` (affected range `<=3.4.16`, described as a "SAFE_FOR_TEMPLATES bypass"). The installed version is 3.4.16, pulled in by `mermaid@11.17.2`. esbuild bundles DOMPurify into `dist/webview/bundle.js`, so it ships in the extension even though npm lists it as a dev dependency. Exploitation here is unlikely, for two reasons. Mermaid runs with `securityLevel: "strict"` (the default; `webview/render.js` does not override it). The webview CSP (`webview/index.html:6`) only allows scripts carrying a per-load nonce. This is cheap hygiene: a lockfile-only patch bump that clears the only critical advisory and keeps `npm audit` meaningful.

## Current state

- `package.json` devDependencies include `"mermaid": "^11.4.1"`. `dompurify` is not a direct dependency.
- `node_modules/mermaid/package.json` declares `"dompurify": "^3.3.3"`, so 3.4.17 is within range and no override is needed.
- `package-lock.json` (master, around line 2361):
  ```json
  "node_modules/dompurify": {
    "version": "3.4.16",
    "resolved": "https://registry.npmjs.org/dompurify/-/dompurify-3.4.16.tgz",
    ...
    "dev": true,
  ```
- `npm ls dompurify` → `mermaid@11.17.2` → `dompurify@3.4.16`. `npm view dompurify version` → `3.4.17` at planning time.
- `npm audit` at planning time: 12 vulnerabilities (3 low, 8 moderate, 1 critical). The only critical one is `dompurify`, and npm reports `fixAvailable: true`.
- `package.json` also has an `"overrides"` block (`diff`, `serialize-javascript`). Leave it alone.
- `webview/index.html:6` CSP: `default-src 'none'; img-src {{cspSource}} data:; style-src {{cspSource}} 'unsafe-inline'; script-src 'nonce-{{nonce}}';`

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Inspect | `npm ls dompurify` | shows the version under `mermaid@11.x` |
| Update | `npm update dompurify` | exit 0 |
| Audit | `npm audit` | no `dompurify` entry |
| Build | `npm run build:webview` | exit 0 |
| Lint | `npm run lint` | exit 0, no output |
| Integration tests | `npm test` | `2 passing` (needs a desktop session) |
| Unit tests (if plan 003 has landed) | `npm run test:unit` | all pass |

## Scope

**In scope** (the only files you should modify):
- `package-lock.json`

**Out of scope** (do NOT touch):
- `package.json`. No new dependency, override or version-range change is needed, because `^3.3.3` already allows 3.4.17.
- The other audit findings: moderate `eslint`/`@eslint/config-array`, `@vscode/test-cli`, `mocha`, `c8`, `glob`, `minimatch`, `test-exclude` (all test or lint tooling that never ships), and low `katex`/`mermaid`/`serialize-javascript`. See Maintenance notes.
- Do not run `npm audit fix`. It may touch unrelated packages or apply breaking (`--force`) bumps.
- `dist/webview/bundle.js`: if it is still tracked (plan 002 not merged), do not commit a rebuilt copy as part of this plan.

## Git workflow

- Branch: `git fetch origin && git checkout -b advisor/008-bump-dompurify origin/master` (if plan 001 is merged; otherwise base on `advisor/001-fix-command-id`).
- One commit, e.g. `Bumped dompurify for security advisory`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Branch and record the baseline

See Git workflow, then run the drift check. Then:

**Verify**: `npm ci` → exit 0. `npm ls dompurify` → `dompurify@3.4.16` (or any version ≤ 3.4.16). `npm audit 2>&1 | grep -i -A2 "^dompurify"` → shows the critical advisory.

### Step 2: Update only DOMPurify

Run `npm update dompurify`.

**Verify**:
- `npm ls dompurify` → `dompurify@3.4.17` or higher, still under `mermaid@11.17.2`
- `git diff --stat` → only `package-lock.json` changed
- `git diff package-lock.json` → the only changed entry is `node_modules/dompurify` (its `version`, `resolved` and `integrity` lines). If any other package entry changed, especially `mermaid`, STOP.

### Step 3: Confirm the advisory is gone

**Verify**: `npm audit 2>&1 | grep -ic "dompurify"` → `0`. `npm audit` still lists the moderate/low dev-tool advisories. That is expected and out of scope.

### Step 4: Rebuild and check

**Verify**:
- `npm run build:webview` → exit 0
- `grep -c "3.4.17" dist/webview/bundle.js` → 1 or more (DOMPurify embeds its version string; if the bundle is minified differently and shows 0, check that `grep -o 'version="3\.4\.[0-9]*"\|"3\.4\.[0-9]*"' dist/webview/bundle.js` shows no `3.4.16`)
- `npm run lint` → exit 0
- `npm run test:unit` → all pass, if that script exists (plan 003)
- `npm test` → `2 passing`, or record "skipped: no display"
- If `git status` shows `dist/webview/bundle.js` modified (meaning it is still tracked), run `git checkout dist/webview/bundle.js` before committing.

## Test plan

- No new tests. DOMPurify is a transitive sanitiser inside Mermaid. Regression coverage is that the webview still renders: run `npm test`, then manually open a Python file with the command "PyChart: Open Visualizer" and confirm a diagram appears in both modes. Record whether you did the manual check.

## Done criteria

- [ ] `npm ls dompurify` shows ≥ 3.4.17
- [ ] `npm audit 2>&1 | grep -ic dompurify` → `0`
- [ ] `git diff --stat origin/master -- package.json` → empty
- [ ] The only changed lockfile entry is `node_modules/dompurify`
- [ ] `npm run build:webview && npm run lint` → exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npm update dompurify` changes any lockfile entry other than `node_modules/dompurify`, or moves `mermaid` to a new major version.
- The latest available `dompurify` is still ≤ 3.4.16 (meaning the fix isn't published in the registry you reach). Report `npm view dompurify version`.
- `npm audit` still reports the DOMPurify advisory after the bump (for example, if the affected range was widened).
- The webview stops rendering diagrams after the bump.

## Maintenance notes

- Remaining advisories after this plan: moderate ones in `eslint`, `@eslint/config-array`, `@vscode/test-cli`, `mocha`, `c8`, `glob`, `minimatch` and `test-exclude`, all test or lint tooling that never ships in the .vsix (`.vscodeignore` excludes `node_modules/**` and `test/**`). There is also a low `katex` advisory (prototype pollution) pulled in by Mermaid, which only matters if math rendering is enabled. Revisit them on the next routine dependency refresh, not urgently.
- Everything under `devDependencies` that the webview imports (`mermaid`, `dompurify`, `@lezer/python`) is inlined into `dist/webview/bundle.js`. Treat their advisories as runtime advisories even though npm labels them `dev`.
- Reviewer: the diff should be about 3 lines in `package-lock.json`.
