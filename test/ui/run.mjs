// Drives the PyChart webview in headless Chrome the way VS Code does, and prints PASS/FAIL per check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { startServer, findBrowser, CHECKOUT } from "./server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "shots");

if (!fs.existsSync(path.join(CHECKOUT, "dist", "webview", "bundle.js"))) {
  console.log("dist/webview/bundle.js missing: run npm run build:webview first");
  process.exit(1);
}
const CHROME = findBrowser();
if (!CHROME) {
  console.log("SKIP: no Chrome/Edge found (set CHROME=<path>)");
  process.exit(0);
}
console.log(`browser: ${CHROME}`);
fs.mkdirSync(SHOTS, { recursive: true });

const LF = fs.readFileSync(path.join(HERE, "fixtures", "demo.py"), "utf8").replace(/\r\n/g, "\n");
const CRLF = LF.replace(/\n/g, "\r\n");
const at = (code, needle, plus = 1) => {
  const i = code.indexOf(needle);
  if (i < 0) throw new Error(`needle not found: ${needle}`);
  return i + plus;
};

const results = [];
const problems = []; // console errors, page errors, CSP violations
function report(n, name, pass, evidence, shot) {
  results.push({ n, name, pass, evidence, shot });
  console.log(`\n[${pass ? "PASS" : "FAIL"}] ${n}. ${name}${shot ? `  (${shot})` : ""}`);
  for (const line of [].concat(evidence)) console.log(`    ${line}`);
}

const server = await startServer();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1200, height: 800 } });
const page = await browser.newPage();

