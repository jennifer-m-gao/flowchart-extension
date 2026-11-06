import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { listScopes } from "../../webview/run/scopes.js";

const CODE = [
  "import functools",
  "",
  "class Cart:",
  "    def add_item(self, item):",
  "        return item",
  "",
  "def outer():",
  "    def inner():",
  "        return 1",
  "    return inner()",
  "",
  "@functools.cache",
  "def cached(n):",
  "    return n",
  "",
  "async def fetch():",
  "    return 2",
  "",
  "class A:",
  "    class B:",
  "        @staticmethod",
  "        def m():",
  "            pass",
  "",
].join("\n");
const tree = parser.parse(CODE);
const scopes = listScopes(tree, CODE);
const text = (q) => {
  const { node } = scopes.get(q);
  return CODE.slice(node.from, node.to);
};

test("lists <module> with the top node", () => {
  const { node } = scopes.get("<module>");
  assert.deepEqual([node.name, node.from, node.to], ["Script", 0, CODE.length]);
  assert.equal(scopes.get("<module>").qualifiedName, "<module>");
});
test("methods are named Class.method", () => {
  assert.ok(text("Cart.add_item").startsWith("def add_item"));
});
test("nested functions are named outer.inner", () => {
  assert.ok(text("outer.inner").startsWith("def inner"));
  assert.ok(text("outer").startsWith("def outer"));
});
test("decorated functions and methods keep their own name", () => {
  assert.ok(text("cached").includes("def cached"));
  assert.ok(text("A.B.m").includes("def m"));
});
test("async functions are listed", () => {
  assert.ok(text("fetch").includes("def fetch"));
});
test("lists exactly the module and every function", () => {
  assert.deepEqual([...scopes.keys()].sort(), ["<module>", "A.B.m", "Cart.add_item", "cached", "fetch", "outer", "outer.inner"]);
  for (const [key, scope] of scopes) assert.equal(scope.qualifiedName, key);
});
