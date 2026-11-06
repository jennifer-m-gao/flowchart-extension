import { functionGraph } from "./functionParser.js";
import { buildCfg } from "./cfg/buildCfg.js";
import { findScope } from "./cfg/findScope.js";
import { renderGraph } from "./render/renderGraph.js";
import { createViewStack } from "./viewStack.js";
import { mergeState, migrateMode, renderAction, scopeKey } from "./viewState.js";
import { nodeAtOffset } from "./interact/nodeAtOffset.js";
import { revealRange } from "./interact/revealRange.js";
import { fit, identity, panBy, toTransform, zoomAt } from "./interact/viewport.js";
import { parser } from "@lezer/python";

const vscode = acquireVsCodeApi();
const display = document.getElementById("display");
const modeSelector = document.getElementById("diagram-mode");
const wholeFile = document.getElementById("whole-file");
const hideBuiltins = document.getElementById("hide-builtins");
const scopeTitle = document.getElementById("scope-title");
const timeTrack = document.getElementById("time-track");
const fitButton = document.getElementById("fit-view");

// setState replaces everything: always merge, or one setting wipes the others.
const saveState = (patch) => vscode.setState(mergeState(vscode.getState(), patch));
const saved = vscode.getState() || {};
modeSelector.value = migrateMode(saved.mode);
wholeFile.checked = !!saved.wholeFile;
// On by default: learners care about their own functions, and built-ins dominate small scripts.
hideBuiltins.checked = saved.hideBuiltins ?? true;
wholeFile.disabled = modeSelector.value === "functions";
hideBuiltins.disabled = modeSelector.value !== "functions";

const viewFromControls = () => modeSelector.value === "functions"
  ? { kind: "functions" }
  : { kind: "flow", follow: !wholeFile.checked };

const views = createViewStack(viewFromControls());
let currentCode = "";
let cursorOffset = 0;
let cachedTree;
let cachedTreeCode;
let lastRendered = null;
let inFlight = null; // `next` of the render currently awaiting layout
let currentGraph = null;
let updateCount = 0;
let renderRevision = 0;
let typingTimer;
let lastHighlightMs = 0;

// Pan/zoom state for the rendered svg's .cfg-root.
let root = null;
let contentW = 0;
let contentH = 0;
let viewport = identity();
let fittedKey = null;
let userMoved = false;
let drag = null;
let dragged = false;

function cancelRender() {
  renderRevision++;
  inFlight = null;
}

function onControlChange() {
  wholeFile.disabled = modeSelector.value === "functions";
  hideBuiltins.disabled = modeSelector.value !== "functions";
  saveState({ mode: modeSelector.value, wholeFile: wholeFile.checked, hideBuiltins: hideBuiltins.checked });
  views.replace(viewFromControls());
  lastRendered = null;
  update();
}
modeSelector.addEventListener("change", onControlChange);
wholeFile.addEventListener("change", onControlChange);
hideBuiltins.addEventListener("change", onControlChange);

window.addEventListener("message", (event) => {
  const message = event.data;
  if (message.type === "setCode") {
    currentCode = message.code;
    cursorOffset = message.offset ?? 0;
    cancelRender();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      typingTimer = undefined;
      update();
    }, 50);
  } else if (message.type === "setCursor") {
    cursorOffset = message.offset;
    // While a setCode is pending the offset belongs to the new text; the pending update() will use it.
    if (typingTimer === undefined) {
      update();
    }
  } else if (message.type === "setMessage") {
    clearTimeout(typingTimer);
    typingTimer = undefined;
    cancelRender();
    lastRendered = null;
    currentGraph = null;
    root = null;
    fittedKey = null;
    display.textContent = message.text;
  }
});

function highlight() {
  const t0 = performance.now();
  const id = currentGraph && nodeAtOffset(currentGraph.nodes, cursorOffset, currentCode);
  display.querySelector(".cfg-node.is-current")?.classList.remove("is-current");
  if (id) {
    display.querySelector(`.cfg-node[data-id="${CSS.escape(id)}"]`)?.classList.add("is-current");
  }
  lastHighlightMs = performance.now() - t0;
  console.debug(`PyChart highlight: ${lastHighlightMs.toFixed(3)} ms`);
}

