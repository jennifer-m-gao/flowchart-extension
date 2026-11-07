# Plan 009: Clean up panel listeners, debounce document updates, keep the chosen mode, and handle closed documents

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first)**: `git diff --stat 6ea6b96..HEAD -- extension.js webview/main.js test/extension.test.js`
> Expected, non-drift changes from earlier plans:
> - Plan 001 may have changed the command ID string in `extension.js` (the `registerCommand('…openFlowchart', …)` line) and in `test/extension.test.js`.
> - Plan 007 adds a theme import, a `renderDiagram(diagram, mermaidThemeFor(...))` argument and a `MutationObserver` block to `webview/main.js`.
>
> Anything else that changes the excerpts below is a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-fix-command-id.md (needs a command ID that actually runs, for the integration test)
- **Category**: bug
- **Planned at**: commit `6ea6b96`, 2026-11-05

## Why this matters

Four small lifecycle bugs in the extension host (`extension.js`) and the webview (`webview/main.js`):

- **(a) Listener leak.** Every time the panel is opened and closed, two disposables are left in `context.subscriptions` for the lifetime of the session.
- **(b) Full text on every keystroke.** Each keystroke in the source file sends the **entire document text** across the extension-host → webview channel. The webview already debounces rendering, but the copy still happens on every change.
- **(c) Mode resets.** The Functions/Timeline mode picker resets to "Functions" whenever the panel is hidden (another tab in its group) and shown again, because VS Code destroys hidden webviews' state.
- **(d) Stale source.** Closing the source file leaves its stale diagram on screen.

None of these is dramatic, but together they make the panel feel unreliable. All four have small, well-understood fixes.

## Current state

`extension.js` on master (`git show origin/master:extension.js`). Line numbers are for `6ea6b96`:

```js
// extension.js:9-12
function activate(context) {
	let panel;
	let webviewReady = false;
	let sourceDocument = vscode.window.activeTextEditor?.document;
```

```js
// extension.js:35-38 (end of updatePanel: posts the whole document)
		panel.webview.postMessage({
			type: 'setCode',
			code: sourceDocument.getText()
		});
```

```js
// extension.js:76-86 (bug a: both listeners go into context.subscriptions)
		panel.webview.onDidReceiveMessage(message => {
			if (message.type === 'ready') {
				webviewReady = true;
				updatePanel();
			}
		}, undefined, context.subscriptions);

		panel.onDidDispose(() => {
			panel = undefined;
			webviewReady = false;
		}, undefined, context.subscriptions);
```

```js
// extension.js:89-102 (bug b: no debounce; bug d: no close handler)
	context.subscriptions.push(
		vscode.commands.registerCommand('pychart-extension.openFlowchart', openFlowchart),
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				sourceDocument = editor.document;
			}
			updatePanel();
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === sourceDocument) {
				updatePanel();
			}
		})
	);
```

`createWebviewPanel` options (extension.js:52-58) set `enableScripts` and `localResourceRoots` only. There is no `retainContextWhenHidden`.

`webview/main.js` (bug c):

```js
// webview/main.js:6-11
const vscode = acquireVsCodeApi();
const display = document.getElementById("display");
const modeSelector = document.getElementById("diagram-mode");
const timeTrack = document.getElementById("time-track");

let diagramMode = modeSelector.value;
```

```js
// webview/main.js:17-28
modeSelector.addEventListener("change", () => {
  diagramMode = modeSelector.value;
  renderCurrentCode();
});

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "setCode") {
    currentCode = message.code;
    renderRevision++;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(renderCurrentCode, 100);
```

```js
// webview/main.js:67
vscode.postMessage({ type: "ready" });
```

The mode `<select id="diagram-mode">` in `webview/index.html` has options `functions` (the default, listed first) and `timeline`.

The **ready handshake** must be kept. The webview posts `{type: "ready"}` when its script loads, and the host only sends code after it sees that message. When a hidden panel is shown again, the webview reloads, posts `ready` again, and gets the current code. This is how the panel resyncs, so don't remove it.

