# Plan 006: Functions mode draws one arrow per caller/callee pair, keeps same-named methods apart, and credits nested calls correctly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first)**: `git diff --stat 6ea6b96..HEAD -- webview/functionParser.js test/unit/functionParser.test.mjs`
> Plans 003 and 004 run before this one and are **expected** to show up in that diff:
> - 003 creates `test/unit/functionParser.test.mjs`.
> - 004 replaces the local `escapeLabel` at the bottom of `webview/functionParser.js` with `import { escapeLabel } from "./escapeLabel.js";`.
>
> Those changes are NOT drift. Only treat it as drift (a STOP condition) if
> the logic excerpted under "Current state" (`parseFunctions`, `findFunctions`,
> `findDefinitionName`, `findCalls`) no longer matches.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: plans/004-escape-mermaid-labels.md (and, through it, plans/003-parser-unit-tests.md)
- **Category**: bug
- **Planned at**: commit `6ea6b96`, 2026-11-05

## Why this matters

The extension's "Functions" mode draws a Python file's call graph (which function calls which) as a Mermaid flowchart. Three bugs make that graph wrong:

1. **Duplicate arrows.** Every call is pushed onto an array. A function that calls `b()` five times gets five identical arrows to `b`.
2. **Same-named methods overwrite each other.** Functions are stored by bare name, so `__init__` in two classes becomes one node, and the later definition wipes out the earlier one's calls.
3. **Nested calls are double-counted.** Calls inside a nested `def` are credited to the enclosing function as well as to the nested one.

After this plan there is one arrow per (caller, callee) pair. Methods and nested functions get qualified names such as `A.__init__` or `outer.inner`, and each call is credited only to the function whose own body contains it.

## Current state

Files:
- `webview/functionParser.js`: builds the Mermaid text for Functions mode. It is a pure function over a `@lezer/python` syntax tree and touches no DOM.
- `webview/main.js`: calls `parseFunctions(tree, currentCode)` when the mode select is `"functions"` (line 41-42). Do not change it.
- `test/unit/functionParser.test.mjs`: created by plan 003. It contains `test.todo(...)` entries for the Functions-mode bugs, which this plan turns into real assertions.

`webview/functionParser.js` at `6ea6b96` (plan 004 will have replaced lines 93-95 with an import):

```js
// webview/functionParser.js:5-38
export function parseFunctions(tree, code) {
  const functions = new Map();

  findFunctions(tree.cursor(), code, functions);

  const names = [...functions.keys()];
  const nodeIds = new Map(names.map((name, index) => [name, `function${index}`]));
  const calledNames = new Set();
  let mermaidCode = "flowchart TD\n";

  for (const calls of functions.values()) {
    for (const calledName of calls) {
      calledNames.add(calledName);
    }
  }

  for (const name of calledNames) {
    if (!nodeIds.has(name)) {
      nodeIds.set(name, `external${nodeIds.size}`);
    }
  }

  for (const [name, id] of nodeIds) {
    mermaidCode += `    ${id}["${escapeLabel(name)}"]\n`;
  }

  for (const [name, calls] of functions) {
    for (const calledName of calls) {
      mermaidCode += `    ${nodeIds.get(name)} --> ${nodeIds.get(calledName)}\n`;
    }
  }

  return mermaidCode;
}
```

```js
// webview/functionParser.js:40-55
function findFunctions(cursor, code, functions) {
  if (cursor.name === FUNCTION_DEFINITION) {
    const functionName = findDefinitionName(cursor, code);
    if (functionName !== undefined) {
      functions.set(functionName, []);          // <- bug (b): bare-name key, overwrites
      findCalls(cursor, code, functionName, functions);
    }
  }

  if (cursor.firstChild()) {
    do {
      findFunctions(cursor, code, functions);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}
```

```js
// webview/functionParser.js:74-91
function findCalls(cursor, code, currentFunction, functions) {
  if (cursor.name === CALL_EXPRESSION && cursor.firstChild()) {
    do {
      if (cursor.name === VARIABLE_NAME) {
        functions.get(currentFunction).push(code.slice(cursor.from, cursor.to)); // <- bug (a): array, duplicates
        break;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (cursor.firstChild()) {                    // <- bug (c): descends into nested defs/classes
    do {
      findCalls(cursor, code, currentFunction, functions);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}
```

