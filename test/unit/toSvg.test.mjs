import test from "node:test";
import assert from "node:assert/strict";
import { nodeHint, toSvg, xml } from "../../webview/render/toSvg.js";

const graph = {
  nodes: [
    { id: "start", kind: "start", label: "Start", from: 0, to: 0 },
    { id: "n0", kind: "decision", label: 'a < b & "c"', from: 0, to: 12 },
    { id: "n1", kind: "statement", label: "x = 1", from: 14, to: 19, unreachable: true },
    { id: "external3", kind: "external", label: "print", from: null, to: null },
  ],
  edges: [
    { source: "start", target: "n0" },
    { source: "n0", target: "n1", label: "True" },
  ],
};

// Hand-written ELK output: no layout engine involved.
const laidOut = {
  id: "root",
  width: 200,
  height: 300,
  children: [
    { id: "start", x: 12, y: 12, width: 72, height: 32 },
    { id: "n0", x: 12, y: 76, width: 140, height: 56 },
    { id: "n1", x: 12, y: 164, width: 80, height: 32 },
    { id: "external3", x: 12, y: 228, width: 80, height: 32 },
  ],
  edges: [
    { id: "e0", sections: [{ startPoint: { x: 48, y: 44 }, endPoint: { x: 48, y: 76 } }] },
    {
      id: "e1",
      labels: [{ text: "True", x: 30, y: 140, width: 35, height: 14 }],
      sections: [{ startPoint: { x: 82, y: 132 }, bendPoints: [{ x: 82, y: 148 }, { x: 52.04, y: 148 }], endPoint: { x: 52, y: 164 } }],
    },
  ],
};

const svg = toSvg(laidOut, graph);
const nodeTag = (id) => svg.match(new RegExp(`<g class="cfg-node[^>]*data-id="${id}"[^>]*>`))[0];
const nodeBody = (id) => svg.split(`data-id="${id}"`)[1].split("</g>")[0];

test("root svg has size from the layout plus margin and exactly one cfg-root", () => {
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" class="cfg" viewBox="0 0 232 332" width="232" height="332">'));
  assert.equal(svg.split('class="cfg-root"').length - 1, 1);
  assert.ok(svg.includes('<marker id="cfg-arrow"'));
});

test("decision renders a polygon; start renders a stadium", () => {
  assert.ok(nodeBody("n0").includes('<polygon points="70,0 140,28 70,56 0,28"/>'));
  assert.ok(nodeBody("start").includes('<rect width="72" height="32" rx="16"/>'));
  assert.ok(nodeBody("n1").includes('rx="4"'));
});

test("cfg nodes carry data-from/data-to; externals do not", () => {
  assert.ok(nodeTag("n1").includes('data-from="14" data-to="19"'));
  assert.ok(nodeTag("start").includes('data-from="0" data-to="0"'));
  assert.ok(!nodeTag("external3").includes("data-from"));
  assert.ok(!nodeTag("external3").includes("data-to"));
});

test("labels are XML-escaped and raw < never appears inside text", () => {
  assert.ok(svg.includes(">a &lt; b &amp; &quot;c&quot;</text>"));
  for (const [, inner] of svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)) {
    assert.ok(!inner.includes("<"));
  }
  assert.equal(xml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("nodes are focusable buttons with an aria-label", () => {
  const tag = nodeTag("n0");
  assert.ok(tag.includes('aria-label="decision: a &lt; b &amp; &quot;c&quot;"'));
  assert.ok(tag.includes('tabindex="0"'));
  assert.ok(tag.includes('role="button"'));
  assert.ok(tag.includes('transform="translate(12,76)"'));
});

test("unreachable nodes get the is-unreachable class", () => {
  assert.ok(nodeTag("n1").startsWith('<g class="cfg-node cfg-node--statement is-unreachable"'));
  assert.ok(!nodeTag("n0").includes("is-unreachable"));
});

test("edges come before nodes, with path, arrow, kind class and label", () => {
  assert.ok(svg.indexOf("cfg-edge") < svg.indexOf("cfg-node"));
  assert.ok(svg.includes('<g class="cfg-edge cfg-edge--plain"><path d="M 48,44 L 48,76" marker-end="url(#cfg-arrow)"/></g>'));
  assert.ok(svg.includes('<g class="cfg-edge cfg-edge--True"><path d="M 82,132 L 82,148 L 52,148 L 52,164" marker-end="url(#cfg-arrow)"/>'));
  assert.ok(svg.includes('<text class="cfg-edge-label" x="47.5" y="151" text-anchor="middle">True</text>'));
});

test("each node's first child is a <title> hint", () => {
  assert.ok(nodeBody("n1").startsWith(` data-kind="statement" data-from="14" data-to="19" transform="translate(12,164)" tabindex="0" role="button" aria-label="statement: x = 1"><title>x = 1\nClick or Enter: go to code</title><rect`));
  assert.equal(nodeHint({ label: "x = 1", from: 14, to: 19 }), "x = 1\nClick or Enter: go to code");
});

test("external nodes hint that they are not defined here", () => {
  assert.ok(nodeBody("external3").includes("<title>print\nNot defined in this file</title>"));
});

test("title hints are XML-escaped", () => {
  assert.ok(nodeBody("n0").includes("<title>a &lt; b &amp; &quot;c&quot;\nClick or Enter: go to code</title>"));
  for (const [, inner] of svg.matchAll(/<title>(.*?)<\/title>/gs)) {
    assert.ok(!inner.includes("<"));
  }
});

test("no inline styles or colors in the output", () => {
  assert.ok(!svg.includes("style="));
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(svg));
});
