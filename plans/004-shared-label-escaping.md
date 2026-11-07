# Plan 004: Both diagram modes share one label escaper that escapes `<` and `>`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first)**: `git diff --stat 6ea6b96..HEAD -- webview/parser.js webview/functionParser.js webview/escapeLabel.js test/unit/`
> `test/unit/` is expected to exist (created by plan 003). If `webview/parser.js`
> or `webview/functionParser.js` changed, compare against the "Current state"
> excerpts; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/003-parser-unit-test-harness.md (provides `npm run test:unit`, `webview/package.json`, and the test files this plan extends)
- **Category**: bug
- **Planned at**: commit `6ea6b96`, 2026-11-05

## Why this matters

Diagram labels are Python source text. The extension renders them with Mermaid 11 (`securityLevel: "strict"`, HTML labels), which passes label text through an HTML sanitizer. Neither parser escapes `<` or `>`, so ordinary code like `if a<b and c>d:` contains what looks like an HTML tag (`<b and c>`) and the label is mangled or partially swallowed. On top of that, the escape function is copy-pasted in two files and the copies have already drifted (one escapes newlines, the other doesn't). This plan creates one shared `escapeLabel` used by both modes and adds `<`/`>` escaping using Mermaid's entity syntax (`#lt;`, `#gt;`).

## Current state

- `webview/parser.js:56-61` — Timeline-mode escaper (escapes `&`, `"`, newline):
  ```js
  function escapeLabel(label) {
    return label
      .replace(/&/g, "#amp;")
      .replace(/"/g, "#quot;")
      .replace(/\n/g, "#10;");
  }
  ```
  Used at `webview/parser.js:39`: ``mermaidCode += `    n${index}["${escapeLabel(text)}"]\n`;``
- `webview/functionParser.js:93-95` — Functions-mode escaper (escapes only `&`, `"`):
  ```js
  function escapeLabel(label) {
    return label.replace(/&/g, "#amp;").replace(/"/g, "#quot;");
  }
  ```
  Used at `webview/functionParser.js:28`: ``mermaidCode += `    ${id}["${escapeLabel(name)}"]\n`;``
- Mermaid entity codes have the form `#name;` (or `#123;`) inside a quoted label; `#amp;`, `#quot;`, `#lt;`, `#gt;` and `#10;` are all valid.
- Verified with `@lezer/python` 1.1.19: `if a<b and c>d:\n  pass\n` parses to an `IfStatement` whose text is the whole block, so today Timeline mode emits the raw `<b and c>` inside a label.
- Conventions: webview modules are ES modules, double quotes, 2-space indent, named exports (see `webview/render.js`: `export async function renderDiagram(code) { ... }`). Unit tests live in `test/unit/*.test.mjs` and use `node:test` + `node:assert/strict` (created by plan 003 — open `test/unit/parser.test.mjs` for the exact skeleton).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `npm run test:unit` | exit 0, `ℹ fail 0` |
| Build webview | `npm run build:webview` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Integration | `npm test` | exit 0 (launches VS Code; needs desktop) |

## Scope

**In scope**:
- `webview/escapeLabel.js` (create)
- `webview/parser.js` (remove local `escapeLabel`, import shared one)
- `webview/functionParser.js` (same)
- `test/unit/escapeLabel.test.mjs` (create)
- `test/unit/parser.test.mjs`, `test/unit/functionParser.test.mjs` (convert the `plan 004` todos)

**Out of scope**:
- Any other logic in `parser.js` / `functionParser.js` — timeline duplication (plan 005) and call-graph bugs (plan 006) are separate. Do not "fix while you're there".
- `webview/render.js` / Mermaid config (`securityLevel`, `htmlLabels`) — keep strict mode; escaping is the fix.
- `dist/` — do not commit the bundle.

## Git workflow

- Branch: `git fetch origin && git checkout -b advisor/004-shared-label-escaping origin/master` — or from plan 003's branch if it is not merged yet (say so in your report).
- Message style: short sentence case, e.g. `Shared label escaping with < and >`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create `webview/escapeLabel.js`

```js
export function escapeLabel(label) {
  return label
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/</g, "#lt;")
    .replace(/>/g, "#gt;")
    .replace(/\n/g, "#10;");
}
```
`&` must stay first. (`#` itself is not escaped — existing behavior; a literal `#lt;` in source would render as `<`, which is acceptable.)

**Verify**: `node --input-type=module -e "import { escapeLabel } from './webview/escapeLabel.js'; console.log(escapeLabel('a<b & \"c\">\nd'))"` → `a#lt;b #amp; #quot;c#quot;#gt;#10;d`

### Step 2: Use it in both parsers

- `webview/parser.js`: add `import { escapeLabel } from "./escapeLabel.js";` as the first line; delete the local `function escapeLabel` (lines 56-61).
- `webview/functionParser.js`: same import as the first line; delete lines 93-95.

**Verify**:
- `grep -n "function escapeLabel" webview/*.js` → exactly one match, in `webview/escapeLabel.js`.
- `npm run test:unit` → exit 0 (existing characterization tests from plan 003 still pass; none of them contained `<`, `>` or a newline in a Functions label).
- `npm run build:webview` → exit 0.

### Step 3: Tests

Create `test/unit/escapeLabel.test.mjs` with cases:
1. `escapeLabel("plain")` → `"plain"`.
2. `&` → `#amp;`; `"` → `#quot;`; `<` → `#lt;`; `>` → `#gt;`; `"\n"` → `#10;` (one test each, or one table-driven test).
3. Ordering: `escapeLabel("&lt;")` → `"#amp;lt;"` (proves `&` is escaped first and the `<` replacement doesn't re-escape).

In `test/unit/parser.test.mjs`, replace the todo `"plan 004: < and > in labels are escaped as #lt; / #gt;"` with a real test: source `"x = a < b > c\n"` → output contains `n0["x = a #lt; b #gt; c"]` and contains neither `<` nor `>` between the `["` and `"]` of that line. (Use `x = ...` rather than an `if` — Timeline labels for `if` blocks are being reworked by plan 005.)

In `test/unit/functionParser.test.mjs`, delete that same todo (Python identifiers can't contain `<`/`>`, so there is nothing reachable to assert); instead add one test asserting `functionParser.js` uses the shared module:
```js
import { readFileSync } from "node:fs";
test("functions mode uses the shared escaper", () => {
  const src = readFileSync(new URL("../../webview/functionParser.js", import.meta.url), "utf8");
  assert.match(src, /from "\.\/escapeLabel\.js"/);
});
```

**Verify**: `npm run test:unit` → exit 0, `ℹ fail 0`; `grep -c "plan 004" test/unit/*.test.mjs` → 0 for every file.

### Step 4: Optional manual check

Optional, only if you have a desktop VS Code: open the repo, run `npm run build:webview`, press F5 ("Run Extension" in `.vscode/launch.json`), open a `.py` file containing `x = a < b > c`, run the visualizer command, select **Timeline** mode. The label should read `x = a < b > c` verbatim. Skip without penalty if no desktop is available — say so in your report.

### Step 5: Full gate

**Verify**: `npm run lint` → exit 0; `npm test` → exit 0 (or report that VS Code could not launch); `git status --porcelain` → only in-scope paths.

## Test plan

- New: `test/unit/escapeLabel.test.mjs` (≥ 3 tests).
- Updated: one todo → real test in `parser.test.mjs`; one todo → source-import test in `functionParser.test.mjs`.
- Pattern: skeleton at the top of `test/unit/parser.test.mjs` (from plan 003).
- `npm run test:unit` → all pass.

## Done criteria

- [ ] `webview/escapeLabel.js` exports `escapeLabel` escaping `& " < > \n`
- [ ] `grep -n "function escapeLabel" webview/*.js` → one match, in `webview/escapeLabel.js`
- [ ] `grep -n 'from "./escapeLabel.js"' webview/parser.js webview/functionParser.js` → two matches
- [ ] `npm run test:unit` exits 0 with `ℹ fail 0`; no `plan 004` todos remain
- [ ] `npm run build:webview` and `npm run lint` exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The local `escapeLabel` copies don't match the excerpts (drift).
- `test/unit/` or `npm run test:unit` doesn't exist — plan 003 hasn't landed; stop, don't recreate the harness yourself.
- An existing plan-003 characterization test fails after Step 2 for a reason other than the new escapes (report the diff).
- The optional manual check shows `#lt;` literally in the rendered diagram (Mermaid isn't decoding the entity) — report; don't switch to HTML entities on your own.

## Maintenance notes

- Every new label emitted by either parser (plans 005, 006, future modes) must go through `escapeLabel` — reviewers should reject raw `${text}` inside `["..."]`.
- Node IDs (`n0`, `function0`) are generated, never source text; keep it that way — IDs are not escaped.
- If Mermaid's `securityLevel` is ever loosened, escaping becomes a security boundary, not just cosmetics; revisit then.
