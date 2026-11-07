# Plan 020: ▶ Run records a real execution trace (tracer + host runner + line→node mapping)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: report every number you measure (test counts, timings, sizes, before/after values) in your report, each with its command and commit. The maintainer records ALL metrics.
>
> **Drift check (run first, after branching)**: `git diff --stat e434a2e..HEAD -- extension.js webview/main.js package.json .vscodeignore`
> Plans 018 (test:ui harness) and 019 (polish: borders, hide built-ins, `self.method()`, hover hints / "?" cheat sheet / first-run tip) land before this one and touch `webview/main.js`, `webview/index.html`, `webview/index.css`, `webview/functionParser.js`, `package.json` (scripts/devDeps for test:ui) and `test/ui/`. That is NOT drift. STOP only if the `onDidReceiveMessage` handler in `extension.js` no longer looks like the excerpt below.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED (it spawns the user's Python and runs their code)
- **Depends on**: plans/018 (test:ui), plans/019 (polish). There is no code dependency on 019; it's ordering only.
- **Category**: feature (1.2 Run & replay, part 1 of 2)
- **Executor model**: opus / high
- **Planned at**: commit `e434a2e` (branch `advisor/017-label-and-version`), 2026-11-06

## Why this matters

1.2's headline feature is **Run & replay**. The user presses ▶ Run, PyChart runs the Python file for real, records every line it executes with the local variables and printed output, and then plays that path back on the flowchart. (DECISIONS D18–D20, D23.) This plan builds the **recording half**:

1. A Python tracer (`python/tracer.py`) that ships inside the extension.
2. The host code that finds the user's Python interpreter, runs the tracer safely, and posts the trace to the webview.
3. A pure JS module that maps each trace step to a node of the PyChart graph.

Plan 021 builds the playback UI on top. Typing must never run code. Running happens **only** on an explicit ▶ Run (D19).

## Current state

- `extension.js` (CommonJS, tabs, single quotes) owns the panel. Its message handler today (`git show e434a2e:extension.js`, lines 86–101):
  ```js
  		panel.webview.onDidReceiveMessage(message => {
  			if (message.type === 'ready') {
  				webviewReady = true;
  				updatePanel();
  			} else if (message.type === 'reveal' && sourceDocument
  				&& Number.isInteger(message.from) && Number.isInteger(message.to)) {
  				// ... clamps offsets, then showTextDocument + revealRange
  			}
  		}, undefined, panelDisposables);
  ```
  `sourceDocument` is the Python `TextDocument` being shown. `updatePanel()` posts `{type:'setCode', code, offset}`.
- `.vscodeignore` (`git show e434a2e:.vscodeignore`) excludes `.vscode/**`, `.vscode-test/**`, `node_modules/**`, `test/**`, `scripts/**`, `plans/**`, `.claude/**` and a few config files. A new top-level `python/` folder **is not excluded**, so it ships. Verify that with `vsce ls`.
- Graph data (from `webview/cfg/buildCfg.js`): `{nodes, edges}`. Each node is `{id, kind, label, from, to, unreachable?}`, where `from`/`to` are **character offsets** into the code string. Kinds: `start`, `end`, `statement`, `decision`, `loop`, `return`, `raise`, `break`, `continue`, `def`, `try`, `except`, `finally`. Compound statements (`decision`, `loop`, `try`, `except`) span only their **header** (keyword up to before the `:`). `start` of a function scope spans the `def …(…)` header. `buildCfg(scopeNode, code)` takes a Lezer `Script` (module) or `FunctionDefinition` node.
- `webview/cfg/findScope.js`: `findScope(tree, code, offset)` → `{ node, kind: "function"|"module", name, qualifiedName }`. `qualifiedName` looks like `Cart.add_item` or `outer.inner`; the module is `"<module>"`.
- Conventions: webview modules are ESM (`webview/package.json` `{ "type": "module" }`), with double quotes, 2-space indent and semicolons. Unit tests live in `test/unit/*.test.mjs` and use `node:test` + `node:assert/strict`. Copy the helpers style from `test/unit/findScope.test.mjs`.

### Facts verified at planning time (Python 3.12.3 on this machine; `python`, `py -3` and `python3` all exist)

| Fact | Consequence for the design |
|---|---|
| `code.co_qualname` exists (3.11+). For a nested function it is `A.m.<locals>.inner`; for a method it is `A.m`. | findScope's name is `A.m.inner`, so **strip `.<locals>`** when mapping. On < 3.11 fall back to `co_name`. |
| For a **decorated** function, the `call` event's `f_lineno` is the **decorator** line. | Map `call` events by **qualname → start node**, never by line. |
| 3.12 inlines list comprehensions, so `[x*2 for x in range(2)]` gives the **same line 3 times** in the same frame with no new frame. Lambdas and generator expressions do get their own frames (`<lambda>`, `<genexpr>`). | **Merge consecutive line events with the same `(callId, line)`** into one step with `n` repeats. Treat frames whose qualname ends in `<lambda>`/`<genexpr>` as part of the parent scope. |
| `runpy.run_path(file, run_name="__main__")` does **not** put the script's folder on `sys.path` (`sys.path[0]` stayed the cwd). | The tracer must `sys.path.insert(0, dirname(target))` and set `sys.argv = [target]`. |
| `print("done", n)` reaches a replaced `sys.stdout` as **4 separate writes** (`"done"`, `" "`, `"1"`, `"\n"`). | **Coalesce** consecutive writes in the same step into one output chunk. |
| Module-level `f_locals` includes functions/classes/modules (e.g. `'classify': <function …>`). | Filter out modules, functions, classes, methods, builtins and dunders. |
| Prototype: 14,944 line events with light locals took **0.065 s** traced vs **0.048 s** untraced. Raw JSON with full locals per step was ~870 KB. | The overhead target (< 2 s for 10k steps, D23) is realistic. Store locals as **diffs** to keep the JSON small. |
| ms-python 2026.10.0 (installed) exports `environments.getActiveEnvironmentPath(resource)` and `environments.resolveEnvironment(env)` (found 18/23 occurrences in `out/client/extension.js`). The older `settings.getExecutionDetails(resource).execCommand` is also present. | Interpreter resolution order: **ms-python environments API → `settings.getExecutionDetails` → `python` → `py -3` (Windows only) → `python3`**. If none works, show a clear error in the panel. |

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `npm run test:unit` | exit 0, `ℹ fail 0` |
| Coverage gate | `npm run test:coverage` | exit 0 (update `--test-coverage-include` per Step 6) |
| Build | `npm run build:webview` | exit 0 |
| Bundle gate | `npm run check:bundle` | exit 0 |
| Bench | `npm run bench` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| UI tests (plan 018) | `npm run test:ui` | exit 0 |
| Packaging | `npx @vscode/vsce ls` | lists `python/tracer.py` |
| Do NOT run | `npm test` | (the disk is tight; the reviewer runs the VS Code integration tests) |

## Scope

**In scope**:
- `python/tracer.py` (create)
- `extension.js` (the `run` message handler, interpreter resolution, spawn, temp-file handling)
- `webview/run/mapTrace.js` (create; the pure step → node mapping)
- `test/unit/mapTrace.test.mjs` (create)
- `test/unit/tracer.test.mjs` (create; spawns Python on fixtures, skips if no Python)
- `test/fixtures/trace/*.py` (create; small fixture programs)
- `package.json`: only the `test:coverage` include list (Step 6)

**Out of scope**:
- Any playback UI, the ▶ Run button, `webview/main.js` and `index.html`. That's plan 021, which owns the button. For this plan, `run` is triggered from tests and by posting the message manually.
- Debugger integration (D19 rejected it for now) and `input()` support (D20: not in v1).
- `webview/cfg/*` and `webview/render/*`: use them, don't change them.

## Git workflow

- Branch: `git checkout -b advisor/020-run-tracer <base>`. Use the base your reviewer names (the plan-019 branch). Then run `npm ci`.
- Commits: short sentence case, e.g. `Added execution tracer`, `Added Run handler in host`, `Mapped trace steps to graph nodes`.
- Do NOT push.

## Steps

### Step 1: Fixture programs

Create `test/fixtures/trace/` with these files, each runnable with plain `python <file>`:
- `loops.py`: a `classify(scores)` with a `for`, an `if/elif/else`, a `break` and a `continue`, plus a call `print(classify([5, -1, 70, 101, 40]))`.
- `tryfinally.py`: a function with `try: … return x … finally: print("cleanup")`, called once.
- `raises.py`: calls a function that raises `ValueError("bad")` uncaught.
- `infinite.py`: `i = 0` then `while True: i += 1`.
- `asks.py`: `name = input("name? ")` then `print(name)`.
- `decorated.py`: a decorated function, a method `Cart.add_item`, a nested `outer.inner`, a lambda, a list comprehension, and calls to all of them.
- `big.py`: deterministic code producing roughly 10,000–15,000 line events, e.g. a loop calling a small function about 1,700 times. Used for the overhead metric.

**Verify**: `python test/fixtures/trace/loops.py` prints the classified list. `python test/fixtures/trace/raises.py` exits with code 1 and a `ValueError` message.

### Step 2: `python/tracer.py`

CLI: `python tracer.py <target.py> <out.json> [--max-steps 10000] [--max-seconds 10]`. It is standalone (stdlib only), works on Python 3.8+ and uses `co_qualname` when available.

Behaviour:
1. `target = os.path.abspath(argv[1])`. Set `sys.argv = [target]`, `sys.path.insert(0, os.path.dirname(target))`. Replace `builtins.input` with a function that raises `_InputNotSupported` (a `BaseException` subclass). Redirect `sys.stdout`/`sys.stderr` to a capture object whose `write(s)` appends to `output` as `[stepIndex, "out"|"err", text]`, **coalescing** with the previous chunk when the step and stream are the same. Its `flush()` is a no-op, and `isatty()` returns False.
2. Trace function (`sys.settrace`, which is returned for local tracing): ignore frames whose `f_code.co_filename` isn't `target` (compare with `os.path.normcase`), returning None for them.
   - `call`: assign `callId` (an incrementing int) in a dict keyed by `id(frame)`. Record a `{"e":"call","q":qualname,"c":callId,"d":depth,"l":f_lineno}` event (`d` is the number of target-file frames on the stack).
   - `line`: if the previous recorded step has the same `c` and `l`, increment its `"n"` (repeat count) and update its locals diff. Otherwise append a step `{"e":"line","c","q","l","d","v":<locals diff>}`. Every **new** line step counts toward the limit.
   - `return`: record `{"e":"return","c",...}` and drop the callId. `exception`: record `{"e":"exception","c","l","x":type name}`.
   - **Locals diff:** keep the last snapshot per callId. Snapshot = up to 20 variables, skipping names starting with `__` and values that are modules, functions, classes, methods or builtins. Values are rendered with a `reprlib.Repr` limited to 80 chars (maxstring/maxlist/maxdict small) so a huge list doesn't cost a full `repr`. Wrap it in try/except, and show `<repr failed>` on error. The diff is `{"set":{name:repr,...},"del":[names]}`; omit empty parts and omit `"v"` entirely when nothing changed.
   - **Limits:** when new line steps reach `max_steps`, or `time.perf_counter() - t0 > max_seconds` (checked in the trace function; Windows has no SIGALRM), raise `_LimitReached` (a `BaseException` subclass, so a user's `except Exception` can't swallow it).
3. Run `runpy.run_path(target, run_name="__main__")` inside try/except, then `sys.settrace(None)`. Set `reason`:
   - `"done"` on normal completion
   - `"limit"` for `_LimitReached`
   - `"input-not-supported"` for `_InputNotSupported`
   - `"exit"` for `SystemExit`, recording its code
   - `"exception"` for any other `BaseException`, recording `{"type","message","line"}` with the line from the innermost target-file traceback frame
4. Write `out.json` in UTF-8:
   ```
   {"version":1,"python":"3.12.3","target":<path>,"reason":...,"exception":...,"exitCode":...,
    "limits":{"steps":10000,"seconds":10},"elapsedMs":...,"events":[...],"output":[...]}
   ```
   Write it **only** to the given out path, never to stdout, so user prints can't corrupt it. Exit with code 0 even when the user program failed; the reason says what happened. Exit 2 only for a tracer usage error.

**Verify**: `python python/tracer.py test/fixtures/trace/loops.py %TEMP%/t.json` (or `$TMPDIR` in Git Bash) → exit 0, and `node -e "const t=require(process.argv[1]);console.log(t.reason,t.events.length,t.output.length)" <path>` prints `done <n> <m>` with n > 0.

### Step 3: Tracer tests (`test/unit/tracer.test.mjs`)

At the top, detect Python with `spawnSync("python", ["--version"])`, falling back to `py -3`. If none is found, mark every test `{ skip: "no python on PATH" }`, so the suite still passes on machines without Python. Each test spawns the tracer on a fixture into a temp file and asserts:
1. `loops.py`: `reason === "done"`. The line steps in `classify` visit the `for` header line once per element **plus one** exit check. `break` is taken (no steps after the break line inside the loop for that call). `continue` returns to the header. The output chunks contain the printed list.
2. `tryfinally.py`: the `return` line's step comes before the `finally` body line's step, which comes before the function's `return` event. The cleanup print is captured.
3. `raises.py`: `reason === "exception"`, `exception.type === "ValueError"`, and `exception.line` is the `raise` line.
4. `infinite.py` run with `--max-steps 500`: `reason === "limit"` and exactly 500 new line steps. A separate run with `--max-seconds 1 --max-steps 100000000` gives `reason === "limit"` within 3 s wall.
5. `asks.py`: `reason === "input-not-supported"`.
6. `decorated.py`: qualnames include `Cart.add_item` and `outer.<locals>.inner`. The comprehension line appears as **one** step with `n > 1`. Locals never include functions or modules.
7. The locals diff: in `loops.py`, a step after `s` changes has `v.set.s`, and a step where nothing changed has no `v`.
8. Printed output is coalesced: `print("a", 1)` produces one chunk `"a 1\n"`.

**Verify**: `npm run test:unit` → 0 fail, and the tracer tests show as passed (not skipped) on this machine.

### Step 4: `webview/run/mapTrace.js` (pure; no DOM, no Lezer import)

```
export function normalizeQualname(q)          // "A.m.<locals>.inner" -> "A.m.inner"; "<module>" stays
export function lineStarts(code)              // offsets of each line start (handles \r\n)
export function mapStepToNode(graph, code, line, starts)
  // nodes of `graph` (excluding start/end) whose `from` lies on `line` (1-based):
  // pick the one with the smallest `from`; if none, the smallest-span node whose [from,to)
  // contains the line's start offset; else null.
export function scopeForStep(qualname, scopes)
  // scopes: Map<qualifiedName, scopeInfo> built by the caller (021) from findScope-compatible names.
  // strip trailing "<lambda>"/"<genexpr>" components and ".<locals>"; walk up "A.b.c" -> "A.b" -> "A"
  // until a key matches; class-body frames (no match) and "<module>" -> the "<module>" scope.
```
`call` events map to the scope's `start` node, and `return` events map to its `end` node. Plan 021 uses this; keep it free of side effects.

**Verify**: `npm run lint` → exit 0.

### Step 5: Tests for the mapping (`test/unit/mapTrace.test.mjs`)

Build real graphs with `parser.parse` + `findScope` + `buildCfg` on small sources, and assert:
- A `for` header line maps to the `loop` node, an `if` line to the `decision`, an `elif` line to its own decision, an `except E as e:` line to the `except` node, and a body statement to its `statement` node.
- A multi-statement line (`a = 1; b = 2`) maps to the first statement.
- A line with no node returns null.
- CRLF code maps to the same nodes as LF.
- `normalizeQualname("A.m.<locals>.inner") === "A.m.inner"`.
- `scopeForStep` resolves `outer.<locals>.<lambda>` → `outer`, a class body `Cart` → `<module>`, and a method `Cart.add_item` → itself.

**Verify**: `npm run test:unit` → 0 fail.

### Step 6: Coverage gate

Add `webview/run/**` to the `--test-coverage-include` list of the `test:coverage` script, as a second include alongside `webview/cfg/**`. Keep `--test-coverage-lines=90`.

**Verify**: `npm run test:coverage` → exit 0, with `mapTrace.js` at ≥ 90% line coverage. Report the %.

### Step 7: Host runner (`extension.js`)

Add a `run` branch to `onDidReceiveMessage`:
1. Guard: `sourceDocument` exists and `languageId === 'python'`; otherwise post `{type:'runStatus', state:'error', message:'Open a Python file to run it.'}`.
2. **Save before running**, like VS Code's own "Run Python File": if `sourceDocument.isUntitled`, write the text to a temp file `os.tmpdir()/pychart-<random>.py` (deleted afterwards) and use that as the target. Otherwise call `await sourceDocument.save()` and use `sourceDocument.uri.fsPath` as the target, so `__file__`, relative imports and the working folder behave like a normal run. Record `codeVersion = sourceDocument.version` at run start.
3. Resolve the interpreter. Each step is wrapped in try/catch and falls through on failure:
   1. The ms-python extension: `const ext = vscode.extensions.getExtension('ms-python.python')`. If present: `await ext.activate()`, then `const env = await ext.exports.environments.resolveEnvironment(ext.exports.environments.getActiveEnvironmentPath(sourceDocument.uri))`, and use `env?.executable?.uri?.fsPath`.
   2. `ext.exports.settings?.getExecutionDetails?.(sourceDocument.uri)?.execCommand`, an array whose first element is the executable and the rest are prefix args.
   3. `python`, then `py` with prefix `['-3']` (only if `process.platform === 'win32'`), then `python3`. Test each with a quick `--version` spawn (2 s timeout) and keep the first that exits 0.
   If all fail, post `runStatus` error: `'No Python interpreter found. Install Python or select one with "Python: Select Interpreter".'`
4. Spawn: `child_process.spawn(exe, [...prefix, tracerPath, target, outPath], { cwd: path.dirname(target), shell: false, stdio: ['ignore','pipe','pipe'], windowsHide: true })`. `tracerPath = path.join(context.extensionPath, 'python', 'tracer.py')` and `outPath = os.tmpdir()/pychart-trace-<random>.json`. Post `{type:'runStatus', state:'running'}`. Kill the child after **15 s** (an outer safety net above the tracer's own 10 s limit) and report an error if it was killed.
5. On exit: read and `JSON.parse` the out file. Post `{type:'trace', trace, codeVersion}`, then `{type:'runStatus', state:'done', reason: trace.reason}`. On a missing or unparseable file, post `runStatus` error with the first 500 chars of the child's stderr. **Always** delete the temp out file (and a temp target, if one was made) in a `finally`.
6. Ignore a second `run` while one is in progress: post `runStatus` `{state:'running'}` again and don't spawn a second process.
7. Never use a shell. Never interpolate paths into a command string.

**Verify**: `npm run lint` → exit 0. `node -e "require('child_process')"` is used only via `spawn`/`spawnSync` (check with `grep -n "exec(" extension.js` → no matches).

### Step 8: Packaging

**Verify**: `npx @vscode/vsce ls | grep -c "^python/tracer.py$"` → `1`, and `npx @vscode/vsce ls | grep -cE "^(test|plans|scripts|\.claude)/"` → `0`.

### Step 9: Metrics (D23) and full gate

1. **Tracer overhead:** run `big.py` 5 times untraced (`python big.py`) and 5 times traced (`python python/tracer.py big.py out.json --max-steps 100000`), timing each from Node with `performance.now()` around `spawnSync`. Report each median, the difference (target **< 2 s** for about 10k steps), the line-step count and the `out.json` size in bytes.
2. Gate: `npm run test:unit`, `npm run test:coverage`, `npm run build:webview`, `npm run check:bundle`, `npm run bench`, `npm run lint`, `npm run test:ui`. All exit 0. Report each output's key line.
3. `git status --short` is clean after your commits.

## Test plan

- `test/unit/tracer.test.mjs`: 8 cases, spawning real Python on fixtures and skipping cleanly when there's no Python.
- `test/unit/mapTrace.test.mjs`: ≥ 8 cases on real graphs, including CRLF.
- Pattern: `test/unit/findScope.test.mjs` (node:test, helpers at the top).
- The host spawn path is covered by the reviewer's VS Code run and by plan 021's UI tests (which use a simulated trace). Don't try to unit-test `extension.js`.

## Done criteria

- [ ] `python/tracer.py` exists; `vsce ls` lists it, and lists none of test/plans/scripts/.claude
- [ ] `npm run test:unit` 0 fail; tracer tests ran (not skipped) here
- [ ] `npm run test:coverage` exit 0, with `webview/run/mapTrace.js` ≥ 90% line
- [ ] `grep -n "exec(\|shell: true" extension.js` → no matches
- [ ] Overhead metric reported: traced − untraced < 2 s for the ~10k-step fixture, with the JSON size reported
- [ ] lint, build, check:bundle, bench and test:ui all exit 0
- [ ] Only in-scope files changed

## STOP conditions

- `co_filename` doesn't match the target path for the target's own frames (for example a symlink or short-path mismatch on Windows) even after `os.path.normcase(os.path.realpath(...))`. Report the two strings.
- The ms-python API shape differs: `getActiveEnvironmentPath`/`resolveEnvironment` are missing at runtime. Implement the fallback chain anyway, then report what you observed (`Object.keys(ext.exports)`).
- The 10k-step overhead is ≥ 2 s after you've removed per-step `repr` of unchanged values. Report the profile; don't drop locals on your own.
- The tracer needs a third-party package. It must stay stdlib-only.
- You find yourself needing to touch `webview/main.js` or the UI. That belongs to plan 021.

## Maintenance notes

- **Trace format v1** (`version: 1`) is the contract with plan 021's player. Any change needs a version bump and a player update.
- **Threads aren't traced** (that would need `threading.settrace`). Code running in threads won't appear. Note it in the README later.
- **`_LimitReached` is a `BaseException`.** A user's bare `except:` could still swallow it; the outer 15 s kill covers that.
- **Saving before Run** matches VS Code's own Run button. If users object, a "don't save; use a temp copy" setting could be added (`__file__` would then point at the temp file).
- **Security:** code only runs on an explicit ▶ Run (D19). It runs with the user's own interpreter and permissions, exactly like running the file themselves. There is no shell and no string-built commands.
