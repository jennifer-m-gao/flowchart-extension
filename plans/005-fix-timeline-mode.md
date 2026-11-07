# Plan 005: Timeline mode lists each statement once, with header-only labels for blocks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first)**: `git diff --stat 6ea6b96..HEAD -- webview/parser.js test/unit/parser.test.mjs`
> Both are expected to have changed (plans 003 and 004). Confirm that
> `webview/parser.js` matches the "Current state" excerpt below (i.e. the only
> change since `6ea6b96` is the shared `escapeLabel` import from plan 004). Any
> other difference is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (rewrites the core of one diagram mode; mitigated by unit tests)
- **Depends on**: plans/003-parser-unit-test-harness.md, plans/004-shared-label-escaping.md
- **Category**: bug
- **Planned at**: commit `6ea6b96`, 2026-11-05

## Why this matters

"Timeline" mode is supposed to show a Python file's statements in source order as a chain of boxes. It's wrong in three ways today:
1. **Duplication.** Every compound statement (`if`, `for`, `while`, `try`, …) becomes a box whose label is the *entire block*, and then each statement inside the block is added again as its own box. With deeper nesting the diagram text grows roughly quadratically.
2. **Size failures.** Because of (1), mid-size files exceed Mermaid's `maxTextSize` limit of 50,000 characters (confirmed in the shipped bundle as `maxTextSize:5e4`), and the panel shows "Unable to render diagram" instead of a diagram.
3. **Missing statements.** The statement list uses node names that don't exist in the `@lezer/python` grammar (`AugAssignStatement`, `ImportFromStatement`), so `x += 1` is silently dropped, and `match`, `global`/`nonlocal` and statement-level `yield` are never shown.

After this plan each statement appears exactly once, block statements show only their header line (`if a:`, `for i in r:`, `def f():`, `else:`), and labels are capped at 80 characters. The diagram stays a straight left-to-right chain — real branching is a separate, later design task.

## Current state

`webview/parser.js` (after plan 004; lines 1-35 unchanged since `6ea6b96`):
```js
import { escapeLabel } from "./escapeLabel.js";
const STATEMENT_TYPES = new Set([
  "AssignStatement",
  "AugAssignStatement",
  "ReturnStatement",
  "ExpressionStatement",
  "IfStatement",
  "ForStatement",
  "WhileStatement",
  "WithStatement",
  "TryStatement",
  "RaiseStatement",
  "AssertStatement",
  "DeleteStatement",
  "ImportStatement",
  "ImportFromStatement",
  "PassStatement",
  "BreakStatement",
  "ContinueStatement"
]);

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
  // ...builds "flowchart LR", start([...]), n0..nK, endNode([...]) and a linear chain of edges
```
The bug is in `visit`: it pushes a statement and **then still recurses into it**, and pushes the full `node.from..node.to` text.

The Mermaid-building half of `parseCode` (from `let mermaidCode = "flowchart LR\n..."` to `return mermaidCode;`) is correct and must stay as is.

### Grammar facts (verified with `@lezer/python` 1.1.19 at planning time)