Repo conventions: `extension.js` is CommonJS with tabs, single quotes and semicolons. `webview/*.js` are ES modules with two-space indent, double quotes and semicolons. Match each file's own style.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| Build bundle | `npm run build:webview` | exit 0 (`dist/` is gitignored; never commit it) |
| Unit tests | `npm run test:unit` | exit 0 (if plan 003 has landed; otherwise skip) |
| Integration tests | `npm test` | exit 0. Runs `test/extension.test.js` inside VS Code 1.141 and needs a desktop session. If you have none, report "not run" |

## Scope

**In scope** (the only files you should modify):
- `extension.js`
- `webview/main.js`: only mode persistence
- `test/extension.test.js`

**Out of scope** (do NOT touch):
- `retainContextWhenHidden: true`: rejected on purpose (see Step 4).
- A `WebviewPanelSerializer` (restoring the panel after a VS Code window reload): a separate feature with its own `package.json` activation event. Deferred.
- `webview/parser.js`, `webview/functionParser.js`, `webview/render.js`, `webview/index.html`, `package.json`.

## Git workflow

- Branch: `git fetch origin && git checkout -b advisor/009-extension-host-lifecycle origin/master`. If plan 001 isn't merged yet, branch from plan 001's branch and say so.
- Commit style: short, sentence case. Example from history: `Removed workflow`. One commit per step is fine, for example `Disposed panel listeners with the panel`.
- Do NOT push or open a PR unless the operator told you to.

## Steps

### Step 1: Scope panel listeners to the panel (bug a)

In `openFlowchart`, after `createWebviewPanel`, add `const panelDisposables = [];`. Pass `panelDisposables` instead of `context.subscriptions` as the third argument to `panel.webview.onDidReceiveMessage(...)`. In `panel.onDidDispose`, dispose them:

```js
		panel.onDidDispose(() => {
			panel = undefined;
			webviewReady = false;
			while (panelDisposables.length) {
				panelDisposables.pop().dispose();
			}
		});
```

`onDidDispose` itself needs no disposables array. It fires once, and the panel is gone afterwards.

**Verify**: `npm run lint` → exit 0, and `grep -n "context.subscriptions" extension.js` → exactly 1 match (the `context.subscriptions.push(` block).

### Step 2: Debounce document-change posts in the host (bug b)

In `activate`, add `let updateTimer;` next to `webviewReady`. Change the `onDidChangeTextDocument` handler to:

```js
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === sourceDocument) {
				clearTimeout(updateTimer);
				updateTimer = setTimeout(updatePanel, 150);
			}
		}),
```

Also add `clearTimeout(updateTimer);` inside the `panel.onDidDispose` callback from Step 1. Leave the other `updatePanel()` callers immediate: editor switch, ready and reveal. Those are one-off events, and the user expects them to respond instantly.

**Verify**: `npm run lint` → exit 0, and `grep -n "setTimeout(updatePanel, 150)" extension.js` → 1 match.

### Step 3: Clear the source when its document closes (bug d)

Add a fourth entry to the `context.subscriptions.push(...)` block:

```js
		vscode.workspace.onDidCloseTextDocument(document => {
			if (document === sourceDocument) {
				sourceDocument = undefined;
				updatePanel();
			}
		})
```

`updatePanel` already handles `!sourceDocument` by showing "Open a Python file in the editor to generate a diagram." Don't change that message.

Caveat: VS Code also fires `onDidCloseTextDocument` when it unloads a document model after its language changes, or when it reopens a hidden document. In those cases the user's next editor switch sets `sourceDocument` again through `onDidChangeActiveTextEditor`, so no extra handling is needed.

**Verify**: `npm run lint` → exit 0.

### Step 4: Persist the mode in the webview (bug c)

In `webview/main.js`, use the webview state API instead of `retainContextWhenHidden`. That option keeps the whole hidden webview, Mermaid's ~3.5 MB bundle included, in memory. Here only one string needs saving.

Replace `let diagramMode = modeSelector.value;` with:

```js
const savedState = vscode.getState();
if (savedState?.mode) {
  modeSelector.value = savedState.mode;
}
let diagramMode = modeSelector.value;
```

and in the `change` listener, after `diagramMode = modeSelector.value;`, add `vscode.setState({ mode: diagramMode });`.

If an invalid saved value is assigned, `<select>` falls back to an empty value. Guard against that: after the assignment, if `modeSelector.value === ""`, set it back to `"functions"`.

