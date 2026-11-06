import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { parseFunctions } from "../../webview/functionParser.js";

function functions(source) {
  return parseFunctions(parser.parse(source), source);
}

const edges = (out) => out.split("\n").filter((l) => l.includes("-->")).map((l) => l.trim());
const labels = (out) => [...out.matchAll(/\["([^"]*)"\]/g)].map((m) => m[1]);
function labelEdges(out) {
  const ids = new Map([...out.matchAll(/^\s+(\w+)\["([^"]*)"\]$/gm)].map((m) => [m[1], m[2]]));
  return edges(out).map((e) => e.split(" --> ").map((id) => ids.get(id)).join(" --> "));
}

test("no functions gives an empty graph", () => {
  assert.equal(functions("x = 1\n"), "flowchart TD\n");
});

test("single function without calls has no edges", () => {
  const out = functions("def a():\n  pass\n");
  assert.ok(out.includes('function0["a"]'));
  assert.ok(!out.includes("-->"));
});

test("call between defined functions links them", () => {
  const out = functions("def a():\n  b()\ndef b():\n  pass\n");
  assert.ok(out.includes('function0["a"]'));
  assert.ok(out.includes('function1["b"]'));
  assert.ok(out.includes("function0 --> function1"));
  assert.ok(!out.includes("external"));
});

test("call to unknown function becomes an external node", () => {
  const out = functions("def a():\n  print(1)\n");
  assert.ok(out.includes('external1["print"]'));
  assert.ok(out.includes("function0 --> external1"));
});

test("method calls are ignored", () => {
  assert.ok(!functions("def a():\n  obj.m()\n").includes("-->"));
});

test("function with repeated calls (whole output)", () => {
  assert.equal(
    functions("def a():\n  b()\n  b()\n"),
    'flowchart TD\n    function0["a"]\n    external1["b"]\n    function0 --> external1\n'
  );
});


test("repeated calls produce a single edge", () => {
  assert.equal(edges(functions("def a():\n  b()\n  b()\n")).length, 1);
});

test("same-named methods in different classes are separate nodes", () => {
  const out = functions("class A:\n  def __init__(self):\n    x()\nclass B:\n  def __init__(self):\n    y()\n");
  assert.ok(labels(out).includes("A.__init__"));
  assert.ok(labels(out).includes("B.__init__"));
  assert.deepEqual(labelEdges(out).sort(), ["A.__init__ --> x", "B.__init__ --> y"]);
});

test("calls inside a nested function are not attributed to the outer function", () => {
  const out = functions("def outer():\n  def inner():\n    g()\n  f()\n");
  assert.ok(labels(out).includes("outer"));
  assert.ok(labels(out).includes("outer.inner"));
  assert.deepEqual(labelEdges(out).sort(), ["outer --> f", "outer.inner --> g"]);
});

test("bare call to a top-level def links to it", () => {
  const out = functions("def a():\n  b()\ndef b():\n  pass\n");
  assert.ok(edges(out)[0].split(" --> ")[1].startsWith("function"));
  assert.deepEqual(labelEdges(out), ["a --> b"]);
});

test("bare call matching only a nested def goes to an external node", () => {
  const out = functions("def outer():\n  def inner():\n    pass\n  inner()\n");
  assert.ok(edges(out).some((e) => e.startsWith("function0 --> external")));
});

test("self.method() calls stay ignored", () => {
  assert.equal(edges(functions("def a(self):\n  self.save()\n")).length, 0);
});

test("no defs gives exactly the header", () => {
  assert.equal(functions("x = 1\n"), "flowchart TD\n");
});

test("functions mode uses the shared escaper", () => {
  const src = readFileSync(new URL("../../webview/functionParser.js", import.meta.url), "utf8");
  assert.match(src, /from "\.\/escapeLabel\.js"/);
});