Bug (a) is confirmed. For the input `"def a():\n  b()\n  b()\n"`, the current output is:

```
flowchart TD
    function0["a"]
    external1["b"]
    function0 --> external1
    function0 --> external1
```

Syntax-tree facts I confirmed by dumping the parse of `class A:\n  def __init__(self):\n    def inner():\n      g()\n    f()\n`:

```
ClassDefinition
  class, VariableName "A", Body
    FunctionDefinition
      def, VariableName "__init__", ParamList, Body
        FunctionDefinition
          def, VariableName "inner", ParamList, Body -> ExpressionStatement -> CallExpression(VariableName "g", ArgList)
        ExpressionStatement -> CallExpression(VariableName "f", ArgList)
```

So a class's name is its first `VariableName` child, just like a function's, and `findDefinitionName` works on `ClassDefinition` unchanged. Method calls such as `self.x()` or `obj.m()` have a `MemberExpression` as the first child of `CallExpression`, not a `VariableName`, and are ignored today.

Repo conventions: ES modules, double quotes, two-space indent, semicolons, small top-level helper functions, node-name constants at the top of the file (`const FUNCTION_DEFINITION = "FunctionDefinition";`). Match them.

## Decisions (already made, do not revisit)

- **Qualified names**: a node's ID key and label is its definition path joined with `.`. Examples: top-level `foo` → `foo`; a method → `A.__init__`; a nested function → `outer.inner`; a method's nested function → `A.__init__.inner`. Classes are scopes only and never become nodes themselves.
- **Call resolution**: a bare-name call `foo()` links to the **top-level** function named `foo` if one exists. Otherwise it links to an external node labelled `foo`. A bare name that matches only a method or nested function (for example `inner()` called inside `outer`) also becomes an **external** node. Resolving Python scoping correctly is out of scope; keep this simple and predictable.
- **Method calls stay ignored**: calls through a `MemberExpression` (`self.save()`, `obj.m()`, `mod.fn()`) remain ignored, as today. Resolving them needs type inference (what is `self` or `obj`?), which this parser cannot do.
- **Empty result is unchanged**: a file with no `def` still returns exactly `"flowchart TD\n"`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `npm run test:unit` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |
| Build bundle | `npm run build:webview` | exit 0, writes `dist/webview/bundle.js` (gitignored after plan 002; never commit it) |
| Integration tests | `npm test` | exit 0. It launches VS Code 1.141 and needs a desktop session. If you have none, skip it and say so in your report |
| Tree dump | see Step 1 | prints node names |

## Scope

**In scope** (the only files you should modify):
- `webview/functionParser.js`
- `test/unit/functionParser.test.mjs`

**Out of scope** (do NOT touch):
- `webview/parser.js` (Timeline mode): plan 005 owns it.
- `webview/escapeLabel.js`: plan 004 owns it. Import it; don't change it.
- `webview/main.js`, `webview/render.js`, `extension.js`: the call signature `parseFunctions(tree, code)` and its string return value must not change.
- Filtering out built-ins (`print`, `len`, …): a separate product decision.
- Resolving `MemberExpression` method calls: see Decisions.

## Git workflow

- Branch: `git fetch origin && git checkout -b advisor/006-fix-functions-mode origin/master`. If plans 003/004 are not merged into `origin/master` yet, branch from plan 004's branch (`advisor/004-...`) instead and say so in your report.
- Commit message style: short, sentence case, no prefix. Example from history: `Removed workflow`. For this plan: `Fixed duplicate and misattributed edges in functions mode`.
- Do NOT push or open a PR unless the operator told you to.

## Steps

### Step 1: Confirm the syntax-tree shape

Run:

```
node --input-type=module -e 'import {parser} from "@lezer/python"; const s="class A:\n  def __init__(self):\n    def inner():\n      g()\n    f()\n"; const c=parser.parse(s).cursor(); do{console.log(c.name)}while(c.next())'
```

