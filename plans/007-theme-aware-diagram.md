# Plan 007: Diagrams follow the VS Code colour theme (light, dark, high contrast)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report. Do not improvise. When done, update the status row for this plan
> in `plans/README.md`, unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Metrics**: record every number you measure (test counts, timings, sizes, before/after values) as a row in `plans/METRICS.md` ("Changes log"), with the command and commit. Measure "before" on the base commit before you change anything.
>
> **Drift check (run first)**: `git diff --stat 6ea6b96..HEAD -- webview/render.js webview/main.js`
> Plans 003–006 may already have landed. They do not modify `render.js`.
> They also should not change the `main.js` lines excerpted below. Any change
> to those excerpts is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-untrack-build-output-and-cleanup.md (base branch state). It is independent of 003–006, except that it reuses the `test/unit/` + `npm run test:unit` setup from plans/003-parser-unit-tests.md for its one unit test
- **Category**: bug
- **Planned at**: commit `6ea6b96`, 2026-11-05

## Why this matters

The webview page follows the VS Code theme because `webview/index.css` uses `--vscode-*` CSS variables, but the Mermaid diagram inside it is hard-coded dark: `#222222` boxes, white text and cyan lines. In any light theme the user sees dark boxes on a light background, which looks broken. After this plan the diagram uses Mermaid's built-in light theme in light themes and its dark theme in dark themes, and re-renders when the user switches theme without closing the panel.

## Current state

Files:
- `webview/render.js`: sets up Mermaid once at module load and exports `renderDiagram(code)`, which returns an SVG string.
- `webview/main.js`: webview entry point. It parses code, calls `renderDiagram`, and writes the SVG into `#display`.
- `webview/index.css`: already theme-aware through `--vscode-editor-background`, `--vscode-editor-foreground` and similar. Don't change it.

```js
// webview/render.js:1-17 (entire file)
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: {
    primaryColor: "#222222",
    primaryTextColor: "#ffffff",
    primaryBorderColor: "#888888",
    lineColor: "#00bcd4"
  }
});

export async function renderDiagram(code) {
  const { svg } = await mermaid.render(`flowchart-${Date.now()}`, code);
  return svg;
}
```

```js
// webview/main.js:36-44
async function renderCurrentCode() {
  const revision = ++renderRevision;

  try {
    const tree = parser.parse(currentCode);
    const diagram = diagramMode === "functions"
      ? parseFunctions(tree, currentCode)
      : parseCode(tree, currentCode);
    const svg = await renderDiagram(diagram);
```

```js
// webview/main.js:17-20 (existing pattern for "something changed → re-render")
modeSelector.addEventListener("change", () => {
  diagramMode = modeSelector.value;
  renderCurrentCode();
});
```

Platform facts:
- VS Code puts exactly one theme-kind class on the webview's `<body>`: `vscode-light`, `vscode-dark`, `vscode-high-contrast` (dark high contrast) or `vscode-high-contrast-light`. It swaps the class when the user changes theme, without reloading the webview.
- Mermaid 11 (installed: 11.17.2) has the built-in themes `"default"` (light) and `"dark"`. Calling `mermaid.initialize(...)` again with a new `theme` before the next `mermaid.render(...)` is supported.
- The CSP in `webview/index.html` already allows `style-src 'unsafe-inline'`, which Mermaid's inline SVG styles need. **No CSP change is needed.**

Repo conventions: ES modules, double quotes, two-space indent, semicolons, small named exports. Webview modules that unit tests import must not import `mermaid` or touch `document` at load time. Node tests have no DOM.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Unit tests | `npm run test:unit` | exit 0, all pass |
| Lint | `npm run lint` | exit 0 |
| Build bundle | `npm run build:webview` | exit 0 (`dist/` is gitignored; never commit it) |
| Integration tests | `npm test` | exit 0. It launches VS Code 1.141 and needs a desktop session. If you have none, skip it and say so |

## Scope

**In scope** (the only files you should modify or create):
- `webview/theme.js` (create): the pure theme-picking function
- `webview/render.js`
- `webview/main.js`: only the observer and theme hand-off described below
- `test/unit/theme.test.mjs` (create)

**Out of scope** (do NOT touch):
- `webview/index.html`: the CSP is fine as is.
- `webview/index.css`: already theme-aware.
- `webview/parser.js`, `webview/functionParser.js`: other plans own them.
- `extension.js`: the extension host doesn't need to know the theme.
- Deriving Mermaid colours from `--vscode-*` CSS variables. It's possible, but this plan deliberately uses the built-in themes for simplicity. See Maintenance notes.

## Git workflow

- Branch: `git fetch origin && git checkout -b advisor/007-theme-aware-diagram origin/master`. If plan 003 isn't merged yet (`npm run test:unit` is missing), branch from plan 003's branch and say so.
- Commit style: short, sentence case. Example from history: `Removed workflow`. For this plan: `Made diagram theme follow VS Code theme`.
- Do NOT push or open a PR unless the operator told you to.

## Steps

### Step 1: Add the pure theme picker

Create `webview/theme.js`:

```js
const LIGHT_KINDS = ["vscode-light", "vscode-high-contrast-light"];

export function mermaidThemeFor(classList) {
  return LIGHT_KINDS.some((kind) => classList.contains(kind)) ? "default" : "dark";
}
```

