# PyChart for VS Code

See what your Python code actually does. PyChart draws the function under your cursor as an interactive flowchart beside the editor, and **▶ Run** replays a real run of your program on it, step by step.

## Features

- **▶ Run and replay** (Ctrl+Enter): PyChart runs the file with your selected Python interpreter, then replays the run on the flowchart.
  - The current box glows, visited boxes are marked, and loops show how many times each box ran.
  - Play, pause, step, change speed or drag the scrubber. The replay follows calls into other functions.
  - The variables and printed output are shown for every step; changed values are highlighted.
- **Flow view**: the control flow of the function under your cursor: decisions, loops and `break` / `continue` / `return` drawn where control really goes.
- **Follows your cursor**: move into another function and the diagram follows. "Whole file" shows module-level flow.
- **Click to jump**: click a box to select its code. The box for your cursor's line is highlighted.
- **Pan and zoom**: drag, Ctrl+wheel or pinch, and Fit. Press `?` for every mouse and keyboard control.
- **Functions view**: a call graph of the file's functions, with built-ins hidden by default.

## Usage

1. Open a Python file.
2. Run **PyChart: Open Visualizer** from the Command Palette. The diagram opens beside the editor and updates as you type.
3. Click **▶ Run** (or press Ctrl+Enter in the diagram) to run the file and replay it. Editing the code ends the replay.

## Requirements

- Visual Studio Code 1.140.0 or higher
- For ▶ Run: Python 3 (the interpreter selected in the Python extension, or `python` on your PATH)

## Known limits

- ▶ Run stops after 10,000 steps or 10 seconds and shows the steps up to there.
- Programs that call `input()` can't be run yet.
- Python only.

## Development

- `npm install` installs dependencies.
- `npm run build:webview` bundles the webview (parser + ELK layout + SVG renderer) into `dist/webview/bundle.js`. This file is generated and not committed; `vsce package` rebuilds it automatically via `vscode:prepublish`.
- `npm run test:unit` runs the unit tests.
- `npm run test:coverage` runs them and fails below 90% line coverage on `webview/cfg` and `webview/run`.
- `npm run bench` times a 200-line function's re-render pipeline and fails if the median is 300 ms or more.
- `npm run check:bundle` fails if `dist/webview/bundle.js` is 2,000,000 bytes or larger.
- `npm run test:ui` runs the webview in headless Chrome/Edge (found automatically, or set `CHROME=<path>`), under the real CSP, and checks pan/zoom, click-to-source, cursor highlight, follow-cursor, Functions mode, themes and Run/replay. Run it before every release. Screenshots land in `test/ui/shots/`.
- `npm test` runs the gates above, builds, lints, and runs the extension integration tests in a downloaded VS Code instance.
