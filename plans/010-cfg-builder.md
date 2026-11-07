# Plan 010: A pure control-flow-graph builder turns a Python scope into `{ nodes, edges }`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, coverage %, build
> timings) as a row in `plans/METRICS.md` ("Changes log"), with the command and
> commit. If a reviewer dispatched you, put them in your report instead.
>
> **Drift check (run first, after Step 1's checkout)**: `git diff --stat b2932ab..HEAD -- webview/cfg test/unit/buildCfg.test.mjs webview/package.json`
> Expected: no output. `webview/cfg/` and `test/unit/buildCfg.test.mjs` must not exist yet.
> Changes from other 1.0.1 plans to `package.json`, the parsers or other test files are fine.
> If `webview/cfg/` already exists, STOP.

## Status

- **Priority**: P1 (the core of release 1.1)
- **Effort**: L
- **Risk**: MED (new algorithm; it isn't wired into the UI yet, so users are unaffected)
- **Depends on**: plans/003-parser-unit-test-harness.md (DONE). The test harness must exist.
- **Category**: direction (1.1 feature)
- **Planned at**: commit `b2932ab` (branch `advisor/003-parser-unit-tests`), 2026-11-05

## Why this matters

PyChart's 1.1 headline feature is a real flowchart of a Python function. It needs decision diamonds for
`if`, loops with back-edges, and `break`/`continue`/`return` that go where Python actually sends
control. Today's "Timeline" mode is a flat list of statements. This plan builds the engine
for the new view: a **pure function** from a Lezer syntax-tree scope to plain graph data
`{ nodes, edges }`. It has no DOM, no Mermaid and no layout. Later plans lay the graph out with
elkjs, draw it as SVG, and wire it to the editor. Keeping the builder pure means every control-flow
rule is unit-tested in milliseconds. That is the "≥ 90% line coverage on the builder" target from
the project's decision log (D12).

Project decisions this plan must follow (quoted from `plans/DECISIONS.md`):
- D13: "**Graph data model (the contract between stages):** each node has `id`, `kind` ..., `label`,
  and `from`/`to` source offsets. Each edge has `source`, `target`, and an optional `label`
  (`True | False | loop | exception`). It contains no Mermaid syntax and no Lezer types."
- D5: "The control-flow-graph model doesn't reference Lezer node names, so another language would only need a new front end."
  So **only** the builder may know Lezer node names. The output must not contain them.
- D12: "A unit test per control statement (if/elif/else, for/while incl. `else`, break/continue,
  return, try/except/finally, with, match), each asserting the expected edges" and "≥ 90% line
  coverage on the control-flow builder".

## Current state

- `webview/cfg/` does not exist. You will create it.
- Parsing: `import { parser } from "@lezer/python"` (v1.1.19, a devDependency). `parser.parse(code)`
  returns a `Tree`. `tree.topNode` is the `Script` node. Child navigation:
  `node.firstChild`, `node.nextSibling`, `node.getChild(name)`, `node.getChildren(name)`; ranges are `node.from` / `node.to`
  (character offsets into `code`).
- Unit-test harness (from plan 003): `webview/package.json` is `{ "type": "module" }`, and
  `package.json` has `"test:unit": "node --test \"test/unit/*.test.mjs\""`. Existing test skeleton
  (`test/unit/parser.test.mjs`):
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
    ...
  });
  ```
- Conventions (match these): ES modules, named exports, double quotes, 2-space indent,
  semicolons. See `webview/functionParser.js`, which already walks this grammar with `cursor.firstChild()` / `nextSibling()`.
- ESLint (`eslint.config.mjs`) lints `webview/**/*.js` with browser globals. Pure modules pass as long as they don't
  use Node globals.

### Verified Lezer node shapes (checked against @lezer/python 1.1.19 at planning time)

The tree is **flat** for clause-based statements. Clause keywords are sibling *token nodes*, each
followed by its own `Body`. A `Body` node **starts at the colon**. Its first child is the `:` token, and its range
includes the trailing newline.

| Python | Node and children (in order; `kw` = keyword token node) |
|---|---|
| `if a: … elif b: … else: …` | `IfStatement`: `if`(kw), condition expr, `Body`, `elif`(kw), condition expr, `Body`, `else`(kw), `Body` |
| `while a: … else: …` | `WhileStatement`: `while`(kw), condition expr, `Body`, [`else`(kw), `Body`] |
| `for x in xs: … else: …` | `ForStatement`: [`async`(kw)], `for`(kw), target expr(s), `in`(kw), iterable expr, `Body`, [`else`(kw), `Body`] |
| `break` / `continue` | `BreakStatement` / `ContinueStatement` |
| `return` / `return 1` | `ReturnStatement` (children `return`(kw) [, expr]) |
| `raise E` | `RaiseStatement` |
| `try: … except E as e: … except: … else: … finally: …` | `TryStatement`: `try`(kw), `Body`, then per handler `except`(kw), [type expr, e.g. `VariableName` or `TupleExpression`], [`as`(kw), `VariableName`], `Body`; then [`else`(kw), `Body`], [`finally`(kw), `Body`] |
| `with open(p) as fh:` | `WithStatement`: `with`(kw), item exprs, [`as`(kw), target], `Body` |
| `match v: case 1: …` | `MatchStatement`: `match`(kw), subject expr, **`MatchBody`** (not `Body`); `MatchBody` contains `:` then `MatchClause` × N; each `MatchClause`: `case`(kw), pattern (e.g. `LiteralPattern`, `CapturePattern`), `Body` |
| `def f(a):` | `FunctionDefinition`: [`async`(kw)], `def`(kw), `VariableName` (the name), `ParamList`, `Body` |
| `class C(B):` | `ClassDefinition`: `class`(kw), `VariableName`, [`ArgList`], `Body` |
| `@dec` + def/class | `DecoratedStatement`: `Decorator`… then `FunctionDefinition` or `ClassDefinition` |
| simple statements | `AssignStatement`, `UpdateStatement` (`x += 1`), `ExpressionStatement`, `AssertStatement`, `DeleteStatement`, `ImportStatement` (both `import z` and `from a import b`), `ScopeStatement` (`global`/`nonlocal`), `PassStatement`, `YieldStatement` |
| comments | `Comment` (appears as a child of `Script` or `Body`; may sit between statements) |
| `lambda x: x` | `LambdaExpression` inside an expression. It's not a statement; ignore it (it is part of its statement's text). |
| walrus `if (n := 3) > 2:` | the condition is an ordinary expression (`BinaryExpression` → `ParenthesizedExpression` → `NamedExpression`); nothing special |
| syntax error `if x` (no colon) | `IfStatement` **without a `Body` child**, containing an error node named `⚠`; following lines become siblings at the outer level |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `npm ci` | exit 0 |
| Unit tests | `npm run test:unit` | exit 0, `ℹ fail 0` |
| Coverage | `node --test --experimental-test-coverage "test/unit/*.test.mjs"` | a coverage table; the `buildCfg.js` row shows line % ≥ 90 |
| Lint | `npm run lint` | exit 0, no errors |
| Build | `npm run build:webview` | exit 0 (unaffected; nothing imports the new module yet) |
| Tree dump (Step 2) | see Step 2 | prints node names |

## Scope

**In scope** (the only files you should create or modify):
- `webview/cfg/buildCfg.js` (create)
- `webview/cfg/*.js` small helpers if you want them (create; optional; keep it to 1–2 files)
- `test/unit/buildCfg.test.mjs` (create)

**Out of scope** (do NOT touch):
- `webview/main.js`, `webview/render.js`, `webview/parser.js`, `webview/functionParser.js`, `extension.js`,
  `webview/index.html`. Wiring the builder into the UI, layout and rendering are later plans. Do
  not import the builder anywhere yet.
- `package.json` / `package-lock.json`. No new dependencies are needed.
- `webview/cfg/findScope.js` belongs to plan 011 (it may be developed in parallel). Don't create it here.

## Git workflow

- Branch: `git checkout -b advisor/010-cfg-builder <base>`. Use the base branch your reviewer names
  (the newest stacked `advisor/00N-*` branch); default `advisor/003-parser-unit-tests`.
- Commits: short sentence case like the repo history, e.g. `Added control-flow graph builder`,
  `Added control-flow builder tests`. Do NOT push.

## The specification

### API

```js
// webview/cfg/buildCfg.js
export function buildCfg(scopeNode, code) { ... } // → { nodes, edges }
```
- `scopeNode` is one of the following:
  - a `Script` node (module scope);
  - a `FunctionDefinition` node (function scope);
  - a `DecoratedStatement`. Unwrap it to its `FunctionDefinition` child; if that child is a class, throw (see below).
- `code` is the full source string the tree was parsed from. Offsets index into it.
- Any other node type: throw `new Error("buildCfg: unsupported scope " + scopeNode.name)`.
- The function must **never throw on syntax errors** inside a valid scope (users are mid-typing).

### Output

```js
{
  nodes: [{ id, kind, label, from, to, unreachable? }],
  edges: [{ source, target, label? }]
}
```
- **ids**: the start node is `"start"` and the end node is `"end"`. Every other node is `"n0"`, `"n1"`, … in creation
  order.
- **kind** is one of:
  - `start`, `end`;
  - `statement` (simple statements, `with` headers, `match` headers, malformed compound statements);
  - `decision` (`if`/`elif` clauses, `case` clauses);
  - `loop` (`while`, `for`);
  - `return`, `raise`, `break`, `continue`;
  - `try`, `except`, `finally`;
  - `def` (a nested function or class definition, shown collapsed).
- **edge label** is one of: `True`, `False` (if/elif/case and while); `next`, `done` (for); `loop`
  (the back-edge from the end of a loop body); `exception` (raise → end, try → handler/finally,
  finally re-raise); `return`, `break`, `continue` (only on edges leaving a `finally` block,
  see the try model). Edges without a label omit the `label` key.
- **Edges are unique** by `(source, target, label)`. Adding a duplicate is a no-op.
- `unreachable: true` is present only on unreachable nodes (definition below). Otherwise the key is omitted.
- Output contains **no Lezer objects or node names**: only strings and numbers.

### Labels (`label`)
- **Normalize**: replace every run of whitespace (including newlines) with a single space, then `trim()`.
- **Truncate**: if the normalized length is > 60, keep the first 59 characters and append `…` (U+2026). The result is exactly 60 characters.
- **Simple statements**: the statement's full text, normalized. For example, `z = (1 +\n     2)` becomes `z = (1 + 2)`.
- **Clause headers**: the text from the clause's keyword token to the start of its `Body` (the colon is excluded),
  normalized. Examples: `if a`, `elif b`, `while a`, `for x in xs`, `async for a in b`,
  `except E as e`, `except`, `with open(p) as fh`, `case 1`, `try`, `finally`.
- **`match` header**: text from the `match` keyword to the start of `MatchBody`, giving `match v`.
- **`def`/`class` nodes**: text from the start of the `FunctionDefinition`/`ClassDefinition` node (this includes
  `async`) to the start of its `Body`. Examples: `def g()`, `async def g()`, `class C(B)`. Decorators are not part of the label.
- **Start label**: `Start` for module scope. For function scope, the function's header as above (e.g. `def f(a)`).
- **End label**: `End`.
- No escaping. The renderer draws SVG text, not Mermaid.

### Source ranges (`from`, `to`)

These power click-to-source and cursor highlighting in later plans, so they must be exact:
- **Simple statements**: the statement node's `from`/`to`.
- **Clause nodes** (`decision`, `loop`, `try`, `except`, `finally`, `with` and `match` headers): from the clause
  keyword's `from` to the `from` of its `Body` (or `MatchBody`). That is the header line only, not the body.
- **`def` nodes**: the whole definition, including decorators (the `DecoratedStatement` range when decorated).
- **Start**: module scope is `0`/`0`. Function scope is from the `FunctionDefinition`'s `from` to its `Body`'s `from`.
- **End**: `scopeNode.to` / `scopeNode.to`.

### Algorithm (the model you must implement)

Use the classic "pending exits" construction:
- **Pending exits**: a statement builder receives `pending`, a list of `{ source, label? }` dangling edges
  that flow into whatever comes next. It returns the list of dangling edges leaving it.
- **`connect(pending, targetId)`**: adds one edge per pending entry.
- **Visiting a body**: visit its children in order, skipping these:
  - the `:` token;
  - `Comment` nodes;
  - `⚠` error nodes;
  - any keyword token.
- **Ending**: after the scope's body is done, `connect(pending, "end")`.
- **Empty or comment-only scope**: the edge is `start → end`.
- **Unreachable nodes**: when a builder creates a node and `pending` is empty, or every pending source node is itself
  unreachable, mark the new node `unreachable: true`. Still `connect` any pending entries.
  Code after the unreachable node chains normally from it, so the unreachable run is visible and
  ends at `end` (or wherever control would go).

Context passed down while walking:
- **`loops`**: a stack of `{ loopId, breaks: [], frameDepth }` for the innermost-loop targets.
- **`frames`**: a stack of finally frames `{ finallyId, abrupts: [] }` (see try).

Per statement:

1. **Simple statement** (any of the simple statement types listed above, **and any other node whose
   name ends in `Statement` that isn't handled below**):
   - one `statement` node; `connect(pending, it)`;
   - returns `[{ source: it }]`.
2. **`IfStatement`**:
   - **Malformed** (no `Body` child): treat it as a simple statement.
   - **Otherwise**, walk the children, grouping them into clauses `(keyword, Body)`.
   - **`if` / `elif` clause**:
     - make a `decision` node and `connect(currentPending, decision)`;
     - the body is built from `[{ source: decision, label: "True" }]`, and its exits are collected;
     - set `currentPending = [{ source: decision, label: "False" }]`.
   - **`else` clause**: the body is built from `currentPending`, and its exits are collected. Then `currentPending = []`.
   - **Result**: all collected body exits plus `currentPending` (the final False edge when there's no `else`).
3. **`WhileStatement`**:
   - make a `loop` node and `connect(pending, loop)`;
   - push `{ loopId: loop, breaks: [], frameDepth: frames.length }`;
   - body from `[{ source: loop, label: "True" }]`, then `connect(bodyExits with label "loop", loop)` (each body exit
     becomes an edge `→ loop` labelled `loop`);
   - pop the loop entry;
   - normal exit: `[{ source: loop, label: "False" }]`;
   - if there is an `else` clause, build it from the normal exit; exits = else exits + `breaks`. Otherwise exits =
     normal exit + `breaks`. **`break` skips the `else`.**
   - `while True:` still gets its `False` edge. That's a known simplification; don't special-case it.
4. **`ForStatement`**: the same as while, but the body's entry edge is labelled `next` and the normal exit `done`.
5. **`BreakStatement`**:
   - make a `break` node and `connect(pending, it)`;
   - if `loops` is empty (invalid Python), return `[]`;
   - otherwise route the abrupt exit: if there are finally frames deeper than the loop's `frameDepth`,
     add the edge `break → innermost frame's finallyId` and push `{ kind: "break", loop }` into that frame's `abrupts`.
     Otherwise push `{ source: break }` into the loop's `breaks`;
   - returns `[]`.
6. **`ContinueStatement`**: like break, but the direct target is an edge `continue → loopId` (no label).
   Through a finally, it pushes `{ kind: "continue", loop }`.
7. **`ReturnStatement`**:
   - make a `return` node and `connect(pending, it)`;
   - if `frames` is non-empty, add the edge `return → innermost finallyId` and record `{ kind: "return" }`;
     otherwise add the edge `return → end`;
   - returns `[]`.
8. **`RaiseStatement`**: like return, but the node kind is `raise`. The direct edge to `end` is labelled
   `exception`, and through a finally it records `{ kind: "exception" }`.
9. **`TryStatement`**. This is a simplified model; document it in a comment at the top of the function:
   - make a `try` node and `connect(pending, try)`;
   - if there is a `finally` clause, create the `finally` node **now** (so returns can target it) and push a
     frame `{ finallyId, abrupts: [] }`;
   - try body: built from `[{ source: try }]`, giving `bodyExits`;
   - **each `except` handler**:
     - make an `except` node (label: the handler header) and add the edge `try → except` labelled `exception`;
     - build its body from `[{ source: except }]`, and collect the exits in `handlerExits`.
   - `else` clause: built from `bodyExits`, and its exits **replace** `bodyExits`. It runs only when no exception occurred.
   - `normalExits = bodyExits + handlerExits`.
   - **No `finally`**: return `normalExits`.
   - **With `finally`**:
     - pop the frame;
     - if there are no `except` handlers, add the edge `try → finally` labelled `exception` and record
       `{ kind: "exception" }` in the popped frame's `abrupts`;
     - `connect(normalExits, finallyId)`, then build the finally body from `[{ source: finallyId }]`, giving `finExits`;
     - for each **distinct** abrupt kind in the popped frame, re-route from every source in `finExits`:
       - if an enclosing frame exists (and, for break/continue, that frame is deeper than the target loop's
         `frameDepth`), add an edge `→ enclosing finallyId` (no label) and push the abrupt into it;
       - otherwise:
         - `return` → edge to `end` labelled `return`;
         - `exception` → edge to `end` labelled `exception`;
         - `break` → push `{ source, label: "break" }` into that loop's `breaks`;
         - `continue` → edge to `loopId` labelled `continue`.
     - return `normalExits.length > 0 ? finExits.map(e => ({ source: e.source })) : []`. If nothing reached finally
       normally, nothing falls through.
   - **Known simplifications** (put these in the comment):
     - only one `exception` edge leaves the `try` node (we don't draw one per statement in the body);
     - exceptions raised inside handlers/else/finally are modelled only through explicit `raise`;
     - the type in `except E` is not used to choose among handlers.
10. **`WithStatement`**:
    - **Malformed** (no `Body`): a simple statement.
    - **Otherwise**, make a `statement` node for the header and `connect(pending, it)`; the body is built from
      `[{ source: it }]`, and its exits are returned.
11. **`MatchStatement`**:
    - make a `statement` node for the header (`match v`) and `connect(pending, it)`; `current = [{ source: it }]`;
    - for each `MatchClause` in `MatchBody`:
      - make a `decision` node (`case 1`) and `connect(current, decision)`;
      - its body is built from `[{ source: decision, label: "True" }]`, and the exits are collected;
      - `current = [{ source: decision, label: "False" }]`.
    - Return collected exits + `current`. The last case keeps its False edge even when it's `case _`; that's a known
      simplification.
12. **`FunctionDefinition`, `ClassDefinition` and `DecoratedStatement`** inside the scope being built:
    - one `def` node, `connect(pending, it)`, returns `[{ source: it }]`;
    - **never descend** into its body.

### Worked examples (these are the expected test results)

Edges are written `<source label> -<edge label>-> <target label>`, or `<source> -> <target>` when unlabeled.
Compare them as **sorted arrays** so edge creation order doesn't matter.

**E1. Sequence** (module scope), source `x = 1\ny = 2\n`:
```
Start -> x = 1
x = 1 -> y = 2
y = 2 -> End
```

**E2. if/elif/else** (module), source `if a:\n  x = 1\nelif b:\n  x = 2\nelse:\n  x = 3\ny = 0\n`:
```
Start -> if a
if a -True-> x = 1
if a -False-> elif b
elif b -True-> x = 2
elif b -False-> x = 3
x = 1 -> y = 0
x = 2 -> y = 0
x = 3 -> y = 0
y = 0 -> End
```
`if a` and `elif b` have `kind: "decision"`.

**E3. if without else**, source `if a:\n  x = 1\ny = 0\n`:
```
Start -> if a
if a -True-> x = 1
if a -False-> y = 0
x = 1 -> y = 0
y = 0 -> End
```

**E4. while/else with break inside an if**, source `while a:\n  if b:\n    break\n  x = 1\nelse:\n  y = 2\nz = 3\n`:
```
Start -> while a
while a -True-> if b
if b -True-> break
if b -False-> x = 1
x = 1 -loop-> while a
while a -False-> y = 2
y = 2 -> z = 3
break -> z = 3
z = 3 -> End
```

**E5. for/else with continue inside an if**, source `for x in xs:\n  if x:\n    continue\n  y = x\nelse:\n  z = 1\n`:
```
Start -> for x in xs
for x in xs -next-> if x
if x -True-> continue
continue -> for x in xs
if x -False-> y = x
y = x -loop-> for x in xs
for x in xs -done-> z = 1
z = 1 -> End
```

**E6. Function scope with return and unreachable code**:
`buildCfg(<FunctionDefinition>, code)` for `def f(a):\n  if a:\n    return 1\n  return 2\n  x = 3\n`:
```
def f(a) -> if a
if a -True-> return 1
return 1 -> End
if a -False-> return 2
return 2 -> End
x = 3 -> End
```
The node `x = 3` has `unreachable: true`, and the start node has `kind: "start"` and label `def f(a)`.

**E7. raise**, function `def g():\n  raise ValueError(1)\n`:
```
def g() -> raise ValueError(1)
raise ValueError(1) -exception-> End
```

**E8. Full try** (module), source `try:\n  a()\nexcept E as e:\n  b()\nexcept:\n  c()\nelse:\n  d()\nfinally:\n  f()\ng()\n`:
```
Start -> try
try -> a()
try -exception-> except E as e
except E as e -> b()
try -exception-> except
except -> c()
a() -> d()
d() -> finally
b() -> finally
c() -> finally
finally -> f()
f() -> g()
g() -> End
```

**E9. return inside try/finally** (function), source `def h():\n  try:\n    return 1\n  finally:\n    cleanup()\n  x = 2\n`:
```
def h() -> try
try -> return 1
return 1 -> finally
try -exception-> finally
finally -> cleanup()
cleanup() -return-> End
cleanup() -exception-> End
x = 2 -> End
```
`x = 2` has `unreachable: true`. Nothing reached `finally` normally, so nothing falls through.

**E10. break through a finally inside a loop**, source `for x in xs:\n  try:\n    break\n  finally:\n    f()\ny = 1\n`:
```
Start -> for x in xs
for x in xs -next-> try
try -> break
break -> finally
try -exception-> finally
finally -> f()
f() -break-> y = 1
f() -exception-> End
for x in xs -done-> y = 1
y = 1 -> End
```
The loop body has no normal exits, so there is no `loop` back-edge.

**E11. with**, source `with open(p) as fh:\n  r = 1\n`:
```
Start -> with open(p) as fh
with open(p) as fh -> r = 1
r = 1 -> End
```

**E12. match**, source `match v:\n  case 1:\n    a = 1\n  case _:\n    a = 2\n`:
```
Start -> match v
match v -> case 1
case 1 -True-> a = 1
case 1 -False-> case _
case _ -True-> a = 2
case _ -False-> End
a = 1 -> End
a = 2 -> End
```

**E13. Module-level definitions collapse**, source `x = 1\n@dec\ndef g():\n  pass\nclass C(B):\n  pass\ny = 2\n`:
```
Start -> x = 1
x = 1 -> def g()
def g() -> class C(B)
class C(B) -> y = 2
y = 2 -> End
```
`def g()` has `kind: "def"` and spans the whole decorated statement (its `from` equals the `@`'s offset, 6).

**E14. Nested def inside a function**, function `def outer():\n  def inner():\n    pass\n  return inner\n`:
```
def outer() -> def inner()
def inner() -> return inner
return inner -> End
```

**E15. Edge cases:**
- empty module `""` → `Start -> End`;
- `def p():\n  pass\n` → `def p() -> pass`, `pass -> End`;
- comments `# c\nx = 1  # t\n` → `Start -> x = 1`, `x = 1 -> End`;
- multi-line `z = (1 +\n     2)\n` → label `z = (1 + 2)`;
- truncation: a label of normalized length 61+ has length 60 and ends with `…`;
- malformed `if x\n  y=1\n` → `Start -> if x`, `if x -> y=1`, `y=1 -> End` (`if x` has kind `statement`) and does not throw;
- walrus `if (n := 3) > 2:\n  pass\n` → the decision label is `if (n := 3) > 2`.

## Steps

### Step 1: Branch and install

`git checkout -b advisor/010-cfg-builder <base>` (see Git workflow), then `npm ci`, then run the drift check.

**Verify**: `npm run test:unit` → exit 0. Record the current pass count as the "before" metric.

### Step 2: Confirm the grammar before coding

Run this from the repo root. It prints every node in each sample; nothing is written to disk:
```
node --input-type=module -e '
import { parser } from "@lezer/python";
for (const src of ["if a:\n  x=1\nelif b:\n  x=2\nelse:\n  x=3\n","while a:\n  break\nelse:\n  y=1\n","for x in xs:\n  continue\nelse:\n  y=1\n","try:\n  a()\nexcept E as e:\n  b()\nexcept:\n  c()\nelse:\n  d()\nfinally:\n  f()\n","with open(p) as fh:\n  r=1\n","match v:\n  case 1:\n    a=1\n","@dec\nasync def g():\n  pass\n","if x\n  y=1\n"]) {
  console.log("==", JSON.stringify(src)); const c = parser.parse(src).cursor();
  do console.log(c.name, c.from, c.to); while (c.next());
}'
```
**Verify**: the node names and order match the "Verified Lezer node shapes" table, in particular:
- `elif`/`else`/`except`/`finally` are sibling tokens of `Body`;
- `match` uses `MatchBody` → `MatchClause`;
- `Body.from` is the colon position;
- the malformed `if x` has no `Body`.

If anything differs, STOP and report the dump.

### Step 3: Write the tests first

Create `test/unit/buildCfg.test.mjs` with helpers:
```js
import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { buildCfg } from "../../webview/cfg/buildCfg.js";

function moduleCfg(src) {
  return buildCfg(parser.parse(src).topNode, src);
}
function functionCfg(src) {
  const tree = parser.parse(src);
  const fn = tree.topNode.getChild("FunctionDefinition");
  return buildCfg(fn, src);
}
function edges(cfg) {
  const label = new Map(cfg.nodes.map(n => [n.id, n.label]));
  return cfg.edges
    .map(e => `${label.get(e.source)} ${e.label ? `-${e.label}->` : "->"} ${label.get(e.target)}`)
    .sort();
}
function node(cfg, lbl) {
  return cfg.nodes.find(n => n.label === lbl);
}
```
Write one test per worked example E1–E14, each asserting `assert.deepEqual(edges(cfg), [...expected].sort())`.
E15 can be several small tests. Also add:
- **Kinds**: for E2, `node(cfg, "if a").kind === "decision"`; for E4, `node(cfg, "while a").kind === "loop"`; for E8, the kinds of the `try`/`except`/`finally`
  nodes; for E13, `def`.
- **Ranges**: for E2, `code.slice(node.from, node.to) === "if a"` for the decision (header only). For a simple statement,
  `code.slice(from, to)` is the statement text. In E13, `def g()` has `from === 6`.
- **Unreachable**: E6 and E9 flag `x = …` with `unreachable: true`. In E1 no node has an `unreachable` key.
- **Clean output**: `JSON.parse(JSON.stringify(cfg))` deep-equals `cfg` (only plain data). No `kind` is a Lezer node name
  (none ends in `Statement`).
- **Unsupported scope**: `buildCfg(<an IfStatement node>, src)` throws `/unsupported scope/`.

**Verify**: `npm run test:unit` → the new tests fail (the module doesn't exist yet). That's expected; continue.

### Step 4: Implement `webview/cfg/buildCfg.js`

Implement the specification above. Guidance:
- Keep it to one module of a few hundred lines. Use small internal functions per statement kind
  (`buildIf`, `buildLoop`, `buildTry`, …) and a `dispatch(node, pending, ctx)`.
- Find clause structure by walking `node.firstChild` / `nextSibling` and switching on `child.name`. Don't use
  regexes on source text, except in label normalization.
- Put the try-model simplifications in a comment above `buildTry`.

**Verify**: `npm run test:unit` → exit 0, `ℹ fail 0`, all new tests passing.

### Step 5: Coverage gate

Run `node --test --experimental-test-coverage "test/unit/*.test.mjs"`.

**Verify**: the row for `buildCfg.js` shows **line % ≥ 90**. If it's lower, add tests for the uncovered lines (the table
lists them). Don't add tests that only execute code without asserting on it. If a branch is genuinely
unreachable, delete it rather than test it.

### Step 6: Performance measurement (report only; there's no gate)

Run from the repo root:
```
node --input-type=module -e '
import { parser } from "@lezer/python";
import { buildCfg } from "./webview/cfg/buildCfg.js";
let body = ""; for (let i = 0; i < 40; i++) body += `  if x > ${i}:\n    y = ${i}\n  else:\n    y = -${i}\n  z = y\n`;
const src = "def big(x):\n" + body;
const t0 = performance.now(); const tree = parser.parse(src); const t1 = performance.now();
const fn = tree.topNode.getChild("FunctionDefinition");
const times = []; for (let r = 0; r < 5; r++) { const s = performance.now(); buildCfg(fn, src); times.push(performance.now() - s); }
times.sort((a, b) => a - b); const cfg = buildCfg(fn, src);
console.log("lines", src.split("\n").length - 1, "parse ms", (t1 - t0).toFixed(2), "build median ms", times[2].toFixed(2), "nodes", cfg.nodes.length, "edges", cfg.edges.length);'
```
**Verify**: it prints one line with about 201 lines and a node count of about 162. Record the numbers as metrics. The
1.1 render budget is 300 ms total; building should be a small fraction of that.

### Step 7: Full gate

**Verify**:
- `npm run lint` → exit 0;
- `npm run build:webview` → exit 0;
- `npm test` → exit 0 (unit tests, build, lint, then the VS Code integration tests). If no desktop is available, say so;
- `git status --porcelain` → clean after committing; the commits touch only in-scope files.

## Test plan

- New file `test/unit/buildCfg.test.mjs`: ≥ 14 example tests (E1–E14), plus E15 edge cases, plus
  the kind/range/unreachable/plain-data/unsupported-scope assertions.
- Pattern: helpers as in Step 3; style as `test/unit/parser.test.mjs`.
- Gate: `npm run test:unit` all pass; coverage ≥ 90% lines for `buildCfg.js`.

## Done criteria

- [ ] `webview/cfg/buildCfg.js` exports `buildCfg`
- [ ] `npm run test:unit` exits 0 with `ℹ fail 0`; the E1–E15 tests exist and pass
- [ ] Coverage table shows `buildCfg.js` line % ≥ 90 (report the exact number)
- [ ] `grep -rn "buildCfg" webview --include=*.js` → matches only inside `webview/cfg/` (not wired in yet)
- [ ] `npm run lint` and `npm run build:webview` exit 0
- [ ] Performance line from Step 6 recorded
- [ ] Only in-scope files changed (`git diff --stat <base>..HEAD`)

## STOP conditions

Stop and report back (do not improvise) if:
- The Step 2 tree dump differs from the "Verified Lezer node shapes" table.
- A worked example's expected edges seem *wrong* to you, meaning they contradict Python semantics as
  specified. Report the example and your reasoning; don't silently change the expected output.
- Coverage can't reach 90% without testing code you believe should be deleted. Report what's uncovered.
- You need a new dependency or need to modify an out-of-scope file.
- `npm test` fails in the pre-existing integration tests.

## Maintenance notes

- **Consumers (later 1.1 plans)**:
  - the elkjs layout + SVG renderer turns `{ nodes, edges }` into a drawing;
  - the view stack / follow-cursor wiring in `main.js`/`extension.js` calls
    `buildCfg(findScope(...).node, code)` (`findScope` is plan 011).

  Neither may depend on Lezer: if they need more data, add it to the node objects here.
- **`from`/`to` are load-bearing.** Click-to-source reveals `[from, to)` in the editor. Cursor highlight picks the
  node whose range contains the cursor; clause nodes cover only their header line on purpose, so the
  cursor inside a body highlights the body statement, not the enclosing `if`. A reviewer should reject any
  change that widens clause ranges to cover bodies.
- **Edge labels** beyond D13's list (`next`, `done`, `return`, `break`, `continue`) are deliberate. The renderer
  must style unknown labels generically.
- **Deferred**:
  - modelling an exception edge per statement inside `try`;
  - `except*` (ExceptionGroup) syntax;
  - `while True` with no False edge;
  - collapsing (1.2) will need a parent/child relationship between clause nodes and body nodes. When
    that plan comes, add a `parent` field here rather than re-deriving it in the renderer.
