import { functionGraph } from "./functionParser.js";
import { parseCode } from "./parser.js";
import { renderDiagram } from "./render.js";
import { renderGraph } from "./render/renderGraph.js";
import { parser } from "@lezer/python";

const vscode = acquireVsCodeApi();
const display = document.getElementById("display");
const modeSelector = document.getElementById("diagram-mode");
const timeTrack = document.getElementById("time-track");

const savedState = vscode.getState();
if (savedState?.mode) {
  modeSelector.value = savedState.mode;
  if (modeSelector.value === "") {
    modeSelector.value = "functions";
  }
}
let diagramMode = modeSelector.value;
let currentCode = "";
let updateCount = 0;
let renderRevision = 0;
let typingTimer;

modeSelector.addEventListener("change", () => {
  diagramMode = modeSelector.value;
  vscode.setState({ mode: diagramMode });
  renderCurrentCode();
});

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "setCode") {
    currentCode = message.code;
    renderRevision++;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(renderCurrentCode, 100);
  } else if (message.type === "setMessage") {
    clearTimeout(typingTimer);
    renderRevision++;
    display.textContent = message.text;
  }
});

async function renderCurrentCode() {
  const revision = ++renderRevision;

  try {
    const tree = parser.parse(currentCode);
    const svg = diagramMode === "functions"
      ? await renderGraph(functionGraph(tree, currentCode))
      : await renderDiagram(parseCode(tree, currentCode));

    if (revision !== renderRevision) {
      return;
    }

    display.setAttribute("role", "img");
    display.setAttribute("aria-label", `${diagramMode} flowchart`);
    display.innerHTML = svg;
    updateCount++;
    timeTrack.textContent = String(updateCount);
  } catch (error) {
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
