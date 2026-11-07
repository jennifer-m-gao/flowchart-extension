# Plan 003: Parser logic has fast Node unit tests that pin current behavior

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first)**: `git diff --stat 6ea6b96..HEAD -- webview/parser.js webview/functionParser.js package.json .vscode-test.mjs test/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (Plan 001 is expected to have changed
> `package.json` `contributes`/`name` fields and `test/extension.test.js` command
> IDs — those changes are fine; anything touching `scripts` or the parsers is not.)

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-*.md (fixes the broken command ID; land it first so the branch you build on works)
- **Category**: tests
- **Planned at**: commit `6ea6b96`, 2026-11-05

## Why this matters

The two parsers (`webview/parser.js`, `webview/functionParser.js`) turn Python source into Mermaid diagram text — they are the whole product. Today they have zero tests: the existing suite (`test/extension.test.js`) only greps the HTML and runs the command inside a full VS Code instance. Plans 004, 005 and 006 change these parsers; without tests, there is no way to know they fixed the bugs without breaking anything else. This plan adds a fast (`node --test`, no VS Code, < 1 s) unit-test harness and *characterization* tests that pin today's behavior, with known bugs recorded as `test.todo` entries that later plans turn into real assertions.

## Current state

Files:
- `webview/parser.js` — `parseCode(tree, code)`: "Timeline" mode. Walks the Lezer tree, emits a linear `flowchart LR` Mermaid string.
- `webview/functionParser.js` — `parseFunctions(tree, code)`: "Functions" mode. Emits a `flowchart TD` call graph.
- Both are pure ES modules (use `export`), no DOM access, no Mermaid import. Their only input is a Lezer tree from `@lezer/python` plus the source string.
- `webview/main.js` — the webview entry point; calls `parser.parse(currentCode)` then one of the two functions. Do not test this file (it uses `acquireVsCodeApi` and DOM).
- `test/extension.test.js` — existing VS Code integration test (CommonJS, mocha `suite`/`test`), run by `@vscode/test-cli`.
- `.vscode-test.mjs` — `files: 'test/**/*.test.js'` — the integration runner picks up every `*.test.js` under `test/`. **New unit tests must be `.mjs` so they are not picked up by it** (and run inside VS Code's mocha, which would fail on `node:test`).

`webview/parser.js:21-54` (excerpt):
```js
export function parseCode(tree, code) {
  const nodes = [];

  function visit(node) {
    if (STATEMENT_TYPES.has(node.name)) {
      nodes.push(code.slice(node.from, node.to).trim());
    }

    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
  }

  visit(tree.topNode);

  let mermaidCode = "flowchart LR\n    start([\"Start\"])\n";
  ...
  mermaidCode += "    endNode([\"End\"])\n";

  if (nodes.length === 0) {
    mermaidCode += "    start --> endNode\n";
  } else {
    mermaidCode += "    start --> n0\n";
    ...
    mermaidCode += `    n${nodes.length - 1} --> endNode\n`;
  }
```

`webview/functionParser.js:5-13, 21-28` (excerpt):
```js
export function parseFunctions(tree, code) {
  const functions = new Map();
  findFunctions(tree.cursor(), code, functions);
  const names = [...functions.keys()];
  const nodeIds = new Map(names.map((name, index) => [name, `function${index}`]));
  ...
  let mermaidCode = "flowchart TD\n";
  ...
  for (const name of calledNames) {
    if (!nodeIds.has(name)) {
      nodeIds.set(name, `external${nodeIds.size}`);
    }
  }
```

Verified behavior at planning time (Node 24, `@lezer/python` 1.1.19) for source `"def a():\n  b()\n  b()\n"`:
```
parseFunctions →
flowchart TD
    function0["a"]
    external1["b"]
    function0 --> external1
    function0 --> external1

parseCode →
flowchart LR
    start(["Start"])
    n0["b()"]
    n1["b()"]
    endNode(["End"])
    start --> n0
    n0 --> n1
    n1 --> endNode
```

Importing `webview/parser.js` from Node works today but prints a `MODULE_TYPELESS_PACKAGE_JSON` warning because the root `package.json` has no `"type"`. Adding `webview/package.json` with `{ "type": "module" }` scopes ESM to that folder and silences it. Do **not** add `"type": "module"` to the root `package.json` — `extension.js` is CommonJS (`require('vscode')`).

`package.json` scripts today:
```json
"scripts": {
  "build:webview": "esbuild webview/main.js --bundle --minify --format=iife --outfile=dist/webview/bundle.js",
  "vscode:prepublish": "npm run build:webview",
  "lint": "eslint .",
  "pretest": "npm run build:webview && npm run lint",
  "test": "vscode-test"
},
```

Conventions: webview code uses double quotes, 2-space indent, semicolons, ES module `import`/`export` (see `webview/main.js`). Match that in the `.mjs` tests.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests (new) | `npm run test:unit` | exit 0; summary shows `ℹ fail 0` |
| Build webview | `npm run build:webview` | exit 0, writes `dist/webview/bundle.js` |
| Lint | `npm run lint` | exit 0 |
| Integration tests | `npm test` | exit 0 (launches VS Code; needs a desktop session — if unavailable, report that instead of skipping silently) |

Node ≥ 22 is required for `node --test` glob arguments (verified on Node 24.21).

## Scope

**In scope** (the only files you should modify):
- `webview/package.json` (create)
- `package.json` (`scripts` only)
- `test/unit/parser.test.mjs` (create)
- `test/unit/functionParser.test.mjs` (create)

**Out of scope** (do NOT touch):
- `webview/parser.js`, `webview/functionParser.js` — this plan *pins* behavior, including bugs. Fixing them is plans 004/005/006. If a test you write fails against current code, the test is wrong, not the parser.
- `test/extension.test.js`, `.vscode-test.mjs` — integration suite stays as is.
- `dist/` — never commit the bundle (plan 002 makes it gitignored; if it shows as modified after building, `git checkout -- dist` or leave it unstaged).
- `eslint.config.mjs` — `.mjs` test files lint fine with the existing config.

## Git workflow

- Start: `git fetch origin && git checkout -b advisor/003-parser-unit-tests origin/master` (if plan 001/002 is not merged yet, branch from that plan's branch instead and say so in your report).
- One commit per step is fine; message style is short sentence case, e.g. `Added parser unit test harness`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Scope ESM to the webview folder

Create `webview/package.json` with exactly:
```json
{ "type": "module" }
```

**Verify**:
- `node --input-type=module -e "import('./webview/parser.js').then(m => console.log(typeof m.parseCode))"` → prints `function` and **no** `MODULE_TYPELESS_PACKAGE_JSON` warning.
- `npm run build:webview` → exit 0 (esbuild is unaffected by the nested `type`).

### Step 2: Add the `test:unit` script and wire it into `pretest`

In root `package.json` `scripts`, add:
```json
"test:unit": "node --test \"test/unit/*.test.mjs\"",
```
and change `pretest` to:
```json
"pretest": "npm run test:unit && npm run build:webview && npm run lint",
```
Rationale: unit tests are sub-second and need no build, so failing them first gives the fastest feedback before the slow VS Code launch. Keep every other script unchanged.

**Verify**: `node -e "const s=require('./package.json').scripts; console.log(s['test:unit'], '|', s.pretest)"` → prints `node --test "test/unit/*.test.mjs" | npm run test:unit && npm run build:webview && npm run lint`.

### Step 3: Write `test/unit/parser.test.mjs`

Skeleton to follow (both test files use this shape):
```js
import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { parseCode } from "../../webview/parser.js";

function timeline(source) {
  return parseCode(parser.parse(source), source);
}

test("empty source links Start directly to End", () => {
  const out = timeline("");
  assert.match(out, /^flowchart LR\n/);
  assert.ok(out.includes('start(["Start"])'));
  assert.ok(out.includes('endNode(["End"])'));
  assert.ok(out.includes("start --> endNode"));
});

test.todo("plan 005: nested statements appear only once");
```

Real tests (assert current behavior exactly):
1. Empty source → as above; output contains no `n0`.
2. Simple sequence `"x = 1\ny = 2\nreturn_value = x\n"` → contains `n0["x = 1"]`, `n1["y = 2"]`, `n2["return_value = x"]`, `start --> n0`, `n0 --> n1`, `n1 --> n2`, `n2 --> endNode`.
3. Double quotes are escaped: `'s = "hi"\n'` → contains `n0["s = #quot;hi#quot;"]`.
4. Characterization of the current duplicate: `"def a():\n  b()\n  b()\n"` → output equals exactly the `parseCode` text in "Current state" (compare whole string with `assert.equal`).

`test.todo` entries (each title names the fixing plan):
- `"plan 005: compound statements (if/for/while) emit only their header line, not the whole body"`
- `"plan 005: statements nested in if/for/while bodies are not duplicated"`
- `"plan 005: augmented assignment (x += 1, UpdateStatement) appears in the timeline"`
- `"plan 004: < and > in labels are escaped as #lt; / #gt;"`

**Verify**: `npm run test:unit` → exit 0, `ℹ fail 0`, `ℹ todo` ≥ 4.

### Step 4: Write `test/unit/functionParser.test.mjs`

Same skeleton, importing `parseFunctions` from `../../webview/functionParser.js`, helper `functions(source)`.

Real tests:
1. No functions: `"x = 1\n"` → output equals `"flowchart TD\n"`.
2. Single function, no calls: `"def a():\n  pass\n"` → contains `function0["a"]`, contains no `-->`.
3. Internal call: `"def a():\n  b()\ndef b():\n  pass\n"` → contains `function0["a"]`, `function1["b"]`, `function0 --> function1`, and no `external`.
4. External call: `"def a():\n  print(1)\n"` → contains `external1["print"]` and `function0 --> external1`.
5. Method calls are ignored (current behavior): `"def a():\n  obj.m()\n"` → contains no `-->`.
6. Characterization of the duplicate edge: `"def a():\n  b()\n  b()\n"` → output equals exactly the `parseFunctions` text in "Current state".

`test.todo` entries:
- `"plan 006: repeated calls produce a single edge"`
- `"plan 006: same-named methods in different classes are separate nodes"`
- `"plan 006: calls inside a nested function are not attributed to the outer function"`
- `"plan 004: < and > in labels are escaped as #lt; / #gt;"`

**Verify**: `npm run test:unit` → exit 0, `ℹ fail 0`, `ℹ pass` ≥ 10, `ℹ todo` ≥ 8.

### Step 5: Full gate

**Verify**:
- `npm run lint` → exit 0.
- `npm test` → exit 0 (runs `test:unit`, build, lint, then VS Code integration tests). If no desktop/VS Code download is possible in your environment, record that in your report; the unit-test and lint gates are still mandatory.
- `git status --porcelain` → only the four in-scope paths (plus `dist/webview/bundle.js` if it is still tracked — do not stage it).

## Test plan

- New: `test/unit/parser.test.mjs` (4 tests + 4 todos), `test/unit/functionParser.test.mjs` (6 tests + 4 todos).
- Pattern: the skeleton in Step 3. There is no existing `node:test` file to copy; do not model on `test/extension.test.js` (that is mocha-in-VS-Code, different runner).
- Verification: `npm run test:unit` → all pass, todos reported.

## Done criteria

- [ ] `webview/package.json` exists and contains `{ "type": "module" }`
- [ ] `npm run test:unit` exits 0 with `ℹ fail 0`, ≥ 10 passing tests, ≥ 8 todos
- [ ] `npm run build:webview` exits 0
- [ ] `npm run lint` exits 0
- [ ] `git diff 6ea6b96 -- webview/parser.js webview/functionParser.js` is empty
- [ ] No files outside the in-scope list are modified/staged (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:
- A characterization test of *current* behavior fails and the actual output differs from the excerpts in "Current state" — the parsers have drifted; report the actual output.
- `node --test "test/unit/*.test.mjs"` reports `ℹ tests 0` (glob not expanded — check `node -v` ≥ 22; report the version).
- Adding `webview/package.json` breaks `npm run build:webview` or the integration test.
- Making a test pass seems to require editing `webview/parser.js` or `webview/functionParser.js`.

## Maintenance notes

- Plans 004, 005, 006 convert the `test.todo` entries into real assertions and will update the two "characterization of the duplicate" tests (they are *expected* to change when those bugs are fixed — that is the point of pinning them).
- Keep unit tests on `.mjs` under `test/unit/`: anything named `*.test.js` under `test/` is picked up by the VS Code integration runner.
- Reviewer: check that no parser source changed, and that todos name the plan that will fix them.