page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
});
page.on("response", (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
await page.evaluateOnNewDocument(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI} (${e.sourceFile}:${e.lineNumber})`));
});

const shot = async (name) => {
  const file = path.join("shots", `${name}.png`);
  await page.screenshot({ path: path.join(HERE, file) });
  return file;
};
const transform = () => page.$eval("#display svg.cfg .cfg-root", (g) => {
  const m = /translate\(([-\d.e]+),([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(g.getAttribute("transform"));
  return { tx: +m[1], ty: +m[2], scale: +m[3] };
});
const fmt = (v) => `tx=${v.tx.toFixed(1)} ty=${v.ty.toFixed(1)} scale=${v.scale.toFixed(3)}`;
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const sameView = (a, b) => close(a.tx, b.tx) && close(a.ty, b.ty) && close(a.scale, b.scale, 0.001);
const updates = () => page.$eval("#time-track", (e) => +e.textContent);
const nodeCount = () => page.$$eval("#display .cfg-node", (n) => n.length);
const title = () => page.$eval("#scope-title", (e) => e.textContent);
const post = (msg) => page.evaluate((m) => window.postMessage(m, "*"), msg);

// Post setCode and resolve once the next render lands (#time-track increments).
async function setCode(code, offset) {
  const before = await updates();
  await post({ type: "setCode", code, offset });
  await page.waitForFunction((b) => +document.getElementById("time-track").textContent > b, { timeout: 10000 }, before);
}
// Force a fresh render (and refit) of code at offset, whatever is shown now.
async function ensure(code, offset) {
  await post({ type: "setMessage", text: "reset" });
  await setCode(code, offset);
}
async function changeControl(sel, apply, arg) {
  const before = await updates();
  await page.$eval(sel, apply, arg);
  await page.waitForFunction((b) => +document.getElementById("time-track").textContent > b, { timeout: 10000 }, before);
}

try {
  await page.goto(`${origin}/harness.html`);
  await page.waitForFunction(() => window.__posted.some((m) => m.type === "ready"), { timeout: 10000 });
  const cspMeta = await page.$eval('meta[http-equiv="Content-Security-Policy"]', (m) => m.content);
  console.log(`CSP in force: ${cspMeta}`);

  // ---- Render time: setCode post -> svg in the DOM (includes main.js's 50 ms typing debounce).
  const times = [];
  for (let i = 0; i < 5; i++) {
    await post({ type: "setMessage", text: "reset" });
    times.push(await page.evaluate((code, offset) => new Promise((resolve) => {
      const t0 = performance.now();
      const done = () => document.querySelector("#display svg.cfg") ? resolve(performance.now() - t0) : requestAnimationFrame(done);
      window.postMessage({ type: "setCode", code, offset }, "*");
      requestAnimationFrame(done);
    }), LF, at(LF, "results = []")));
  }
  const sorted = [...times].sort((a, b) => a - b);
  report("R", "Render time (demo.py, classify scope)", sorted[2] < 1000,
    [`runs ms: ${times.map((t) => t.toFixed(1)).join(", ")}`, `median ${sorted[2].toFixed(1)} ms (includes the 50 ms setCode debounce)`]);

  // ---- 1. Pan/zoom
  {
    await ensure(LF, at(LF, "results = []"));
    const box = await page.$eval("#display", (d) => { const r = d.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const mx = box.x + box.w * 0.6, my = box.y + box.h * 0.4;
    const ev = [];
    let ok = true;
    const t0 = await transform();
    ev.push(`fitted:            ${fmt(t0)}`);

    await page.mouse.move(mx, my);
    await page.mouse.wheel({ deltaY: 120 });
    await new Promise((r) => setTimeout(r, 100));
    const t1 = await transform();
    const wheelOk = close(t1.ty, t0.ty - 120) && close(t1.tx, t0.tx) && close(t1.scale, t0.scale, 1e-6);
    ok &&= wheelOk;
    ev.push(`wheel dY=120:      ${fmt(t1)}  -> pans ty by ${(t1.ty - t0.ty).toFixed(1)} ${wheelOk ? "ok" : "UNEXPECTED"}`);

    await page.keyboard.down("Control");
    await page.mouse.wheel({ deltaY: -30 });
    await page.keyboard.up("Control");
    await new Promise((r) => setTimeout(r, 100));
    const t2 = await transform();
    // Content point under the mouse before vs after must stay put.
    const px = mx - box.x, py = my - box.y;
    const c1 = [(px - t1.tx) / t1.scale, (py - t1.ty) / t1.scale];
    const c2 = [(px - t2.tx) / t2.scale, (py - t2.ty) / t2.scale];
    const zoomOk = close(t2.scale / t1.scale, Math.exp(0.3), 0.01) && close(c1[0], c2[0]) && close(c1[1], c2[1]);
    ok &&= zoomOk;
    ev.push(`ctrl+wheel dY=-30: ${fmt(t2)}  -> scale x${(t2.scale / t1.scale).toFixed(3)}; content pt under mouse (${c1.map((n) => n.toFixed(1))}) -> (${c2.map((n) => n.toFixed(1))}) ${zoomOk ? "ok" : "UNEXPECTED"}`);

    await page.mouse.move(mx, my);
    await page.mouse.down();
    await page.mouse.move(mx + 80, my + 40, { steps: 8 });
    await page.mouse.up();
    const t3 = await transform();
    const dragOk = close(t3.tx - t2.tx, 80, 1) && close(t3.ty - t2.ty, 40, 1) && close(t3.scale, t2.scale, 1e-6);
    ok &&= dragOk;
    ev.push(`drag +80,+40:      ${fmt(t3)}  -> moved (${(t3.tx - t2.tx).toFixed(1)}, ${(t3.ty - t2.ty).toFixed(1)}) ${dragOk ? "ok" : "UNEXPECTED"}`);

    await page.click("#fit-view");
    const t4 = await transform();
    const fitOk = sameView(t4, t0);
    ok &&= fitOk;
    ev.push(`Fit button:        ${fmt(t4)}  -> ${fitOk ? "back to fitted view ok" : "NOT the fitted view"}`);

    await page.keyboard.press("+");
    const t5 = await transform();
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    const t6 = await transform();
    await page.keyboard.press("0");
    const t7 = await transform();
    const keysOk = close(t5.scale / t4.scale, 1.2, 0.001) && close(t6.scale / t5.scale, 1 / 1.44, 0.001) && sameView(t7, t0);
    ok &&= keysOk;
    ev.push(`key +:             ${fmt(t5)}  (x${(t5.scale / t4.scale).toFixed(3)})`);
    ev.push(`key - -:           ${fmt(t6)}  (x${(t6.scale / t5.scale).toFixed(3)})`);
    ev.push(`key 0:             ${fmt(t7)}  -> ${sameView(t7, t0) ? "fitted" : "NOT fitted"}`);
    await page.keyboard.press("+");
    report(1, "Pan/zoom", ok, ev, await shot("01-panzoom"));
    await page.keyboard.press("0");
  }

  // ---- 2. Click to source
  {
    const ev = [];
    const node = await page.$('#display .cfg-node[aria-label="decision: if s < 0"]');
    if (!node) throw new Error(`decision node not found; labels: ${await page.$$eval("#display .cfg-node", (n) => n.map((e) => e.getAttribute("aria-label")).join(" | "))}`);
    const data = await node.evaluate((g) => ({ from: +g.dataset.from, to: +g.dataset.to }));
    await page.evaluate(() => { window.__posted.length = 0; });
    const b = await node.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const posted = await page.evaluate(() => window.__posted.slice());
    const reveal = posted.find((m) => m.type === "reveal");
    const raw = LF.slice(data.from, data.to).replace(/\r?\n$/, "");
    const expected = raw.includes("\n") ? { from: data.from, to: data.from } : data;
    const clickOk = posted.length === 1 && reveal && reveal.from === expected.from && reveal.to === expected.to && LF.slice(reveal.from).startsWith("if s < 0");
    ev.push(`node data-from/to = ${data.from}/${data.to}, text ${JSON.stringify(LF.slice(data.from, data.to))}`);
    ev.push(`posted: ${JSON.stringify(posted)}; expected ${JSON.stringify({ type: "reveal", ...expected })}`);
    ev.push(`source at from: ${JSON.stringify(LF.slice(reveal?.from ?? 0, (reveal?.from ?? 0) + 12))}`);
    const s = await shot("02-click-to-source");

    await page.evaluate(() => { window.__posted.length = 0; });
    const b2 = await node.boundingBox();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2 + 25, b2.y + b2.height / 2 + 5, { steps: 5 });
    await page.mouse.up();
    const afterDrag = await page.evaluate(() => window.__posted.slice());
    const dragOk = !afterDrag.some((m) => m.type === "reveal");
    ev.push(`drag of 30px starting on the node -> posted ${JSON.stringify(afterDrag)} ${dragOk ? "(no reveal, ok)" : "(UNEXPECTED reveal)"}`);
    report(2, "Click to source", clickOk && dragOk, ev, s);
    await page.click("#fit-view");
  }

  // ---- 3. Cursor highlight (LF, then CRLF)
  async function cursorCheck(code, label) {
    const ev = [];
    let ok = true;
    await ensure(code, at(code, "results = []"));
    const targets = ['results.append("pass")', 'print("all scores read")', "return results"];
    for (const needle of targets) {
      const offset = at(code, needle, 4);
      const r = await page.evaluate((offset) => new Promise((resolve) => {
        // Expected node: smallest data-from/data-to span holding the offset (nodeAtOffset's first rule).
        let best = null;
        for (const g of document.querySelectorAll("#display .cfg-node[data-from]")) {
          const f = +g.dataset.from, t = +g.dataset.to;
          if (t > f && f <= offset && offset < t && (!best || t - f <= best.t - best.f)) best = { g, f, t };
        }
        const t0 = performance.now();
        const obs = new MutationObserver(() => {
          const cur = document.querySelectorAll("#display .cfg-node.is-current");
          if (cur.length === 1 && cur[0] === best?.g) {
            obs.disconnect();
            resolve({ ms: performance.now() - t0, count: cur.length, label: cur[0].getAttribute("aria-label"), expected: best.g.getAttribute("aria-label") });
          }
        });
        obs.observe(document.getElementById("display"), { subtree: true, attributes: true, attributeFilter: ["class"] });
        window.postMessage({ type: "setCursor", offset }, "*");
        setTimeout(() => {
          obs.disconnect();
          const cur = [...document.querySelectorAll("#display .cfg-node.is-current")];
          resolve({ ms: null, count: cur.length, label: cur.map((c) => c.getAttribute("aria-label")).join(" | "), expected: best?.g.getAttribute("aria-label") });
        }, 1000);
      }), offset);
      const pass = r.ms !== null && r.count === 1 && r.label === r.expected;
      ok &&= pass;
      ev.push(`${label} offset ${offset} in ${JSON.stringify(needle)} -> is-current x${r.count} = ${JSON.stringify(r.label)} (expected ${JSON.stringify(r.expected)}) in ${r.ms === null ? "n/a" : r.ms.toFixed(2) + " ms"} ${pass ? "ok" : "MISMATCH"}`);
    }
    return { ok, ev };
  }
  {
    const a = await cursorCheck(LF, "LF");
    const s = await shot("03-cursor-highlight");
    const b = await cursorCheck(CRLF, "CRLF");
    const s2 = await shot("03b-cursor-highlight-crlf");
    report(3, "Cursor highlight (LF + CRLF)", a.ok && b.ok, [...a.ev, ...b.ev], `${s}, ${s2}`);
  }

  // ---- 4. Follow cursor + whole file
  {
    const ev = [];
    await ensure(LF, at(LF, "results = []"));
    const classifyNodes = await nodeCount();
    const classifyTitle = await title();
    await post({ type: "setCursor", offset: at(LF, "qty -= 1") });
    await page.waitForFunction(() => document.getElementById("scope-title").textContent === "Cart.add_item", { timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".cfg-node[aria-label*='scores']"), { timeout: 5000 }).catch(() => {});
    const addTitle = await title();
    const addNodes = await nodeCount();
    const addLabels = await page.$$eval("#display .cfg-node", (n) => n.map((e) => e.getAttribute("aria-label")));
    const followOk = classifyTitle === "classify" && addTitle === "Cart.add_item" && addNodes !== classifyNodes;
    ev.push(`classify: title ${JSON.stringify(classifyTitle)}, ${classifyNodes} nodes`);
    ev.push(`cursor in add_item: title ${JSON.stringify(addTitle)}, ${addNodes} nodes: ${addLabels.join(" | ")}`);
    const s1 = await shot("04-follow-add-item");

    await changeControl("#whole-file", (c) => c.click());
    const wfTitle = await title();
    const defs = await page.$$eval('#display .cfg-node[data-kind="def"]', (n) => n.map((e) => e.getAttribute("aria-label")));
    const wfOk = wfTitle === "Module (whole file)" && defs.length >= 3;
    ev.push(`whole file: title ${JSON.stringify(wfTitle)}, ${await nodeCount()} nodes, def nodes: ${defs.join(" | ")}`);
    const s2 = await shot("04b-whole-file");
    await changeControl("#whole-file", (c) => c.click());
    report(4, "Follow cursor + whole file", followOk && wfOk, ev, `${s1}, ${s2}`);
  }

  // ---- 5. Typing keeps zoom
  {
    const ev = [];
    await ensure(LF, at(LF, "results = []"));
    await page.click("#fit-view");
    await page.keyboard.press("+");
    await page.keyboard.press("+");
    const zoomed = await transform();
    const n0 = await nodeCount();
    const edited = LF.replace("    for s in scores:\n", "    for s in scores:\n        x = 1\n");
    await setCode(edited, at(edited, "x = 1"));
    const afterEdit = await transform();
    const n1 = await nodeCount();
    const hasX = await page.$('#display .cfg-node[aria-label="statement: x = 1"]');
    const keepOk = n1 >= n0 + 1 && !!hasX && sameView(zoomed, afterEdit);
    ev.push(`zoomed in classify: ${fmt(zoomed)}, ${n0} nodes`);
    ev.push(`after edit (+ "x = 1"): ${fmt(afterEdit)}, ${n1} nodes, x = 1 node ${hasX ? "present" : "MISSING"} -> zoom ${sameView(zoomed, afterEdit) ? "preserved" : "LOST"}`);
    const s = await shot("05-typing-keeps-zoom");
    await setCode(edited, at(edited, "f = open(path)"));
    const afterMove = await transform();
    const refitOk = (await title()) === "load" && !sameView(afterMove, afterEdit);
    ev.push(`cursor moved to load (setCode): title ${JSON.stringify(await title())}, ${fmt(afterMove)} -> ${refitOk ? "refit" : "NOT refit"}`);
    report(5, "Typing keeps zoom, scope change refits", keepOk && refitOk, ev, s);
  }

  // ---- 6. Functions mode
  {
    await ensure(LF, at(LF, "results = []"));
    await changeControl("#diagram-mode", (s) => { s.value = "functions"; s.dispatchEvent(new Event("change")); });
    const labels = await page.$$eval("#display .cfg-node text", (n) => n.map((e) => e.textContent));
    const edges = await page.$$eval("#display .cfg-edge", (n) => n.length);
    const state = await page.evaluate(() => window.__state);
    const want = ["classify", "load", "main", "Cart.__init__", "Cart.add_item"];
    const missing = want.filter((w) => !labels.includes(w));
    report(6, "Functions mode", missing.length === 0 && state?.mode === "functions",
      [`node labels: ${labels.join(" | ")}`, `missing: ${missing.join(", ") || "none"}`, `edges: ${edges}`, `__state = ${JSON.stringify(state)}`],
      await shot("06-functions"));
    await changeControl("#diagram-mode", (s) => { s.value = "flow"; s.dispatchEvent(new Event("change")); });
  }

  // ---- 7. Themes
  {
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const read = () => page.evaluate(() => {
      const cs = (sel, prop) => { const e = document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
      return {
        background: cs("body", "backgroundColor"),
        statementFill: cs(".cfg-node--statement:not(.is-current) rect", "fill"),
        decisionFill: cs(".cfg-node--decision polygon", "fill"),
        startFill: cs(".cfg-node--start rect", "fill"),
        startText: cs(".cfg-node--start text", "fill"),
        nodeStroke: cs(".cfg-node--statement:not(.is-current) rect", "stroke"),
        text: cs(".cfg-node--statement:not(.is-current) text", "fill"),
        edgeStroke: cs(".cfg-edge--plain path", "stroke"),
      };
    });
    const out = {};
    const ev = [];
    let ok = true;
    const shots = [];
    for (const theme of ["vscode-dark", "vscode-light", "vscode-light theme-lightplus"]) {
      await page.evaluate((t) => { document.body.className = t; }, theme);
      const c = await read();
      out[theme] = c;
      const ratios = { statement: contrast(c.text, c.statementFill), decision: contrast(c.text, c.decisionFill), start: contrast(c.startText, c.startFill) };
      const low = Object.entries(ratios).filter(([, r]) => r < 4.5);
      // Edges and box borders are graphics: WCAG 1.4.11 asks 3:1 against the background.
      const edgeRatio = contrast(c.edgeStroke, c.background);
      const borderRatio = contrast(c.nodeStroke, c.background);
      ok &&= low.length === 0 && edgeRatio >= 3 && borderRatio >= 3 && Object.values(c).every(Boolean);
      ev.push(`${theme}: ${JSON.stringify(c)}`);
      ev.push(`${theme} text contrast: ${Object.entries(ratios).map(([k, r]) => `${k} ${r.toFixed(2)}:1`).join(", ")}${low.length ? "  BELOW 4.5" : ""}; edge vs background ${edgeRatio.toFixed(2)}:1; border vs background ${borderRatio.toFixed(2)}:1${borderRatio < 3 ? "  BELOW 3" : ""}`);
      const s = await shot(`07-theme-${theme.replace(" ", "-")}`);
      shots.push(s);
      ev.push(`  screenshot ${s}`);
    }
    const same = Object.keys(out["vscode-dark"]).filter((k) => out["vscode-dark"][k] === out["vscode-light"][k]);
    // editorLineNumber.foreground is #6e7681 in both Dark Modern and Light Modern, so edges and box borders may legitimately match.
    const shared = ["edgeStroke", "nodeStroke"];
    ok &&= same.every((k) => shared.includes(k));
    ev.push(`same in dark and Modern light: ${same.join(", ") || "none"}${same.some((k) => shared.includes(k)) ? " (expected: both themes define editorLineNumber.foreground = #6e7681)" : ""}`);
    report(7, "Themes", ok, ev, shots.join(", "));
    await page.evaluate(() => { document.body.className = "vscode-dark"; });
  }

  const visible = (sel) => page.$eval(sel, (e) => !e.hidden && getComputedStyle(e).display !== "none");
  const settle = () => page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
  const setMode = (mode) => changeControl("#diagram-mode", (s, m) => { s.value = m; s.dispatchEvent(new Event("change")); }, mode);

  // ---- 8. Functions view clean-up (hide built-ins on by default, self/class calls linked)
  {
    const ev = [];
    await ensure(LF, at(LF, "results = []"));
    await setMode("functions");
    const box = await page.$eval("#hide-builtins", (c) => ({ checked: c.checked, disabled: c.disabled }));
    const labels = await page.$$eval("#display .cfg-node text", (n) => n.map((e) => e.textContent));
    const uiEdges = await page.$$eval("#display .cfg-edge", (n) => n.length);
    // svg edges carry no ids, so take the edge list from the same parser and check the UI draws that many.
    const { functionGraph } = await import(pathToFileURL(path.join(CHECKOUT, "webview", "functionParser.js")).href);
    const { parser } = await import("@lezer/python");
    const g = functionGraph(parser.parse(LF), LF, { hideBuiltins: true });
    const names = new Map(g.nodes.map((n) => [n.id, n.label]));
    const edgeLabels = g.edges.map((e) => `${names.get(e.source)} --> ${names.get(e.target)}`);
    const want = ["classify", "load", "main", "Cart.__init__", "Cart.add_item"];
    const builtins = ["print", "open", "len", "range"];
    const shownBuiltins = builtins.filter((b) => labels.includes(b));
    const defaultOk = box.checked && !box.disabled && want.every((w) => labels.includes(w)) && shownBuiltins.length === 0
      && !labels.includes("Cart") && edgeLabels.includes("main --> Cart.__init__") && uiEdges === g.edges.length;
    ev.push(`#hide-builtins: checked=${box.checked} disabled=${box.disabled}`);
    ev.push(`node labels: ${labels.join(" | ")}; built-ins shown: ${shownBuiltins.join(", ") || "none"}`);
    ev.push(`edges in UI: ${uiEdges}; parser edges (${g.edges.length}): ${edgeLabels.join(", ")}`);
    const s = await shot("08-functions-clean");

    await changeControl("#hide-builtins", (c) => c.click());
    const labelsAll = await page.$$eval("#display .cfg-node text", (n) => n.map((e) => e.textContent));
    const edgesAll = await page.$$eval("#display .cfg-edge", (n) => n.length);
    const stateOff = await page.evaluate(() => window.__state);
    const offOk = labelsAll.includes("print") && stateOff?.hideBuiltins === false;
    ev.push(`unchecked: labels ${labelsAll.join(" | ")}; edges ${edgesAll}; __state.hideBuiltins = ${stateOff?.hideBuiltins}`);
    await changeControl("#hide-builtins", (c) => c.click());

    await setMode("flow");
    const flowDisabled = await page.$eval("#hide-builtins", (c) => c.disabled);
    ev.push(`Flow mode: #hide-builtins disabled=${flowDisabled}`);
    report(8, "Functions view clean-up", defaultOk && offOk && flowDisabled, ev, s);
  }

  // ---- 9. Hover hints
  {
    await ensure(LF, at(LF, "results = []"));
    const r = await page.$$eval("#display .cfg-node", (nodes) => ({
      total: nodes.length,
      withTitle: nodes.filter((g) => g.firstElementChild?.tagName === "title").length,
      decision: nodes.find((g) => g.getAttribute("aria-label") === "decision: if s < 0")?.firstElementChild?.textContent ?? null,
    }));
    const ok = r.total > 0 && r.withTitle === r.total && (r.decision ?? "").includes("Click or Enter: go to code");
    report(9, "Hover hints", ok, [`${r.withTitle}/${r.total} nodes have a first-child <title>`, `"if s < 0" title: ${JSON.stringify(r.decision)}`], await shot("09-hover-hints"));
  }

  // ---- 10. Cheat sheet
  {
    const ev = [];
    let ok = true;
    const active = () => page.evaluate(() => document.activeElement?.id ?? "");
    await page.click("#help-button");
    const open1 = await visible("#help-dialog");
    const focus1 = await active();
    ok &&= open1 && focus1 === "help-close";
    ev.push(`click ?: dialog visible=${open1}, focus=#${focus1}`);
    const s = await shot("10-cheat-sheet");
    const before = await transform();
    await page.keyboard.press("+");
    const after = await transform();
    ok &&= sameView(before, after);
    ev.push(`key + while open: ${fmt(before)} -> ${fmt(after)} ${sameView(before, after) ? "(blocked, ok)" : "(ZOOMED behind the dialog)"}`);
    await page.keyboard.press("Escape");
    const open2 = await visible("#help-dialog");
    const focus2 = await active();
    ok &&= !open2 && focus2 === "help-button";
    ev.push(`Escape: dialog visible=${open2}, focus=#${focus2}`);
    await page.keyboard.press("?");
    const open3 = await visible("#help-dialog");
    ok &&= open3;
    ev.push(`key ?: dialog visible=${open3}`);
    await page.keyboard.press("Escape");
    const open4 = await visible("#help-dialog");
    ok &&= !open4;
    ev.push(`Escape: dialog visible=${open4}`);
    report(10, "Cheat sheet", ok, ev, s);
  }

  // ---- 11. Tip banner
  {
    const ev = [];
    let ok = true;
    const v0 = await visible("#tip-banner");
    ok &&= !v0;
    ev.push(`after ready, before tipState: visible=${v0}`);
    await post({ type: "tipState", dismissed: false });
    await page.waitForFunction(() => !document.getElementById("tip-banner").hidden, { timeout: 5000 }).catch(() => {});
    const v1 = await visible("#tip-banner");
    ok &&= v1;
    ev.push(`tipState dismissed:false -> visible=${v1}`);
    // The graph must still fit inside #display (1 px tolerance) once the refit after the height change lands.
    const fits = async (when) => {
      const r = await page.waitForFunction(() => {
        const g = document.querySelector("#display svg.cfg .cfg-root")?.getBoundingClientRect();
        const d = document.getElementById("display").getBoundingClientRect();
        const inside = g && g.top >= d.top - 1 && g.left >= d.left - 1 && g.bottom <= d.bottom + 1 && g.right <= d.right + 1;
        return inside && { g: [g.left, g.top, g.right, g.bottom].map(Math.round), d: [d.left, d.top, d.right, d.bottom].map(Math.round) };
      }, { timeout: 2000 }).then((h) => h.jsonValue()).catch(() => null);
      ev.push(`${when}: graph ${r ? `[${r.g}] inside #display [${r.d}]` : "NOT inside #display (clipped)"}`);
      return !!r;
    };
    const fitShown = await fits("banner shown");
    ok &&= fitShown;
    const s = await shot("11-tip-banner");
    await page.evaluate(() => { window.__posted.length = 0; });
    await page.click("#tip-dismiss");
    const fitDismissed = await fits("banner dismissed");
    ok &&= fitDismissed;
    // Containment alone passes without a refit once the area grows, so also compare with a fresh Fit.
    await settle();
    const auto = await transform();
    await page.click("#fit-view");
    const refit = await transform();
    ok &&= sameView(auto, refit);
    ev.push(`after dismiss: ${fmt(auto)} vs Fit ${fmt(refit)} -> ${sameView(auto, refit) ? "refit ok" : "NOT refit"}`);
    const v2 = await visible("#tip-banner");
    const posted = await page.evaluate(() => window.__posted.slice());
    const state = await page.evaluate(() => window.__state);
    const dismissOk = !v2 && posted.some((m) => m.type === "tipDismissed") && state?.tipDismissed === true;
    ok &&= dismissOk;
    ev.push(`click x: visible=${v2}, posted ${JSON.stringify(posted)}, __state.tipDismissed=${state?.tipDismissed}`);
    await post({ type: "tipState", dismissed: false });
    await settle();
    const v3 = await visible("#tip-banner");
    ok &&= !v3;
    ev.push(`tipState dismissed:false again (webview state remembers) -> visible=${v3}`);

    problems.push(...(await page.evaluate(() => window.__csp)).map((v) => `CSP violation: ${v}`)); // reload drops them
    await page.reload();
    await page.waitForFunction(() => window.__posted.some((m) => m.type === "ready"), { timeout: 10000 });
    const fresh = await page.evaluate(() => window.__state);
    await post({ type: "tipState", dismissed: true });
    await settle();
    const v4 = await visible("#tip-banner");
    ok &&= !v4 && fresh === undefined;
    ev.push(`reload (__state=${JSON.stringify(fresh)}), tipState dismissed:true (host remembers) -> visible=${v4}`);
    report(11, "Tip banner", ok, ev, s);
  }

  // ---- 12. State merge: a control change keeps the other keys
  {
    await ensure(LF, at(LF, "results = []"));
    await post({ type: "tipState", dismissed: false });
    await page.waitForFunction(() => !document.getElementById("tip-banner").hidden, { timeout: 5000 });
    await page.click("#tip-dismiss");
    const before = await page.evaluate(() => window.__state);
    await setMode("functions");
    const mid = await page.evaluate(() => window.__state);
    await setMode("flow");
    const after = await page.evaluate(() => window.__state);
    const ok = mid?.tipDismissed === true && after?.tipDismissed === true && typeof after?.hideBuiltins === "boolean" && mid?.mode === "functions" && after?.mode === "flow";
    report(12, "State merge", ok, [`after dismiss: ${JSON.stringify(before)}`, `after mode -> functions: ${JSON.stringify(mid)}`, `after mode -> flow: ${JSON.stringify(after)}`]);
  }
} catch (error) {
  report("X", "Harness error", false, error.stack);
} finally {
  problems.push(...(await page.evaluate(() => window.__csp).catch(() => [])).map((v) => `CSP violation: ${v}`));
  report("C", "No console errors / page errors / CSP violations", problems.length === 0, problems.length ? problems : ["none"]);
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(HERE, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; FAILED: ${failed.map((r) => r.n).join(", ")}` : ""}`);
  process.exitCode = failed.length ? 1 : 0;
}