**Verify**: `npm run lint` → exit 0, and `npm run build:webview` → exit 0.

### Step 5: Integration test for open/close cycles

In `test/extension.test.js`, add a test to the existing `suite('Extension Test Suite', …)`. Read the command ID from `package.json` (the file already parses the manifest in its first test) rather than hard-coding it, because plan 001 decides the final ID:

```js
	test('opens and closes the visualizer repeatedly without errors', async () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
		const commandId = manifest.contributes.commands[0].command;
		for (let i = 0; i < 2; i++) {
			await vscode.commands.executeCommand(commandId);
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
	});
```

Match the file's existing style: tabs, single quotes, mocha `suite`/`test`.

**Verify**: `npm test` → exit 0 with the new test listed as passing. If there's no desktop session, report "integration tests not run".

### Step 6: Manual checklist (Extension Development Host, F5)

You need a desktop session. If you have none, report "manual check not run".

1. Open a `.py` file and run the visualizer command. The diagram appears.
2. Switch the mode to **Timeline**. Open another editor tab in the panel's column so the panel is hidden, then click back to the panel tab. The mode is still **Timeline**.
3. Type quickly in the `.py` file. The diagram updates shortly after you stop typing, and the footer counter (`#time-track`) climbs by roughly one per pause, not one per keystroke.
4. Close the `.py` file's editor tab. The panel shows "Open a Python file in the editor to generate a diagram."
5. Close and reopen the panel 3 times via the command. No errors appear in the Debug Console.

**Verify**: all 5 behave as described. Record the result in your report.

### Step 7: Full gate

**Verify**:
- `npm run lint` → exit 0
- `npm run build:webview` → exit 0
- `npm run test:unit` → exit 0 (if it exists)
- `npm test` → exit 0 (or reported as not run)
- `git status --short` → only `extension.js`, `webview/main.js`, `test/extension.test.js`

## Test plan

- New integration test in `test/extension.test.js`: repeated open/close via the manifest's command ID (Step 5). Pattern: the existing `'opens the visualizer from its command'` test in the same file.
- Debounce, mode persistence and close handling are verified manually (Step 6). Automating them would need a webview test harness this repo doesn't have, which is out of scope.

## Done criteria

- [ ] `grep -n "context.subscriptions" extension.js` → exactly 1 match
- [ ] `grep -n "onDidCloseTextDocument" extension.js` → 1 match
- [ ] `grep -n "setTimeout(updatePanel" extension.js` → 1 match
- [ ] `grep -n "setState\|getState" webview/main.js` → at least 2 matches
- [ ] `grep -n "retainContextWhenHidden" extension.js` → no matches
- [ ] `npm run lint` and `npm run build:webview` exit 0
- [ ] `npm test` exits 0 (or reported as not run, with the reason)
- [ ] `git status --short` shows only the 3 in-scope files
- [ ] `plans/README.md` status row for 009 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `extension.js` doesn't contain the `onDidReceiveMessage(... context.subscriptions)` / `onDidDispose(... context.subscriptions)` pair shown above.
- `package.json`'s `contributes.commands[0].command` doesn't match the ID passed to `registerCommand` in `extension.js` (plan 001 hasn't landed). The integration test would fail for reasons unrelated to this plan.
- Removing or changing the `ready` handshake seems necessary.
- `vscode.getState()` is undefined or throws in the webview. That would mean `acquireVsCodeApi` isn't being used as expected.

## Maintenance notes

- If a `WebviewPanelSerializer` is added later (to restore the panel after a window reload), `vscode.getState()` is what it receives as `state`. Keep the `{ mode }` shape.
- If more user-facing webview settings appear (zoom, direction), store them in the same `setState` object. Don't switch to `retainContextWhenHidden`.
- The host debounce (150 ms) and the webview debounce (100 ms, `main.js` `typingTimer`) stack, giving roughly 250 ms from the last keystroke to render. If that feels laggy, reduce the host one first.
- Reviewer focus: `panelDisposables` are disposed exactly once, and the timer is cleared on panel dispose so `updatePanel` doesn't run against a dead panel. It already returns early when `!panel`, but keep it tidy.