**Verify**: the output contains, in this order: `ClassDefinition`, `class`, `VariableName`, `Body`, `FunctionDefinition`, `def`, `VariableName`, `ParamList`, …, `Body`, `FunctionDefinition`, … `CallExpression`, `VariableName`. If `ClassDefinition` or `Body` is missing or named differently, STOP.

### Step 2: Write failing tests first

Open `test/unit/functionParser.test.mjs` (from plan 003) and replace its Functions-mode `test.todo(...)` entries with real tests. If the todos are worded differently, keep their intent and add the cases below. Use the file's existing helper pattern, roughly:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { parseFunctions } from "../../webview/functionParser.js";

const run = (src) => parseFunctions(parser.parse(src), src);
const edges = (out) => out.split("\n").filter((l) => l.includes("-->")).map((l) => l.trim());
const labels = (out) => [...out.matchAll(/\["([^"]*)"\]/g)].map((m) => m[1]);
```

Cases (each one is a separate `test(...)`):

1. **Duplicate calls collapse**: `"def a():\n  b()\n  b()\n"` → `edges(out)` has length 1.
2. **Same-named methods stay separate**: `"class A:\n  def __init__(self):\n    x()\nclass B:\n  def __init__(self):\n    y()\n"` → `labels` include `A.__init__` and `B.__init__`. There are 2 edges, one ending at the `x` node and one at the `y` node (compare by label via ID lookup, or assert that both `x` and `y` labels exist and the edge count is 2).
3. **Nested calls credited once**: `"def outer():\n  def inner():\n    g()\n  f()\n"` → labels include `outer` and `outer.inner`. There are exactly 2 edges: outer→f and outer.inner→g. Outer has no edge to g. Assert by mapping IDs to labels: parse lines `    <id>["<label>"]` into a Map, then translate edges into `"outer --> f"` form.
4. **Bare name resolves to top-level def**: `"def a():\n  b()\ndef b():\n  pass\n"` → the edge goes to a node whose ID starts with `function` (not `external`), labelled `b`.
5. **Bare name matching only a nested def is external**: `"def outer():\n  def inner():\n    pass\n  inner()\n"` → the edge from `outer` goes to a node whose ID starts with `external`.
6. **Method calls ignored (regression guard)**: `"def a(self):\n  self.save()\n"` → zero edges.
7. **No functions**: `run("x = 1\n") === "flowchart TD\n"`.

A small helper for 3 and 4 that turns edges into label form keeps the asserts readable:

```js
function labelEdges(out) {
  const ids = new Map([...out.matchAll(/^\s+(\w+)\["([^"]*)"\]$/gm)].map((m) => [m[1], m[2]]));
  return edges(out).map((e) => e.split(" --> ").map((id) => ids.get(id)).join(" --> "));
}
```

**Verify**: `npm run test:unit` → cases 1, 2, 3 and 5 fail. Case 5 fails because today `inner` is a key in the bare-name map, so the edge goes to `function1`. Cases 4, 6 and 7 already pass. If the set of failing cases differs, note it in your report and continue.

### Step 3: Track the definition path while walking

In `webview/functionParser.js`:

- Add `const CLASS_DEFINITION = "ClassDefinition";` next to the other constants.
- Change `findFunctions(cursor, code, functions)` to `findFunctions(cursor, code, functions, scope)`, where `scope` is an array of enclosing names (start with `[]` from `parseFunctions`).
- At a `FunctionDefinition`: `name = findDefinitionName(cursor, code)`. If defined, `qualified = [...scope, name].join(".")`, `functions.set(qualified, new Set())`, call `findCalls(cursor, code, qualified, functions)`, then recurse into the children with `[...scope, name]` as the scope.
- At a `ClassDefinition`: get the name the same way and recurse into the children with `[...scope, name]`. Do not add a map entry.
- At any other node: recurse into the children with the same `scope`.
- Make sure each node's children are walked exactly once. The current code walks children in a trailing block after the `if`. Restructure it so the trailing walk uses the computed child scope (for example, compute `childScope` first, then run one `if (cursor.firstChild()) { do { … } while (cursor.nextSibling()); cursor.parent(); }` block).

**Verify**: `npm run lint` → exit 0.

### Step 4: Collect calls into a Set and stop at nested definitions

In `findCalls`:

- Replace `.push(...)` with `.add(...)` (the map value is now a `Set`). This fixes duplicate edges.
- Before descending, skip children that are `FunctionDefinition` or `ClassDefinition`, **except** at the top call, where the cursor sits on the function being scanned. Simplest shape: split the function into an entry point that walks the function's own children, and a recursive helper that returns immediately when `cursor.name === FUNCTION_DEFINITION || cursor.name === CLASS_DEFINITION`.
- Keep the cursor-balancing pattern: every successful `cursor.firstChild()` is matched by exactly one `cursor.parent()` before returning. `findDefinitionName` already follows this; copy its discipline.

**Verify**: `npm run test:unit` → cases 1 and 3 pass.

### Step 5: Resolve calls and emit nodes

In `parseFunctions`:

- Defined-function node IDs stay `function${index}`, keyed by qualified name, in insertion order.
- For each called bare name: if `functions.has(name)` **and** `!name.includes(".")` (meaning a top-level def), link to that node. Otherwise link to an external node keyed by the bare name in a **separate** map, so an external `inner` never collides with a defined `outer.inner`. Keep ID format `external${n}`, with `n` still unique across all IDs. Using a running counter equal to the total number of IDs assigned so far matches today's numbering.
- Labels use `escapeLabel(qualifiedName)` for defined functions and `escapeLabel(bareName)` for externals.
- Emit each node line once, then one edge per (caller, resolved callee) pair.

**Verify**: `npm run test:unit` → all 7 new cases pass, and all previously passing tests in `test/unit/` still pass.

### Step 6: Full gate

**Verify**:
- `npm run lint` → exit 0
- `npm run build:webview` → exit 0
- `npm test` → exit 0 (or report "skipped: no desktop session")
- `git status --short` → only `webview/functionParser.js` and `test/unit/functionParser.test.mjs` are modified

## Test plan

- File: `test/unit/functionParser.test.mjs`, following the `node:test` + `node:assert/strict` structure plan 003 set up.
- Cases: the 7 listed in Step 2. They cover dedupe, qualified methods, nested attribution, top-level resolution, nested-only resolution to external, ignored method calls, and empty input.
- Run: `npm run test:unit` → all pass, including the 7 new tests.

## Done criteria

- [ ] `npm run test:unit` exits 0, and the 7 Functions-mode cases from Step 2 exist and pass
- [ ] `grep -n "\.push(" webview/functionParser.js` → no matches
- [ ] `grep -n "ClassDefinition" webview/functionParser.js` → at least one match
- [ ] `npm run lint` exits 0
- [ ] `npm run build:webview` exits 0
- [ ] `git status --short` shows only the two in-scope files (`dist/` is ignored)
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's tree dump doesn't show `ClassDefinition` → `VariableName` → `Body` and `FunctionDefinition` → `VariableName` → `ParamList` → `Body`.
- `test/unit/functionParser.test.mjs` doesn't exist, or `npm run test:unit` isn't defined (plan 003 has not landed).
- `webview/escapeLabel.js` doesn't exist (plan 004 has not landed).
- The fix seems to need `main.js`, `render.js`, `parser.js` or `extension.js` changes.
- The cursor ends up unbalanced (tests hang, or nodes are silently skipped) and two fix attempts don't resolve it.

## Maintenance notes

- If someone later adds method-call resolution (`self.foo()` → `A.foo`), the qualified-name keys from this plan are the hook. It needs the enclosing class from `scope`.
- A Functions-mode filter for built-ins (`print`, `len`) would slot in at the call-resolution step (Step 5).
- Reviewer focus: cursor balance in the restructured walkers, and that external IDs can't collide with function IDs.
- Deferred: an empty-state message when a file has no functions. Today the diagram is an empty chart.
