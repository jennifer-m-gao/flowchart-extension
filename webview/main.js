import { functionGraph } from "./functionParser.js";
import { buildCfg } from "./cfg/buildCfg.js";
import { findScope } from "./cfg/findScope.js";
import { renderGraph } from "./render/renderGraph.js";
import { createViewStack } from "./viewStack.js";
import { migrateMode, scopeKey, shouldRender } from "./viewState.js";
import { parser } from "@lezer/python";

const vscode = acquireVsCodeApi();
const display = document.getElementById("display");
const modeSelector = document.getElementById("diagram-mode");
const wholeFile = document.getElementById("whole-file");
const scopeTitle = document.getElementById("scope-title");
const timeTrack = document.getElementById("time-track");

const saved = vscode.getState() || {};
modeSelector.value = migrateMode(saved.mode);
wholeFile.checked = !!saved.wholeFile;
wholeFile.disabled = modeSelector.value === "functions";

const viewFromControls = () => modeSelector.value === "functions"
  ? { kind: "functions" }
  : { kind: "flow", follow: !wholeFile.checked };

const views = createViewStack(viewFromControls());
let currentCode = "";
let cursorOffset = 0;
let cachedTree;
let cachedTreeCode;
let lastRendered = null;
let updateCount = 0;
let renderRevision = 0;
let typingTimer;

function onControlChange() {
  wholeFile.disabled = modeSelector.value === "functions";
  vscode.setState({ mode: modeSelector.value, wholeFile: wholeFile.checked });
  views.replace(viewFromControls());
  lastRendered = null;
  update();
}
modeSelector.addEventListener("change", onControlChange);
wholeFile.addEventListener("change", onControlChange);

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "setCode") {
    currentCode = message.code;
    cursorOffset = message.offset ?? 0;
    renderRevision++;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(update, 50);
  } else if (message.type === "setCursor") {
    cursorOffset = message.offset;
    update();
  } else if (message.type === "setMessage") {
    clearTimeout(typingTimer);
    renderRevision++;
    lastRendered = null;
    display.textContent = message.text;
  }
});

async function update() {
  const revision = ++renderRevision;
  const view = views.current();

  try {
    if (cachedTreeCode !== currentCode) {
      cachedTree = parser.parse(currentCode);
      cachedTreeCode = currentCode;
    }
    const tree = cachedTree;
    const code = currentCode;
    let next;
    let graph;

    if (view.kind === "functions") {
      next = { code, viewKind: "functions", follow: false, scopeKey: "" };
      graph = () => functionGraph(tree, code);
      scopeTitle.textContent = "";
    } else {
      const scope = view.follow
        ? findScope(tree, code, cursorOffset)
        : { node: tree.topNode, kind: "module", name: "<module>", qualifiedName: "<module>" };
      next = { code, viewKind: "flow", follow: view.follow, scopeKey: scopeKey(scope) };
      graph = () => buildCfg(scope.node, code);
      scopeTitle.textContent = (scope.qualifiedName === "<module>" ? "Module" : scope.qualifiedName)
        + (view.follow ? "" : " (whole file)");
    }

    if (!shouldRender(lastRendered, next)) {
      return;
    }

    const svg = await renderGraph(graph());

    if (revision !== renderRevision) {
      return;
    }

    display.setAttribute("role", "img");
    display.setAttribute("aria-label", `${view.kind} flowchart`);
    display.innerHTML = svg;
    lastRendered = next;
    updateCount++;
    timeTrack.textContent = String(updateCount);
  } catch (error) {
    lastRendered = null;
    if (revision !== renderRevision) {
      return;
    }

    display.removeAttribute("aria-label");
    display.setAttribute("role", "status");
    display.textContent = `Unable to render diagram: ${error.message}`;
    console.error("Flowchart rendering failed:", error);
  }
}

vscode.postMessage({ type: "ready" });