async function update() {
  const view = views.current();
  let revision;

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
      const hide = hideBuiltins.checked;
      next = { code, viewKind: "functions", follow: false, scopeKey: "", fitKey: `functions:${hide}` };
      graph = () => functionGraph(tree, code, { hideBuiltins: hide });
      scopeTitle.textContent = "";
    } else {
      const scope = view.follow
        ? findScope(tree, code, cursorOffset)
        : { node: tree.topNode, kind: "module", name: "<module>", qualifiedName: "<module>" };
      // fitKey ignores the scope's offsets so typing inside a function keeps the zoom.
      next = { code, viewKind: "flow", follow: view.follow, scopeKey: scopeKey(scope), fitKey: `flow:${view.follow}:${scope.kind}:${scope.qualifiedName}` };
      graph = () => buildCfg(scope.node, code);
      scopeTitle.textContent = (scope.qualifiedName === "<module>" ? "Module" : scope.qualifiedName)
        + (view.follow ? "" : " (whole file)");
    }

    // Claim a revision only when a render starts, so cursor moves never cancel a useful render.
    const action = renderAction(lastRendered, inFlight, next);
    if (action === "wait") {
      return; // the render in flight already produces this view; it highlights when done
    }
    if (action !== "render") {
      if (action === "cancel-and-highlight") {
        cancelRender(); // it targets a scope no longer wanted; what is shown is already right
      }
      highlight();
      return;
    }

    revision = ++renderRevision;
    inFlight = next;
    const built = graph();
    const svg = await renderGraph(built);

    if (revision !== renderRevision) {
      return;
    }
    inFlight = null;

    display.setAttribute("role", "img");
    display.setAttribute("aria-label", `${view.kind} flowchart`);
    display.innerHTML = svg;
    mountSvg(next.fitKey);
    currentGraph = built;
    lastRendered = next;
    highlight();
    updateCount++;
    timeTrack.textContent = String(updateCount);
  } catch (error) {
    lastRendered = null;
    if (revision === undefined) {
      cancelRender(); // failed before rendering: drop any older render too
    } else if (revision !== renderRevision) {
      return;
    }
    inFlight = null;
    currentGraph = null;
    root = null;

    display.removeAttribute("aria-label");
    display.setAttribute("role", "status");
    display.textContent = `Unable to render diagram: ${error.message}`;
    console.error("Flowchart rendering failed:", error);
  }
}

// Let CSS size the svg and place the graph with the view transform instead of the viewBox.
function mountSvg(fitKey) {
  const svg = display.querySelector("svg.cfg");
  const box = svg.viewBox.baseVal;
  // toSvg pads the viewBox by 16 on each side around .cfg-root.
  contentW = Math.max(0, box.width - 32);
  contentH = Math.max(0, box.height - 32);
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.removeAttribute("viewBox");
  root = svg.querySelector(".cfg-root");
  if (fitKey !== fittedKey) {
    fittedKey = fitKey;
    fitView();
  } else {
    applyView();
  }
}

function applyView() {
  root?.setAttribute("transform", toTransform(viewport));
}

function fitView() {
  viewport = fit(contentW, contentH, display.clientWidth, display.clientHeight);
  userMoved = false;
  applyView();
}

function moveView(next) {
  viewport = next;
  userMoved = true;
  applyView();
}

function reveal(node) {
  vscode.postMessage({ type: "reveal", ...revealRange(currentCode, +node.dataset.from, +node.dataset.to) });
}

display.addEventListener("click", (event) => {
  const node = !dragged && event.target.closest?.(".cfg-node[data-from]");
  if (node) {
    reveal(node);
  }
});

display.addEventListener("wheel", (event) => {
  if (!root) {
    return;
  }
  event.preventDefault();
  if (event.ctrlKey) {
    const rect = display.getBoundingClientRect();
    moveView(zoomAt(viewport, Math.exp(-event.deltaY * 0.01), event.clientX - rect.left, event.clientY - rect.top));
  } else {
    moveView(panBy(viewport, -event.deltaX, -event.deltaY));
  }
}, { passive: false });

display.addEventListener("pointerdown", (event) => {
  dragged = false;
  if (event.button !== 0 || !root) {
    return;
  }
  drag = { x: event.clientX, y: event.clientY, moved: 0 };
});

display.addEventListener("pointermove", (event) => {
  if (!drag) {
    return;
  }
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (!dragged && drag.moved > 4) {
    dragged = true;
    // Capture only once it is a drag: capturing on pointerdown would retarget the click away from the node.
    display.setPointerCapture(event.pointerId);
  }
  moveView(panBy(viewport, dx, dy));
});

const endDrag = () => {
  drag = null;
};
display.addEventListener("pointerup", endDrag);
display.addEventListener("pointercancel", endDrag);

fitButton.addEventListener("click", () => {
  if (root) {
    fitView();
  }
});

document.addEventListener("keydown", (event) => {
  const target = event.target;
  const node = target.closest?.(".cfg-node[data-from]");
  if (node && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    reveal(node);
    return;
  }
  if (!root || target.closest?.("select, input") || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  const cx = display.clientWidth / 2;
  const cy = display.clientHeight / 2;
  if (event.key === "+" || event.key === "=") {
    moveView(zoomAt(viewport, 1.2, cx, cy));
  } else if (event.key === "-") {
    moveView(zoomAt(viewport, 1 / 1.2, cx, cy));
  } else if (event.key === "0") {
    fitView();
  } else {
    return;
  }
  event.preventDefault();
});

window.addEventListener("resize", () => {
  if (root && !userMoved) {
    fitView();
  }
});

vscode.postMessage({ type: "ready" });
