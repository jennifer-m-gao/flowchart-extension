# PyChart for VS Code

An extension for VSCode that creates flowcharts for Python functions as a webview on the user's right-side window.

## Features

- **Flow view**: an interactive control-flow graph of the function under your cursor: decisions, loops and `break`/`continue`/`return` drawn where control really goes.
- **Follows your cursor**: move into another function and the diagram follows. A "Whole file" toggle shows module-level flow.
- **Click to jump**: click any box to select its code. The box for your cursor's line is highlighted.
- **Pan and zoom**: drag, Ctrl+wheel or pinch, and Fit.
- **Functions view**: a call graph of the file's functions.

## Installation

1. Open Visual Studio Code
2. Go to the Extensions view
3. Search for PyChart
4. Click Install

## Usage

1. Run **PyChart: Open Visualizer** from the Command Palette to open the diagram beside the editor
2. Select a Python file and edit it to refresh the diagram

## Requirements

- Visual Studio Code 1.140.0 or higher

### 1.0.0

Initial release of PyChart

## Development

- `npm install` installs dependencies.
- `npm run build:webview` bundles the webview (parser + ELK layout + SVG renderer) into `dist/webview/bundle.js`. This file is generated and not committed; `vsce package` rebuilds it automatically via `vscode:prepublish`.
- `npm run test:unit` runs the unit tests.
- `npm run test:coverage` runs them and fails below 90% line coverage on `webview/cfg`.
- `npm run bench` times a 200-line function's re-render pipeline and fails if the median is 300 ms or more.
- `npm run check:bundle` fails if `dist/webview/bundle.js` is 3.4 MiB or larger.
- `npm test` runs the gates above, builds, lints, and runs the extension integration tests in a downloaded VS Code instance.
