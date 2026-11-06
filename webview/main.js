import { functionGraph } from "./functionParser.js";
import { buildCfg } from "./cfg/buildCfg.js";
import { findScope } from "./cfg/findScope.js";
import { renderGraph } from "./render/renderGraph.js";
import { createViewStack } from "./viewStack.js";
import { mergeState, migrateMode, renderAction, scopeKey, shouldShowTip } from "./viewState.js";
import { nodeAtOffset } from "./interact/nodeAtOffset.js";
import { revealRange } from "./interact/revealRange.js";
import { fit, identity, panBy, toTransform, zoomAt } from "./interact/viewport.js";
import { listScopes } from "./run/scopes.js";
import { createPlayer, frameAt, loadTrace } from "./run/player.js";
import { parser } from "@lezer/python";

const vscode = acquireVsCodeApi();
const display = document.getElementById("display");
const modeSelector = document.getElementById("diagram-mode");
const wholeFile = document.getElementById("whole-file");
const hideBuiltins = document.getElementById("hide-builtins");
const scopeTitle = document.getElementById("scope-title");
const timeTrack = document.getElementById("time-track");
const fitButton = document.getElementById("fit-view");
const helpButton = document.getElementById("help-button");
const helpDialog = document.getElementById("help-dialog");
const helpClose = document.getElementById("help-close");
const tipBanner = document.getElementById("tip-banner");
const tipDismiss = document.getElementById("tip-dismiss");
const runButton = document.getElementById("run");
const runBanner = document.getElementById("run-banner");
const runBar = document.getElementById("run-bar");
const runPrev = document.getElementById("run-prev");
const runPlay = document.getElementById("run-play");
const runNext = document.getElementById("run-next");
const runSpeed = document.getElementById("run-speed");
const runScrub = document.getElementById("run-scrub");
const runPos = document.getElementById("run-pos");
const runStop = document.getElementById("run-stop");
const runVars = document.getElementById("run-vars");
const runOutput = document.getElementById("run-output");
const runOutputText = runOutput.querySelector("pre");
const CODE_CHANGED = "Code changed \u2014 \u25B6 Run to trace again";

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

// Run & replay (D19-D23). Replay draws its own svg per scope; update() is not called while in replay.
let mode = "live"; // "live" | "running" | "replay"
let runCode = null; // the code when Run was pressed
let loaded = null;
let player = null;
let replayGraph = null; // scopeKey -> graph, memoised per trace
let playTimer;
let stepToken = 0;
let shownScope = null; // layoutCache key of the mounted replay svg
let stepNodes = new Map(); // node id -> { g, title, hint, titleText, badge, badgeText }
let lastStepMs = 0;
const layoutCache = new Map(); // runCode + "\u0000" + scopeKey -> { graph, svg, ready, view }

function cancelRender() {
  renderRevision++;
  inFlight = null;
}

