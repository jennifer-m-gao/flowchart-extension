import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { buildCfg } from "../../webview/cfg/buildCfg.js";
import { renderGraph } from "../../webview/render/renderGraph.js";

const translateY = (svg, id) => Number(svg.match(new RegExp(`data-id="${id}"[^>]*transform="translate\\([^,]+,([^)]+)\\)"`))[1]);

test("renderGraph lays out a real CFG top to bottom", async () => {
  const src = "x = 0\nwhile x < 3:\n  if x == 1:\n    break\n  x += 1\nprint(x)\n";
  const graph = buildCfg(parser.parse(src).topNode, src);
  const svg = await renderGraph(graph);
  assert.ok(svg.startsWith("<svg"));
  assert.equal(svg.split('class="cfg-node').length - 1, graph.nodes.length);
  assert.ok(translateY(svg, "start") < translateY(svg, "end"));
});

test("renderGraph handles an empty graph", async () => {
  const svg = await renderGraph({ nodes: [], edges: [] });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(!svg.includes("cfg-node"));
});
