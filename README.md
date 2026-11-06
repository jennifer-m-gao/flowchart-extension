# PyChart for VS Code

An extension for VSCode that creates flowcharts for Python functions as a webview on the user's right-side window.

## Features

- Real-time parsing: automatically analyzes active Python file and extracts control structures (if/elif/else, for/while loops, function definitions, and returns)
- Interactive webview: renders clean responsive Mermaid.js flowcharts directly within VSCode

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
- `npm run build:webview` bundles the webview (parser + Mermaid renderer) into `dist/webview/bundle.js`. This file is generated and not committed; `vsce package` rebuilds it automatically via `vscode:prepublish`.
- `npm test` builds, lints, and runs the extension integration tests in a downloaded VS Code instance.
