# Flowchart Visualizer for VS Code

Generate flowcharts from the Python file open in VS Code. The visualizer updates as you edit the file and offers two views:

- **Functions** shows function call relationships.
- **Timeline** shows Python statements in source order.
- The diagram updates from the active Python editor; no separate text-entry panel is needed.

Run **Flowchart: Open Visualizer** from the Command Palette to open the diagram beside the editor. Select a Python file and edit it to refresh the diagram.

## Development

The webview JavaScript bundle is generated into `dist/webview/` so it stays separate from the editable webview source:

- Run `npm install` to install dependencies.
- Run `npm run build:webview` to bundle the parser and diagram renderer.
- Run `npm test` to build, lint, and run the extension tests.