Tree shapes, showing node name and source text:
```
UpdateStatement "x += 1"
ImportStatement "from a import b"          ← both import forms are ImportStatement
StatementGroup "a=1; b=2"                  ← children: AssignStatement, ";", AssignStatement
Comment "# hi"
IfStatement "if a:\n  x=1\nelif b:\n ..."
  if | <condition> | Body ":\n  x=1\n" | elif | <condition> | Body | else | Body
TryStatement: try | Body | except | <type> | as | <name> | Body | finally | Body
ForStatement: for | <target> | in | <iter> | Body
WhileStatement / WithStatement: keyword ... Body
MatchStatement "match v:\n  case 1: ..."
  match | <subject> | MatchBody ":\n  case 1:..."
    MatchBody children: ":" | MatchClause "case 1:\n    pass\n"
      MatchClause children: case | LiteralPattern | Body
DecoratedStatement "@dec\nclass C: ..."
  Decorator "@dec\n" | ClassDefinition "class C: ..."
ClassDefinition: class | <name> | Body
FunctionDefinition "async def k(): ...": async | def | <name> | ParamList | Body
ScopeStatement "global g"
YieldStatement "yield 1"
BreakStatement, PassStatement, ReturnStatement, ...
```
Key facts the algorithm relies on:
- Every `Body` (and `MatchBody`) **starts with the `:` token**, so the header text is `code.slice(headerStart, body.from)` and you append `":"` yourself.
- Clause keywords (`elif`, `else`, `except`, `finally`) are direct children of the compound node, sitting between two `Body` children. So the text between one `Body`'s end (`body.to`) and the next `Body`'s start is exactly the next clause header (e.g. `elif b`, `except E as e`, `else`).
- Incomplete code (e.g. `if x\n  y=1` with no colon) yields an `IfStatement` with **no** `Body` child and an error node `⚠`. The parser must not throw on this.

Tree-dump one-liner (run it in Step 1; it prints every node name with indentation):
```bash
node --input-type=module -e '
import {parser} from "@lezer/python";
const src = process.argv[1]; const c = parser.parse(src).cursor(); let d = 0;
function walk(){ do { console.log("  ".repeat(d) + c.name, JSON.stringify(src.slice(c.from, c.to)).slice(0, 40)); if (c.firstChild()) { d++; walk(); d--; c.parent(); } } while (c.nextSibling()); }
walk();' "$(printf '@dec\nclass C:\n  def m(self):\n    pass\nif a:\n  x=1\nelif b:\n  x=2\nelse:\n  x=3\ntry:\n  y()\nexcept E as e:\n  z()\nfinally:\n  w()\nmatch v:\n  case 1:\n    pass\nx += 1\na=1; b=2\n')"
```

Conventions: ES module, double quotes, 2-space indent, `const` Sets of node names at the top of the file (as `STATEMENT_TYPES` is today). All labels must go through the shared `escapeLabel` from `./escapeLabel.js` (plan 004). Tests are `node:test` + `node:assert/strict` in `test/unit/parser.test.mjs` (plan 003).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `npm run test:unit` | exit 0, `ℹ fail 0` |
| Build webview | `npm run build:webview` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Integration | `npm test` | exit 0 (launches VS Code; needs desktop) |

## Scope

**In scope**:
- `webview/parser.js` — `STATEMENT_TYPES` and `visit` only
- `test/unit/parser.test.mjs`