function onControlChange() {
  if (mode === "replay") {
    exitReplay();
  }
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
    if (mode === "replay") {
      if (currentCode === runCode) {
        highlight(); // the same text again (e.g. the save before the run): keep replaying
        return;
      }
      exitReplay(CODE_CHANGED);
    }
    cancelRender();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      typingTimer = undefined;
      update();
    }, 50);
  } else if (message.type === "setCursor") {
    cursorOffset = message.offset;
    if (mode === "replay") {
      highlight(); // replay keeps its scope; the cursor box may still show
    } else if (typingTimer === undefined) {
      // While a setCode is pending the offset belongs to the new text; the pending update() will use it.
      update();
    }
  } else if (message.type === "tipState") {
    tipBanner.hidden = !shouldShowTip(vscode.getState(), message.dismissed);
  } else if (message.type === "runStatus") {
    if (message.state === "error") {
      if (mode === "running") {
        mode = "live";
      }
      runButton.disabled = false;
      showBanner(message.message || "The run failed.");
    } else if (message.state === "done") {
      runButton.disabled = false;
    }
  } else if (message.type === "trace") {
    onTrace(message.trace);
  } else if (message.type === "setMessage") {
    if (mode === "replay") {
      exitReplay();
    }
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

function showBanner(text) {
  runBanner.textContent = text;
  runBanner.hidden = !text;
}

function startRun() {
  if (mode === "running") {
    return;
  }
  if (mode === "replay") {
    exitReplay();
    update();
  }
  runCode = currentCode;
  mode = "running";
  runButton.disabled = true;
  showBanner("Running\u2026");
  vscode.postMessage({ type: "run" });
}

const REASONS = {
  limit: (l) => `Stopped after ${(l.limits?.steps ?? 10000).toLocaleString("en-US")} steps (or ${l.limits?.seconds ?? 10} s)`,
  "input-not-supported": () => "input() isn't supported yet",
  exception: (l) => `${l.exception?.type}: ${l.exception?.message}${l.exception?.line != null ? ` (line ${l.exception.line})` : ""}`,
  exit: (l) => `Program exited (code ${l.exitCode})`,
};

function onTrace(trace) {
  runButton.disabled = false;
  if (mode !== "running") {
    return; // no Run pending (D19)
  }
  mode = "live";
  if (currentCode !== runCode) {
    showBanner(CODE_CHANGED);
    return;
  }
  const tree = cachedTreeCode === runCode ? cachedTree : parser.parse(runCode);
  const scopes = listScopes(tree, runCode);
  const graphs = new Map();
  replayGraph = (key) => graphs.get(key) || graphs.set(key, buildCfg(scopes.get(key).node, runCode)).get(key);
  loaded = loadTrace(trace, { scopes, graphFor: replayGraph, code: runCode });
  if (!loaded.total) {
    loaded = null;
    showBanner("Nothing ran.");
    return;
  }
  for (const key of layoutCache.keys()) {
    if (!key.startsWith(`${runCode}\u0000`)) {
      layoutCache.delete(key);
    }
  }
  player = createPlayer(loaded);
  player.setSpeed(runSpeed.value);
  mode = "replay";
  clearTimeout(typingTimer);
  typingTimer = undefined;
  cancelRender(); // a live render finishing now would replace the replay svg
  lastRendered = null;
  shownScope = null;
  runScrub.max = String(loaded.total - 1);
  runBar.hidden = false;
  runVars.hidden = false;
  runOutput.hidden = false;
  syncPlay();
  showBanner(REASONS[loaded.reason]?.(loaded) ?? "");
  showStep(0);
}

// Back to live mode. Callers re-render with update() (or let the pending setCode do it).
function exitReplay(note = "") {
  clearTimeout(playTimer);
  playTimer = undefined;
  stepToken++; // drops a layout still in flight
  mode = "live";
  loaded = null;
  player = null;
  shownScope = null;
  stepNodes = new Map();
  lastRendered = null;
  runBar.hidden = true;
  runVars.hidden = true;
  runOutput.hidden = true;
  for (const g of display.querySelectorAll(".is-step, .is-visited")) {
    g.classList.remove("is-step", "is-visited");
  }
  for (const badge of display.querySelectorAll(".cfg-badge")) {
    badge.remove();
  }
  showBanner(note);
}

// Hot path (D23 < 16 ms): same-scope steps only toggle classes and text, never lay out.
async function showStep(i) {
  const token = ++stepToken;
  const t0 = performance.now();
  const index = player.seek(i);
  runScrub.value = String(index);
  runPos.textContent = `${index + 1} / ${loaded.total}`;
  const f = frameAt(loaded, index);
  const key = `${runCode}\u0000${f.scopeKey}`;
  let kind = "same";
  try {
    if (key !== shownScope) {
      let entry = layoutCache.get(key);
      kind = entry?.svg ? "switch" : "layout";
      if (!entry) {
        const graph = replayGraph(f.scopeKey);
        entry = { graph, svg: null, view: null };
        entry.ready = renderGraph(graph).then((svg) => {
          entry.svg = svg;
        });
        layoutCache.set(key, entry);
      }
      if (!entry.svg) {
        await entry.ready;
        if (token !== stepToken) {
          return; // a later step (or leaving replay) took over
        }
      }
      mountReplay(key, entry);
    }
  } catch (error) {
    layoutCache.delete(key);
    showBanner(`Unable to render diagram: ${error.message}`);
    console.error("Replay rendering failed:", error);
    return;
  }
  paintStep(f);
  lastStepMs = performance.now() - t0;
  window.__lastStepMs = lastStepMs;
  window.__lastStep = { index, kind };
  console.debug(`PyChart step ${index} (${kind}): ${lastStepMs.toFixed(3)} ms`);
}

function mountReplay(key, entry) {
  const prev = layoutCache.get(shownScope);
  if (prev) {
    prev.view = { viewport, userMoved };
  }
  display.setAttribute("role", "img");
  display.setAttribute("aria-label", "flow flowchart (replay)");
  display.innerHTML = entry.svg;
  if (entry.view) {
    ({ viewport, userMoved } = entry.view);
  }
  fittedKey = entry.view ? key : null; // fit only the first time this scope is shown
  mountSvg(key);
  shownScope = key;
  currentGraph = entry.graph;
  stepNodes = new Map();
  for (const g of display.querySelectorAll(".cfg-node[data-id]")) {
    const title = g.querySelector("title");
    stepNodes.set(g.dataset.id, { g, title, hint: title.textContent, titleText: title.textContent, badge: null, badgeText: "" });
  }
  highlight();
}

const formatLocals = (locals) => Object.entries(locals).map(([name, value]) => `${name} = ${value}`).join("\n");

function paintStep(f) {
  for (const [id, n] of stepNodes) {
    const count = f.visits.get(id) || 0;
    n.g.classList.toggle("is-visited", count > 0);
    n.g.classList.toggle("is-step", id === f.nodeId);
    const badgeText = count >= 2 ? String(count) : "";
    if (badgeText !== n.badgeText) {
      if (!n.badge) {
        // Created once per node and reused; sits just above the box's top-right corner.
        const box = n.g.querySelector("rect, polygon").getBBox();
        n.badge = document.createElementNS("http://www.w3.org/2000/svg", "text");
        n.badge.setAttribute("class", "cfg-badge");
        n.badge.setAttribute("x", String(box.x + box.width));
        n.badge.setAttribute("y", String(box.y - 3));
        n.badge.setAttribute("text-anchor", "end");
        n.g.append(n.badge);
      }
      n.badge.textContent = badgeText;
      n.badgeText = badgeText;
    }
    const seen = count ? f.lastSeen.get(id) : null;
    const titleText = seen && Object.keys(seen).length ? `${n.hint}\nLast time here:\n${formatLocals(seen)}` : n.hint;
    if (titleText !== n.titleText) {
      n.title.textContent = titleText;
      n.titleText = titleText;
    }
  }

  const { k, of } = f.callOrdinal;
  scopeTitle.textContent = f.chain.join(" \u203A ") + (of > 1 ? ` (call ${k}/${of})` : "");

  const vars = Object.entries(f.locals).map(([name, value]) => {
    const item = document.createElement("span");
    const change = f.changed[name];
    if (change) {
      item.className = "run-changed";
    }
    item.textContent = change && change[0] !== undefined ? `${name}: ${change[0]} \u2192 ${value}` : `${name}: ${value}`;
    return item;
  });
  runVars.replaceChildren(...(vars.length ? vars : ["(no variables)"]));

  if (runOutputText.textContent.length !== f.outputText.length) {
    runOutputText.textContent = f.outputText; // always a prefix of the same text, so the length says if it changed
    runOutputText.scrollTop = runOutputText.scrollHeight;
  }
}

function syncPlay() {
  const playing = !!player?.playing;
  runPlay.textContent = playing ? "\u23F8" : "\u25B6";
  runPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
}

function tick() {
  playTimer = undefined;
  if (!player?.playing) {
    return;
  }
  showStep(player.next());
  syncPlay();
  if (player.playing) {
    playTimer = setTimeout(tick, 1000 / player.speed);
  }
}

function setPlaying(on) {
  clearTimeout(playTimer);
  playTimer = undefined;
  const before = player.index;
  if (on) {
    player.play();
  } else {
    player.pause();
  }
  if (player.index !== before) {
    showStep(player.index); // play at the end starts over
  }
  if (player.playing) {
    playTimer = setTimeout(tick, 1000 / player.speed);
  }
  syncPlay();
}

function stepBy(move) {
  setPlaying(false);
  showStep(move());
}

runButton.addEventListener("click", startRun);
runPlay.addEventListener("click", () => player && setPlaying(!player.playing));
runPrev.addEventListener("click", () => player && stepBy(() => player.prev()));
runNext.addEventListener("click", () => player && stepBy(() => player.next()));
runScrub.addEventListener("input", () => player && stepBy(() => player.seek(+runScrub.value)));
runSpeed.addEventListener("input", () => player?.setSpeed(runSpeed.value));
runStop.addEventListener("click", () => {
  if (mode === "replay") {
    exitReplay();
    update();
  }
});

// Space, arrows, Home/End and Esc while replaying; false if the key is not one of them.
function replayKey(event) {
  const key = event.key;
  if (key === " ") {
    if (event.target.closest?.("button, summary")) {
      return false; // the focused control's own Space
    }
    setPlaying(!player.playing);
  } else if (key === "ArrowLeft") {
    stepBy(() => player.prev());
  } else if (key === "ArrowRight") {
    stepBy(() => player.next());
  } else if (key === "Home" || key === "End") {
    stepBy(() => player.seek(key === "Home" ? 0 : loaded.total - 1));
  } else if (key === "Escape") {
    exitReplay();
    update();
  } else {
    return false;
  }
  return true;
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

function openHelp() {
  helpDialog.hidden = false;
  helpClose.focus();
}

function closeHelp() {
  helpDialog.hidden = true;
  helpButton.focus();
}

helpButton.addEventListener("click", () => (helpDialog.hidden ? openHelp() : closeHelp()));
helpClose.addEventListener("click", closeHelp);

tipDismiss.addEventListener("click", () => {
  tipBanner.hidden = true;
  saveState({ tipDismissed: true });
  vscode.postMessage({ type: "tipDismissed" });
});

document.addEventListener("keydown", (event) => {
  // While the cheat sheet is open, keys only close it: the diagram's keys must not act behind it.
  if (!helpDialog.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeHelp();
    }
    return;
  }
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    startRun();
    return;
  }
  const target = event.target;
  const node = target.closest?.(".cfg-node[data-from]");
  if (node && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    reveal(node);
    return;
  }
  if (target.closest?.("select, input") || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  if (event.key === "?") {
    event.preventDefault();
    openHelp();
    return;
  }
  if (mode === "replay" && replayKey(event)) {
    event.preventDefault();
    return;
  }
  if (!root) {
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

// Watches #display, not the window: the tip banner showing or hiding also changes its height.
new ResizeObserver(() => {
  if (root && !userMoved) {
    fitView();
  }
}).observe(display);

vscode.postMessage({ type: "ready" });
