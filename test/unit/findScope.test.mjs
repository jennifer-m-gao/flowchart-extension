import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { findScope } from "../../webview/cfg/findScope.js";

// "|" marks the cursor; it is removed before parsing.
function scopeAt(marked) {
  const offset = marked.indexOf("|");
  const code = marked.slice(0, offset) + marked.slice(offset + 1);
  const s = findScope(parser.parse(code), code, offset);
  return { kind: s.kind, name: s.name, qualifiedName: s.qualifiedName, nodeName: s.node.name };
}

const fn = (q, name = q.split(".").pop()) => ({ kind: "function", name, qualifiedName: q, nodeName: "FunctionDefinition" });
const mod = { kind: "module", name: "<module>", qualifiedName: "<module>", nodeName: "Script" };

test("cursor inside a function body", () => {
  assert.deepEqual(scopeAt("def f():\n  x |= 1\n"), fn("f"));
});
test("on the def line", () => {
  assert.deepEqual(scopeAt("de|f f():\n  pass\n"), fn("f"));
});
test("on a decorator line selects the FunctionDefinition", () => {
  assert.deepEqual(scopeAt("@de|c\ndef g():\n  pass\n"), fn("g"));
});
test("module code", () => {
  assert.deepEqual(scopeAt("x = 1|\ndef f():\n  pass\n"), mod);
});
test("blank line after a function", () => {
  assert.equal(scopeAt("def f():\n  pass\n|\ny = 2\n").kind, "module");
});
test("end of file without trailing newline", () => {
  assert.deepEqual(scopeAt("def f():\n  pass|"), fn("f"));
});
test("method", () => {
  assert.deepEqual(scopeAt("class Cart:\n  def add_item(self):\n    retu|rn 1\n"), fn("Cart.add_item", "add_item"));
});
test("class body outside methods", () => {
  assert.equal(scopeAt("class K:\n  y |= 1\n  def m(self):\n    pass\n").kind, "module");
});
test("class header", () => {
  assert.equal(scopeAt("cla|ss K:\n  def m(self):\n    pass\n").kind, "module");
});
test("nested functions", () => {
  assert.equal(scopeAt("def outer():\n  def inner():\n    pa|ss\n  return inner\n").qualifiedName, "outer.inner");
  assert.equal(scopeAt("def outer():\n  def inner():\n    pass\n  ret|urn inner\n").qualifiedName, "outer");
});
test("function, class, method", () => {
  assert.equal(scopeAt("def f():\n  class C:\n    def m(self):\n      pa|ss\n").qualifiedName, "f.C.m");
});
test("async def", () => {
  assert.deepEqual(scopeAt("async def g():\n  awa|it x\n"), fn("g"));
});
test("empty file", () => {
  assert.equal(scopeAt("|").kind, "module");
});
test("out of range offsets", () => {
  const code = "def f():\n  pass\n";
  const tree = parser.parse(code);
  assert.equal(findScope(tree, code, 999).kind, "module");
  assert.equal(findScope(tree, code, -5).kind, "module");
});
test("mid-typing does not throw", () => {
  assert.ok(["module", "function"].includes(scopeAt("def |(").kind));
});
test("lambda is not a scope", () => {
  assert.equal(scopeAt("f = lambda x: x| + 1\n").kind, "module");
});
