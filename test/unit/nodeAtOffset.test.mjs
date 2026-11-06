import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { buildCfg } from "../../webview/cfg/buildCfg.js";
import { nodeAtOffset } from "../../webview/interact/nodeAtOffset.js";

const SRC = "def f(a):\n    x = 1\n    if a:\n        y = 2\n\n    return x\n";

function functionGraph(src) {
  return buildCfg(parser.parse(src).topNode.getChild("FunctionDefinition"), src);
}
function moduleGraph(src) {
  return buildCfg(parser.parse(src).topNode, src);
}
function labelAt(graph, src, offset) {
  const id = nodeAtOffset(graph.nodes, offset, src);
  return id === null ? null : graph.nodes.find((n) => n.id === id).label;
}

test("cursor inside a statement returns it", () => {
  assert.equal(labelAt(functionGraph(SRC), SRC, SRC.indexOf("x = 1") + 2), "x = 1");
});

test("cursor inside an if body statement returns the statement, not the decision", () => {
  assert.equal(labelAt(functionGraph(SRC), SRC, SRC.indexOf("y = 2") + 1), "y = 2");
});

test("cursor on the if header returns the decision", () => {
  assert.equal(labelAt(functionGraph(SRC), SRC, SRC.indexOf("if a") + 1), "if a");
});

test("cursor in leading indentation returns that line's statement", () => {
  assert.equal(labelAt(functionGraph(SRC), SRC, SRC.indexOf("    return") + 1), "return x");
});

test("cursor at the end of a line after a statement returns it", () => {
  assert.equal(labelAt(functionGraph(SRC), SRC, SRC.indexOf("if a:") + 5), "if a");
});

test("cursor on a blank line returns null", () => {
  assert.equal(labelAt(functionGraph(SRC), SRC, SRC.indexOf("\n\n") + 1), null);
});

test("CRLF source works", () => {
  const crlf = SRC.replace(/\n/g, "\r\n");
  const graph = functionGraph(crlf);
  assert.equal(labelAt(graph, crlf, crlf.indexOf("y = 2") + 1), "y = 2");
  assert.equal(labelAt(graph, crlf, crlf.indexOf("    return") + 2), "return x");
  assert.equal(labelAt(graph, crlf, crlf.indexOf("if a:") + 5), "if a");
});

test("zero-width end is never returned", () => {
  const graph = functionGraph(SRC);
  const end = graph.nodes.find((n) => n.kind === "end");
  assert.notEqual(nodeAtOffset(graph.nodes, end.from, SRC), "end");
  assert.notEqual(nodeAtOffset(graph.nodes, SRC.length, SRC), "end");
});

test("module scope: cursor inside a nested function returns the def node", () => {
  const src = `x = 0\n${SRC}`;
  const graph = moduleGraph(src);
  assert.equal(labelAt(graph, src, src.indexOf("y = 2")), "def f(a)");
  assert.equal(labelAt(graph, src, src.indexOf("x = 1")), "def f(a)");
});

test("ties go to the later node; nodes without ranges are ignored", () => {
  const nodes = [
    { id: "a", from: 0, to: 4 },
    { id: "b", from: 0, to: 4 },
    { id: "ext", from: null, to: null },
  ];
  assert.equal(nodeAtOffset(nodes, 1, "abcd"), "b");
  assert.equal(nodeAtOffset([{ id: "ext", from: null, to: null }], 0, "x"), null);
});

test("line fallback picks the smallest from on the line", () => {
  const code = "a; b\n";
  const nodes = [{ id: "b", from: 3, to: 4 }, { id: "a", from: 0, to: 1 }];
  assert.equal(nodeAtOffset(nodes, 4, code), "a");
});
