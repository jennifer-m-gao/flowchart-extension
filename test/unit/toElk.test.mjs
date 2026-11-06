import test from "node:test";
import assert from "node:assert/strict";
import { nodeSize, toElk, CHAR_W } from "../../webview/render/toElk.js";

const long = "x".repeat(40);
const longW = Math.ceil(40 * CHAR_W);

test("rectangle kinds: min width for short labels, text-based for long ones", () => {
  for (const kind of ["statement", "return", "raise", "break", "continue", "try", "except", "finally", "def", "function", "external"]) {
    assert.deepEqual(nodeSize({ kind, label: "a" }), { width: 80, height: 32 });
    assert.deepEqual(nodeSize({ kind, label: long }), { width: longW + 24, height: 32 });
  }
});

test("diamond kinds: decision and loop", () => {
  for (const kind of ["decision", "loop"]) {
    assert.deepEqual(nodeSize({ kind, label: "a" }), { width: 96, height: 56 });
    assert.deepEqual(nodeSize({ kind, label: long }), { width: longW + 56, height: 56 });
  }
});

test("stadium kinds: start and end", () => {
  for (const kind of ["start", "end"]) {
    assert.deepEqual(nodeSize({ kind, label: "a" }), { width: 72, height: 32 });
    assert.deepEqual(nodeSize({ kind, label: long }), { width: longW + 32, height: 32 });
  }
});

const graph = {
  nodes: [
    { id: "start", kind: "start", label: "Start", from: 0, to: 0 },
    { id: "n0", kind: "decision", label: "if a", from: 0, to: 4 },
    { id: "end", kind: "end", label: "End", from: 5, to: 5 },
  ],
  edges: [
    { source: "start", target: "n0" },
    { source: "n0", target: "end", label: "True" },
  ],
};

test("every node becomes an ELK child with the same id and no source data", () => {
  const elk = toElk(graph);
  assert.deepEqual(elk.children.map((c) => c.id), ["start", "n0", "end"]);
  assert.deepEqual(Object.keys(elk.children[1]).sort(), ["height", "id", "width"]);
});

test("every edge becomes an ELK edge; labelled edges carry the label", () => {
  const elk = toElk(graph);
  assert.deepEqual(elk.edges.map((e) => [e.id, e.sources, e.targets]), [
    ["e0", ["start"], ["n0"]],
    ["e1", ["n0"], ["end"]],
  ]);
  assert.equal(elk.edges[0].labels, undefined);
  assert.equal(elk.edges[1].labels[0].text, "True");
  assert.equal(elk.edges[1].labels[0].width, Math.ceil(4 * 6.6) + 8);
});

test("layout options select layered, top-down", () => {
  const { layoutOptions } = toElk(graph);
  assert.equal(layoutOptions["elk.algorithm"], "layered");
  assert.equal(layoutOptions["elk.direction"], "DOWN");
});
