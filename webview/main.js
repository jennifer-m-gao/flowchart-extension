import { parseFunctions } from "./functionParser.js";
import { parseCode } from "./parser.js";
import { renderDiagram } from "./render.js";
import { parser } from "@lezer/python";

const vscode = acquireVsCodeApi();
const display = document.getElementById("display");
const modeSelector = document.getElementById("diagram-mode");
const timeTrack = document.getElementById("time-track");

let diagramMode = modeSelector.value;
let currentCode = "";
let updateCount = 0;
let renderRevision = 0;
let typingTimer;

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
    const diagram = diagramMode === "functions"
      ? parseFunctions(tree, currentCode)
      : parseCode(tree, currentCode);
    const svg = await renderDiagram(diagram);

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
