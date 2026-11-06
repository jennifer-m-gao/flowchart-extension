# Change Log

All notable changes to the "flowchart-extension" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.1.0]

- Flow view: an interactive control-flow graph of the function under the cursor.
- Follows the cursor between functions; "Whole file" toggle for module-level flow.
- Click a box to select its code; the box for the cursor's line is highlighted.
- Pan and zoom: scroll to move, Ctrl+wheel or pinch to zoom, Fit button, +/−/0 keys.
- Loop back-edges from an if's False branch are labelled "False".
- Functions view: a call graph of the file's functions.
- Replaced Mermaid with an ELK layout + custom SVG renderer (bundle 3,547,257 -> 1,570,933 bytes).
- Release gates in `pretest`: bundle size, 200-line re-render median (see `npm run bench`) and line coverage of the control-flow builder.

## [1.0.1]

- Fix "command not found" when running the visualizer command (manifest and code used different command IDs).

## [Unreleased]

- Initial release