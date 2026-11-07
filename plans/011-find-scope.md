# Plan 011: `findScope` picks the function under the cursor (or the module) for the flowchart

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, coverage %) as a row in
> `plans/METRICS.md` ("Changes log"), with the command and commit. If a reviewer
> dispatched you, put them in your report instead.
>
> **Drift check (run first, after Step 1's checkout)**: `git diff --stat b2932ab..HEAD -- webview/cfg/findScope.js test/unit/findScope.test.mjs webview/package.json`
> Expected: no output. If `webview/cfg/findScope.js` already exists, STOP. (`webview/cfg/buildCfg.js`
> from plan 010 may or may not exist; either is fine.)

## Status

- **Priority**: P1 (release 1.1)
- **Effort**: S
- **Risk**: LOW (a pure module, not wired into the UI yet)
- **Depends on**: plans/003-parser-unit-test-harness.md (DONE). It is **independent of plan 010**: they only share the
  `webview/cfg/` folder, so the two can run in parallel. Whichever lands second just adds its file.
- **Category**: direction (1.1 feature)
- **Planned at**: commit `b2932ab` (branch `advisor/003-parser-unit-tests`), 2026-11-05

## Why this matters

PyChart 1.1 shows the flowchart of **the function the cursor is in**, falling back to module-level code
when the cursor is outside any function (decision D7 in `plans/DECISIONS.md`: "the control-flow view
follows the cursor (the function it's in, or module-level code)"). A learner then sees one
function's logic at a time instead of a wall of boxes. This plan builds the pure lookup that answers
"which scope is at offset N?". The result is passed to the graph builder (`buildCfg(scope.node, code)`,
plan 010), and its `qualifiedName` becomes the panel title (e.g. `Cart.add_item`).

## Current state

- `webview/cfg/findScope.js` does not exist.
- Parsing: `import { parser } from "@lezer/python"`; `const tree = parser.parse(code)`. Useful API:
  - `tree.topNode` is the `Script` node;
  - `tree.length` is the document length;
  - `tree.iterate({ enter(ref) { … } })` visits every node, and `ref.node` gives the `SyntaxNode`;
  - `node.parent`, `node.getChild("VariableName")`, `node.from` / `node.to`.
- Verified tree shapes (@lezer/python 1.1.19):
  - `def f(): …` is a `FunctionDefinition`, with children [`async`], `def`, `VariableName` (the name), `ParamList`, `Body`.
  - `class K: …` is a `ClassDefinition`, with children `class`, `VariableName`, [`ArgList`], `Body`. Methods are `FunctionDefinition` nodes inside
    the class's `Body`.
  - `@dec\ndef g(): …` is a `DecoratedStatement`, containing `Decorator` and then the `FunctionDefinition`. The
    `FunctionDefinition.from` is **after** the decorator (at `async`/`def`).
  - A `Body` range includes its trailing newline, so a function's `to` equals the offset of the **start of the
    next line**. Example: in `x = 1\n\n\ndef g():\n  pass\n\ny = 2\n` the `FunctionDefinition` is 8–24, and offset 24
    is the empty line after `pass`.
  - Empty source: `tree.topNode` is `Script` with range 0–0 and no children.
- Unit-test harness (plan 003): `test/unit/*.test.mjs`, `node:test` + `node:assert/strict`, run with
  `npm run test:unit`. Copy the skeleton at the top of `test/unit/parser.test.mjs`.
- Conventions: ES modules, named exports, double quotes, 2-space indent, semicolons.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `npm ci` | exit 0 |
| Unit tests | `npm run test:unit` | exit 0, `ℹ fail 0` |
| Coverage | `node --test --experimental-test-coverage "test/unit/*.test.mjs"` | `findScope.js` row line % reported |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope**: `webview/cfg/findScope.js` (create) and `test/unit/findScope.test.mjs` (create).

**Out of scope**:
- `webview/cfg/buildCfg.js`, which belongs to plan 010. Don't create or edit it here.
- `webview/main.js`, `extension.js` and everything else. Wiring (sending the cursor offset from the extension, the
  view stack) is a later plan. Don't import `findScope` anywhere yet.

## Git workflow

- Branch: `git checkout -b advisor/011-find-scope <base>`. Use the base your reviewer names; default
  `advisor/003-parser-unit-tests`.
- One commit, short sentence case, e.g. `Added findScope for cursor-following flowchart`. Do NOT push.

## Specification

```js
// webview/cfg/findScope.js
export function findScope(tree, code, offset) { ... }
// → { node, kind: "function" | "module", name, qualifiedName }
```

- **Containment rule**: a function *contains* `offset` when `start <= offset < end`, **or** when `offset === end` and
  `code[end - 1] !== "\n"`. The second case is the cursor at the very end of a file without a trailing
  newline.
  - `start` is the `DecoratedStatement`'s `from` if the function's parent is a `DecoratedStatement`, otherwise the
    `FunctionDefinition`'s `from`. So the cursor on a decorator line selects that function.
  - `end` is the `FunctionDefinition`'s `to`.
- **Result**: the **innermost** containing `FunctionDefinition`, meaning the containing one with the largest `start`.
  Methods count. Nested functions give the innermost one.
- **Function result**: `{ node: <the FunctionDefinition, never the DecoratedStatement>, kind: "function", name, qualifiedName }`.
  - `name`: the text of the function's `VariableName` child. If it's missing (mid-typing, e.g. `def (`), use `"?"`.
  - `qualifiedName`: the names of all enclosing `FunctionDefinition`/`ClassDefinition` ancestors, outermost first, then
    `name`, joined with `"."`. Examples: `Cart.add_item`, `outer.inner`, `f.C.m`.
- **No containing function** (module-level code, a class body outside its methods, a `class` header line, blank lines
  between functions, an empty file, an offset past the end, a negative offset): `{ node: tree.topNode, kind: "module", name: "<module>", qualifiedName: "<module>" }`.
  `<module>` is the name Python itself uses in tracebacks.
- **Never throw**, whether on syntax errors or out-of-range offsets.
- **Lambdas** are expressions (`LambdaExpression`), not scopes. Ignore them.

## Steps

### Step 1: Branch and install

Create the branch (see Git workflow), run `npm ci`, and run the drift check.

**Verify**: `npm run test:unit` → exit 0.

### Step 2: Tests first

Create `test/unit/findScope.test.mjs`:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { findScope } from "../../webview/cfg/findScope.js";

// "|" marks the cursor; it is removed before parsing.
function scopeAt(marked) {
  const offset = marked.indexOf("|");
  const code = marked.slice(0, offset) + marked.slice(offset + 1);
  const s = findScope(parser.parse(code), code, offset);
  return { kind: s.kind, name: s.name, qualifiedName: s.qualifiedName, nodeName: s.node.name };
}
```
Cases (expected `{ kind, qualifiedName, nodeName }`):
1. Cursor inside a function body: `def f():\n  x |= 1\n` → `function`, `f`, `FunctionDefinition`.
2. On the `def` line: `de|f f():\n  pass\n` → `function`, `f`.
3. On a decorator line: `@de|c\ndef g():\n  pass\n` → `function`, `g`. Also assert that `node.name` is
   `FunctionDefinition` (not `DecoratedStatement`).
4. Module code: `x = 1|\ndef f():\n  pass\n` → `module`, `<module>`, `Script`.
5. On the blank line after a function (column 0 of the next line): `def f():\n  pass\n|\ny = 2\n` → `module`.
6. At the end of the last line of a function, with no trailing newline: `def f():\n  pass|` → `function`, `f`.
7. A method: `class Cart:\n  def add_item(self):\n    retu|rn 1\n` → `function`, `Cart.add_item`.
8. A class body outside methods: `class K:\n  y |= 1\n  def m(self):\n    pass\n` → `module`.
9. A class header: `cla|ss K:\n  def m(self):\n    pass\n` → `module`.
10. Nested functions:
    - `def outer():\n  def inner():\n    pa|ss\n  return inner\n` → `outer.inner`;
    - with the cursor on `return inner` instead → `outer`.
11. Function, class, method: `def f():\n  class C:\n    def m(self):\n      pa|ss\n` → `f.C.m`.
12. An async def: `async def g():\n  awa|it x\n` → `function`, `g`.
13. An empty file: `|` → `module`.
14. Out of range: call `findScope(tree, code, 999)` and `findScope(tree, code, -5)` directly on `def f():\n  pass\n` → both
    `module`, with no throw.
15. Mid-typing: `def |(` → does not throw. The result is either `module`, or `function` with name `"?"`; assert only that it
    doesn't throw and `kind` is one of the two.
16. A lambda is not a scope: `f = lambda x: x| + 1\n` → `module`.

**Verify**: `npm run test:unit` → the new tests fail (the module is missing). Expected; continue.

### Step 3: Implement `webview/cfg/findScope.js`

Do a straightforward walk:
1. `tree.iterate`, collecting every `FunctionDefinition` whose span contains the offset under the rule above.
2. Pick the one with the largest `start`.
3. Compute `name` and `qualifiedName` by walking `node.parent` upward, collecting `VariableName` children of `FunctionDefinition`/`ClassDefinition` ancestors.

Keep it under ~60 lines. No caching.

**Verify**: `npm run test:unit` → exit 0, `ℹ fail 0`, all 16 cases passing.

### Step 4: Coverage and lint

**Verify**:
- `node --test --experimental-test-coverage "test/unit/*.test.mjs"` → the `findScope.js` row shows line % ≥ 90.
  Report the number.
- `npm run lint` → exit 0.
- `npm run build:webview` → exit 0 (unaffected).
- `git status --porcelain` → clean after committing; only the two in-scope files are in the commit.

## Test plan

- New `test/unit/findScope.test.mjs` with the 16 cases above, using the `|` cursor-marker helper.
- Gate: `npm run test:unit` passes; coverage ≥ 90% lines for `findScope.js`.

## Done criteria

- [ ] `webview/cfg/findScope.js` exports `findScope(tree, code, offset)`
- [ ] `npm run test:unit` exits 0 with `ℹ fail 0`; the 16 cases exist and pass
- [ ] `findScope.js` line coverage ≥ 90% (report the exact number)
- [ ] `npm run lint` exits 0
- [ ] `grep -rn "findScope" webview --include=*.js` → matches only in `webview/cfg/findScope.js` (not wired in yet)
- [ ] Only the two in-scope files are in the commit

## STOP conditions

- The tree shapes differ from "Current state" (for example, `FunctionDefinition.from` includes the decorator, or
  `Body` doesn't include the trailing newline). Report a dump, because the containment rule depends on them.
- A case's expected result contradicts the specification as written. Report it; don't change expectations silently.
- You need to modify `buildCfg.js` or any wiring file.

## Maintenance notes

- **Consumers**: the 1.1 wiring plan will have the extension send the cursor offset (from
  `onDidChangeTextEditorSelection`, using `document.offsetAt(selection.active)`) to the webview. The webview then
  calls `findScope(tree, code, offset)` and `buildCfg(scope.node, code)` (plan 010), and re-renders only when
  the scope **changes**: compare `scope.node.from`/`to` with the previous ones, and ignore cursor moves within the same
  function. `qualifiedName` feeds the panel title and, later, drill-down breadcrumbs (backlog D10).
- **Offsets must match between editor and parser.** VS Code offsets and JS string indices are both UTF-16
  code units, so they line up. Don't convert to bytes or code points anywhere in the pipeline.
- **Performance**: `tree.iterate` walks the whole tree on each call. That's fine for learner-sized files. If profiling
  ever shows it in the 300 ms budget, switch to `tree.resolveInner(offset, 1)` and walk `parent` upward. The
  same tests must still pass.
- **Deviation from the originally drafted signature** `findScope(tree, offset)`: `code` is required to
  read function names and to apply the end-of-file rule.
