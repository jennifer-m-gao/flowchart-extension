import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { functionGraph } from "../../webview/functionParser.js";

function functions(source, options) {
  return functionGraph(parser.parse(source), source, options);
}

const edges = (g) => g.edges.map((e) => `${e.source} --> ${e.target}`);
const labels = (g) => g.nodes.map((n) => n.label);
function labelEdges(g) {
  const ids = new Map(g.nodes.map((n) => [n.id, n.label]));
  return g.edges.map((e) => `${ids.get(e.source)} --> ${ids.get(e.target)}`);
}
const node = (g, id) => g.nodes.find((n) => n.id === id);

test("no functions gives an empty graph", () => {
  assert.deepEqual(functions("x = 1\n"), { nodes: [], edges: [] });
});

test("single function without calls has no edges", () => {
  const g = functions("def a():\n  pass\n");
  assert.equal(node(g, "function0").label, "a");
  assert.equal(g.edges.length, 0);
});

test("call between defined functions links them", () => {
  const g = functions("def a():\n  b()\ndef b():\n  pass\n");
  assert.equal(node(g, "function0").label, "a");
  assert.equal(node(g, "function1").label, "b");
  assert.ok(edges(g).includes("function0 --> function1"));
  assert.ok(!g.nodes.some((n) => n.id.startsWith("external")));
});

test("call to unknown function becomes an external node", () => {
  const g = functions("def a():\n  print(1)\n");
  assert.equal(node(g, "external1").label, "print");
  assert.equal(node(g, "external1").kind, "external");
  assert.ok(edges(g).includes("function0 --> external1"));
});

test("method calls are ignored", () => {
  assert.equal(functions("def a():\n  obj.m()\n").edges.length, 0);
});

test("repeated calls produce a single edge", () => {
  assert.equal(functions("def a():\n  b()\n  b()\n").edges.length, 1);
});

test("same-named methods in different classes are separate nodes", () => {
  const g = functions("class A:\n  def __init__(self):\n    x()\nclass B:\n  def __init__(self):\n    y()\n");
  assert.ok(labels(g).includes("A.__init__"));
  assert.ok(labels(g).includes("B.__init__"));
  assert.deepEqual(labelEdges(g).sort(), ["A.__init__ --> x", "B.__init__ --> y"]);
});

test("calls inside a nested function are not attributed to the outer function", () => {
  const g = functions("def outer():\n  def inner():\n    g()\n  f()\n");
  assert.ok(labels(g).includes("outer"));
  assert.ok(labels(g).includes("outer.inner"));
  assert.deepEqual(labelEdges(g).sort(), ["outer --> f", "outer.inner --> g"]);
});

test("bare call to a top-level def links to it", () => {
  const g = functions("def a():\n  b()\ndef b():\n  pass\n");
  assert.ok(g.edges[0].target.startsWith("function"));
  assert.deepEqual(labelEdges(g), ["a --> b"]);
});

test("bare call matching only a nested def goes to an external node", () => {
  const g = functions("def outer():\n  def inner():\n    pass\n  inner()\n");
  assert.ok(edges(g).some((e) => e.startsWith("function0 --> external")));
});

test("self.method() calls stay ignored", () => {
  assert.equal(functions("def a(self):\n  self.save()\n").edges.length, 0);
});

test("no defs gives no nodes", () => {
  assert.equal(functions("x = 1\n").nodes.length, 0);
});

test("defined functions carry their source range", () => {
  const source = "x = 1\ndef a():\n  pass\n";
  const a = node(functions(source), "function0");
  assert.equal(a.kind, "function");
  assert.equal(a.from, source.indexOf("def"));
  assert.equal(a.to, source.length); // lezer's Body ends after the trailing newline
});

test("a decorated def starts at its decorator", () => {
  const source = "x = 1\n@dec\ndef a():\n  pass\n";
  assert.equal(node(functions(source), "function0").from, source.indexOf("@"));
});

test("externals have no source range", () => {
  const ext = node(functions("def a():\n  print(1)\n"), "external1");
  assert.equal(ext.from, null);
  assert.equal(ext.to, null);
});

const builtinsSource = "def a():\n  print(len([]))\n  helper()\n";

test("hideBuiltins drops built-in calls but keeps other externals", () => {
  const g = functions(builtinsSource, { hideBuiltins: true });
  assert.ok(!labels(g).includes("print"));
  assert.ok(!labels(g).includes("len"));
  assert.equal(g.nodes.find((n) => n.label === "helper").kind, "external");
  assert.deepEqual(labelEdges(g), ["a --> helper"]);
});

test("built-ins are shown by default", () => {
  const g = functions(builtinsSource);
  assert.ok(labels(g).includes("print"));
  assert.ok(labels(g).includes("len"));
});

test("hideBuiltins never hides a user def named like a built-in", () => {
  const g = functions("def print():\n  pass\ndef a():\n  print()\n", { hideBuiltins: true });
  assert.deepEqual(labelEdges(g), ["a --> print"]);
});