It takes anything with a `.contains(name)` method (a DOM `classList`, or a `Set` in tests). Anything unrecognised falls back to `"dark"`, which is today's behaviour.

**Verify**: `npm run lint` → exit 0.

### Step 2: Unit-test it

Create `test/unit/theme.test.mjs`, following the structure of the other files in `test/unit/` (`node:test` + `node:assert/strict`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mermaidThemeFor } from "../../webview/theme.js";

const kinds = (...names) => new Set(names);
```

Cases:
- `vscode-light` → `"default"`
- `vscode-high-contrast-light` → `"default"`
- `vscode-dark` → `"dark"`
- `vscode-high-contrast` → `"dark"`
- no theme class (empty set) → `"dark"`

**Verify**: `npm run test:unit` → all pass, including the 5 new tests.

### Step 3: Make `render.js` theme-aware

Rewrite `webview/render.js` so that:
- The module-level `mermaid.initialize` call and the hard-coded `themeVariables` block are removed.
- It keeps a module-level `let currentTheme;`.
- `renderDiagram(code, theme)` takes the theme name. If `theme !== currentTheme`, it calls `mermaid.initialize({ startOnLoad: false, theme })` and sets `currentTheme = theme`. Then it renders as before.
- Leave the `flowchart-${Date.now()}` render ID unchanged.

**Verify**: `npm run lint` → exit 0, and `grep -n "themeVariables\|#222222" webview/render.js` → no matches.

### Step 4: Pass the theme from `main.js` and re-render on theme change

In `webview/main.js`:
- `import { mermaidThemeFor } from "./theme.js";`
- In `renderCurrentCode`, change `await renderDiagram(diagram)` to `await renderDiagram(diagram, mermaidThemeFor(document.body.classList))`.
- Below the existing `modeSelector.addEventListener("change", …)` block, add:

```js
new MutationObserver(() => {
  if (currentCode) {
    renderCurrentCode();
  }
}).observe(document.body, { attributes: true, attributeFilter: ["class"] });
```

The `currentCode` guard stops the observer from rendering an empty diagram over the "Open a Python file…" message. Don't change the `renderRevision` / `typingTimer` logic. `renderCurrentCode` already discards stale renders.

**Verify**: `npm run lint` → exit 0, and `npm run build:webview` → exit 0.

### Step 5: Manual check in the Extension Development Host

You need a desktop session for this. If you have none, report "manual check not run".

1. In VS Code, open the repo and press F5 (the `.vscode/launch.json` "Run Extension" config).
2. In the dev host, open any `.py` file with a couple of functions. Run the command whose title is in `package.json` → `contributes.commands[0].title` from the Command Palette.
3. Choose `Preferences: Color Theme` → `Light+`. The diagram should have light boxes and dark text.
4. Switch to `Dark+`. The diagram should re-render with dark boxes, without reopening the panel.
5. Switch to `Light High Contrast` (light) and `Dark High Contrast` (dark). Both stay readable.

**Verify**: all 4 checks look as described. Record the result in your report.

### Step 6: Full gate

**Verify**:
- `npm run test:unit` → exit 0
- `npm run lint` → exit 0
- `npm run build:webview` → exit 0
- `npm test` → exit 0 (or "skipped: no desktop session")
- `git status --short` → only the 4 in-scope paths

## Test plan

- New: `test/unit/theme.test.mjs` with the 5 cases from Step 2. Model it on any existing file in `test/unit/`.
- The Mermaid/DOM integration is checked manually (Step 5). There is no automated webview DOM test harness in this repo, and building one is out of scope.

## Done criteria

- [ ] `webview/theme.js` exists and exports `mermaidThemeFor`
- [ ] `npm run test:unit` exits 0, and the 5 theme tests exist and pass
- [ ] `grep -n "themeVariables" webview/render.js` → no matches
- [ ] `grep -n "MutationObserver" webview/main.js` → 1 match
- [ ] `npm run lint` and `npm run build:webview` exit 0
- [ ] `git status --short` shows only in-scope files
- [ ] Manual check result (pass, or "not run: no desktop") stated in your report
- [ ] `plans/README.md` status row for 007 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `npm run test:unit` isn't defined (plan 003 hasn't landed). Either branch from it or stop.
- `webview/render.js` doesn't match the excerpt above.
- During the manual check, re-calling `mermaid.initialize` with a new theme does **not** change the next render. Don't switch to hacks like reloading the webview; report it.
- The CSP blocks Mermaid output (the console shows CSP violations) after your change. The plan assumes no CSP change is needed.

## Maintenance notes

- If someone wants the diagram to match the editor's exact colours, the extension point is `renderDiagram`'s initialize call. Read `getComputedStyle(document.body).getPropertyValue("--vscode-editor-foreground")` and similar, and pass `theme: "base"` with matching `themeVariables`. That was deliberately deferred: built-in themes are readable and much less code.
- `webview/theme.js` is DOM-free on purpose so Node can unit-test it. Keep it that way.
- Reviewer focus: the observer must not cause render loops. It only watches `body`'s `class` attribute, and Mermaid doesn't modify that.