**Out of scope** (do NOT touch):
- The Mermaid-string-building half of `parseCode` — keep `flowchart LR`, the `start`/`endNode` shapes, node ID scheme `n0..nK`, and the linear `-->` chain.
- Branching edges / a real control-flow graph — a separate future design spike; don't start it here.
- `webview/render.js` (including Mermaid's `maxTextSize`), `webview/main.js`, `webview/functionParser.js` (plan 006), `webview/escapeLabel.js`.
- `dist/` — never commit the bundle.

## Git workflow

- Branch: `git fetch origin && git checkout -b advisor/005-fix-timeline-mode origin/master` — or from plan 004's branch if unmerged (say so).
- Message style: short sentence case, e.g. `Fixed timeline duplicating nested statements`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Confirm grammar node names

Run the tree-dump one-liner from "Current state".

**Verify**: output contains each of these names: `UpdateStatement`, `StatementGroup`, `DecoratedStatement`, `Decorator`, `ClassDefinition`, `FunctionDefinition`, `IfStatement`, `elif`, `else`, `TryStatement`, `except`, `finally`, `MatchStatement`, `MatchBody`, `MatchClause`, `Body`. Every `Body` / `MatchBody` line's text starts with `":`.
If any name is missing or a `Body` doesn't start with `:`, **STOP** (the grammar version differs from planning time).

### Step 2: Write the failing tests first

In `test/unit/parser.test.mjs` add a helper that extracts labels in order:
```js
function labels(source) {
  return [...timeline(source).matchAll(/^ {4}n\d+\["(.*)"\]$/gm)].map(m => m[1]);
}
```
Add these tests (expected label arrays are exact):
1. if/elif/else: `"if a:\n  x=1\nelif b:\n  x=2\nelse:\n  x=3\n"` → `["if a:", "x=1", "elif b:", "x=2", "else:", "x=3"]`
2. try/except/finally: `"try:\n  y()\nexcept E as e:\n  z()\nfinally:\n  w()\n"` → `["try:", "y()", "except E as e:", "z()", "finally:", "w()"]`
3. loops/with/scope: `"for i in r:\n  global g\nwhile q:\n  break\nwith f() as h:\n  print(1)\n"` → `["for i in r:", "global g", "while q:", "break", "with f() as h:", "print(1)"]`
4. match: `"match v:\n  case 1:\n    pass\n"` → `["match v:", "case 1:", "pass"]`
5. definitions: `"@dec\nclass C:\n  def m(self):\n    pass\nasync def k():\n  yield 1\n"` → `["@dec class C:", "def m(self):", "pass", "async def k():", "yield 1"]`
6. previously dropped statements: `"x += 1\nfrom a import b\na=1; b=2\n"` → `["x += 1", "from a import b", "a=1", "b=2"]`
7. multi-line statement collapses whitespace: `"result = foo(\n    1,\n    2)\n"` → `["result = foo( 1, 2)"]`
8. truncation: source `"total = " + Array(60).fill("value").join(" + ") + "\n"` → exactly one label; its length is 80; it ends with `"…"`; it equals the first 79 characters of the statement text + `"…"`.
9. no quadratic growth: build 30 nested ifs — `Array.from({ length: 30 }, (_, i) => "  ".repeat(i) + "if c:").join("\n") + "\n" + "  ".repeat(30) + "pass\n"` → `labels(...)` has length 31 (30 × `"if c:"` then `"pass"`), and `timeline(...).length < 3000`.
10. incomplete code doesn't throw: `assert.doesNotThrow(() => timeline("if x\n  y=1\n"))` and `labels(...)` includes `"y=1"`.

Delete the three plan-005 `test.todo` lines (titles start with `"plan 005:`). Update the plan-003 characterization test for `"def a():\n  b()\n  b()\n"`: its expected labels become `["def a():", "b()", "b()"]` (two calls are two statements — that's correct). Assert with `labels(...)` instead of the whole-string comparison.

**Verify**: `npm run test:unit` → fails; the failures are among the new tests above (that's expected — red before green).

### Step 3: Rewrite the statement walk in `webview/parser.js`

Replace `STATEMENT_TYPES` and the `visit` function (keep everything from `let mermaidCode = ...` onward unchanged) with this logic:

```js
const SIMPLE_STATEMENTS = new Set([
  "AssignStatement", "UpdateStatement", "ExpressionStatement", "ReturnStatement",
  "RaiseStatement", "AssertStatement", "DeleteStatement", "ImportStatement",
  "PassStatement", "BreakStatement", "ContinueStatement", "ScopeStatement",
  "YieldStatement", "PrintStatement"
]);
const COMPOUND_STATEMENTS = new Set([
  "IfStatement", "ForStatement", "WhileStatement", "WithStatement", "TryStatement",
  "MatchStatement", "MatchClause", "FunctionDefinition", "ClassDefinition"
]);
const BODY_NODES = new Set(["Body", "MatchBody"]);
const MAX_LABEL_LENGTH = 80;

function toLabel(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_LABEL_LENGTH ? `${flat.slice(0, MAX_LABEL_LENGTH - 1)}…` : flat;
}
```
Inside `parseCode`, `visit(node, headerStart = node.from)`:
1. If `SIMPLE_STATEMENTS.has(node.name)`: push `toLabel(code.slice(node.from, node.to))`; **return** (do not recurse).
2. If `node.name === "DecoratedStatement"`: for each child whose name is in `COMPOUND_STATEMENTS`, call `visit(child, node.from)` (so the label includes the decorators); return.
3. If `COMPOUND_STATEMENTS.has(node.name)`:
   - `let clauseStart = headerStart; let sawBody = false;`
   - For each direct child: if `BODY_NODES.has(child.name)`, push `toLabel(code.slice(clauseStart, child.from) + ":")`, then call `visit(stmt)` for each direct child `stmt` of that body, then set `clauseStart = child.to` and `sawBody = true`.
   - If `!sawBody` (incomplete code), push `toLabel(code.slice(headerStart, node.to))`.
   - Return.
4. Otherwise (Script, StatementGroup, Comment, `:` tokens, error nodes, …): recurse into every child with `visit(child)`.

Then call `visit(tree.topNode)` as today. Labels pushed into `nodes` are raw text; the existing Mermaid-building code applies `escapeLabel` — do not escape twice.

**Verify**:
- `npm run test:unit` → exit 0, `ℹ fail 0`.
- `grep -nE "AugAssignStatement|ImportFromStatement|STATEMENT_TYPES" webview/parser.js` → no matches.

### Step 4: Full gate

**Verify**: `npm run build:webview` → exit 0; `npm run lint` → exit 0; `npm test` → exit 0 (or report VS Code couldn't launch); `git status --porcelain` → only in-scope files (ignore `dist/`).

Optional (desktop only): F5 ("Run Extension"), open a ~300-line real Python file, choose **Timeline** — it renders with no "Unable to render diagram" message and no box contains a multi-line body.

## Test plan

- 10 new tests listed in Step 2 in `test/unit/parser.test.mjs`, plus the updated characterization test.
- Pattern: existing tests in the same file (plan 003 skeleton).
- `npm run test:unit` → all pass; no `plan 005` todos remain (`grep -c "plan 005" test/unit/parser.test.mjs` → 0).

## Done criteria

- [ ] `npm run test:unit` exits 0, `ℹ fail 0`, all 10 new tests present and passing
- [ ] `grep -nE "AugAssignStatement|ImportFromStatement" webview/parser.js` → no matches
- [ ] `grep -c "plan 005" test/unit/parser.test.mjs` → 0
- [ ] `git diff 6ea6b96 -- webview/parser.js` shows `flowchart LR`, `start(["Start"])`, `endNode(["End"])` and the edge-building loop unchanged
- [ ] `npm run build:webview` and `npm run lint` exit 0
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Step 1's dump is missing a listed node name, or a `Body` doesn't start with `:`.
- `webview/parser.js` differs from the "Current state" excerpt in more than the plan-004 import.
- An expected label in Step 2 can't be produced by the Step 3 algorithm as written (e.g. a clause header comes out with extra text) — report the actual vs expected rather than adding special cases.
- You feel the need to add branching edges, change `LR`, or touch `render.js`.

## Maintenance notes

- The diagram is still linear: `else:` follows the `if` body in the chain, which a reader may misread as sequential flow. A real control-flow graph (branch and loop edges) is the natural next step and needs its own design plan; this plan's header/body walk is the foundation it will reuse.
- Mermaid's 50,000-character `maxTextSize` is still reachable for flat files with roughly 1,000+ statements (≈ 45 characters of Mermaid text per statement). Raising `maxTextSize` in `webview/render.js` or showing one function at a time are deferred options.
- Known cosmetic edge: a comment placed between a block's body and its `else`/`except` keyword ends up inside that clause's header label. Accepted; the label is still truncated to 80 characters.
- If `@lezer/python` is upgraded, re-run the Step 1 dump; node names are the contract this parser depends on.
- Reviewer: check that labels are pushed raw and escaped exactly once (in the existing Mermaid-building loop), and that `visit` returns after simple/compound statements so nothing is double-counted.
