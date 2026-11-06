import { parser } from "@lezer/python";
import { makeFunction } from "./fixture200.mjs";
import { findScope } from "../webview/cfg/findScope.js";
import { buildCfg } from "../webview/cfg/buildCfg.js";
import { renderGraph } from "../webview/render/renderGraph.js";

const LIMIT_MS = 300; // D12/D14
const WARMUPS = 3;
const RUNS = 10;
const code = makeFunction(200);
const offset = code.indexOf("\n") + 3; // inside the function body

async function once() {
  const t0 = performance.now();
  const tree = parser.parse(code);
  const scope = findScope(tree, code, offset);
  const graph = buildCfg(scope.node, code);
  await renderGraph(graph); // toElk -> ELK layout -> toSvg
  return { ms: performance.now() - t0, nodes: graph.nodes.length, edges: graph.edges.length };
}

let last;
for (let i = 0; i < WARMUPS; i++) last = await once();
const times = [];
for (let i = 0; i < RUNS; i++) {
  last = await once();
  times.push(last.ms);
}
times.sort((a, b) => a - b);
const median = (times[RUNS / 2 - 1] + times[RUNS / 2]) / 2;
const p95 = times[Math.ceil(0.95 * RUNS) - 1];
const f = (n) => n.toFixed(1);
console.log(`lines ${code.split("\n").length}, nodes ${last.nodes}, edges ${last.edges}`);
console.log(`median ${f(median)} ms, p95 ${f(p95)} ms, max ${f(times[RUNS - 1])} ms (limit ${LIMIT_MS} ms)`);
if (median >= LIMIT_MS) { console.error("bench gate FAILED"); process.exit(1); }
