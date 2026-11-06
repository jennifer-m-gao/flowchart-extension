import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { buildCfg } from "../../webview/cfg/buildCfg.js";
import { findScope } from "../../webview/cfg/findScope.js";
import { normalizeQualname, lineStarts, mapStepToNode, scopeForStep } from "../../webview/run/mapTrace.js";

// Graph of the scope that contains `marker` (or the module), plus the code it was built from.
function graphAt(code, marker) {
  const tree = parser.parse(code);
  const scope = marker ? findScope(tree, code, code.indexOf(marker)) : { node: tree.topNode };
  return buildCfg(scope.node, code);
}
// [kind, label] of the node mapped for a 1-based line.
function at(code, line, marker) {
  const n = mapStepToNode(graphAt(code, marker), code, line, lineStarts(code));
  return n && [n.kind, n.label];
}

const LOOP = [
  "def classify(scores):",          // 1
  "    for s in scores:",           // 2
  "        if s < 0:",              // 3
  "            continue",           // 4
  "        elif s > 100:",          // 5
  "            break",              // 6
  "        try:",                   // 7
  "            total = s + 1",      // 8
  "        except ValueError as e:", // 9
  "            print(e)",           // 10
  "    return s",                   // 11
  "",
].join("\n");

test("for header maps to the loop node", () => {
  assert.deepEqual(at(LOOP, 2, "for"), ["loop", "for s in scores"]);
});
test("if and elif lines map to their own decisions", () => {
  assert.deepEqual(at(LOOP, 3, "for"), ["decision", "if s < 0"]);
  assert.deepEqual(at(LOOP, 5, "for"), ["decision", "elif s > 100"]);
});
test("except line maps to the except node", () => {
  assert.deepEqual(at(LOOP, 9, "for"), ["except", "except ValueError as e"]);
});
test("body statements map to their statement, break, continue and return nodes", () => {
  assert.deepEqual(at(LOOP, 8, "for"), ["statement", "total = s + 1"]);
  assert.equal(at(LOOP, 4, "for")[0], "continue");
  assert.equal(at(LOOP, 6, "for")[0], "break");
  assert.equal(at(LOOP, 11, "for")[0], "return");
});
test("a multi-statement line maps to the first node on it", () => {
  // buildCfg keeps "a = 1; b = 2" as one statement node
  assert.deepEqual(at("a = 1; b = 2\n", 1), ["statement", "a = 1; b = 2"]);
  assert.deepEqual(at("x = 0\nif x: y = 1\n", 2), ["decision", "if x"]);
});
test("a continuation line maps to the statement spanning it", () => {
  assert.deepEqual(at("x = f(1,\n      2)\ny = 3\n", 2), ["statement", "x = f(1, 2)"]);
});
test("lines without a node, or out of range, map to null", () => {
  const code = "x = 1\n\n# note\ny = 2\n";
  assert.equal(at(code, 2), null);
  assert.equal(at(code, 3), null);
  assert.equal(at(code, 99), null);
});
test("CRLF code maps to the same nodes as LF", () => {
  const crlf = LOOP.replace(/\n/g, "\r\n");
  for (let line = 1; line <= 11; line++) {
    assert.deepEqual(at(crlf, line, "for"), at(LOOP, line, "for"), `line ${line}`);
  }
  assert.deepEqual(lineStarts("a\r\nb\nc"), [0, 3, 5]);
});
test("normalizeQualname drops <locals>", () => {
  assert.equal(normalizeQualname("A.m.<locals>.inner"), "A.m.inner");
  assert.equal(normalizeQualname("<module>"), "<module>");
});
test("scopeForStep resolves lambdas, class bodies, methods and nested functions", () => {
  const scopes = new Map(["<module>", "outer", "outer.inner", "Cart.add_item"].map(q => [q, { q }]));
  assert.equal(scopeForStep("outer.<locals>.<lambda>", scopes).q, "outer");
  assert.equal(scopeForStep("outer.<locals>.inner", scopes).q, "outer.inner");
  assert.equal(scopeForStep("Cart", scopes).q, "<module>");
  assert.equal(scopeForStep("Cart.add_item", scopes).q, "Cart.add_item");
  assert.equal(scopeForStep("<module>", scopes).q, "<module>");
  assert.equal(scopeForStep("<lambda>", scopes).q, "<module>");
  assert.equal(scopeForStep("outer.<locals>.<genexpr>", scopes).q, "outer");
  assert.equal(scopeForStep("outer.<locals>.K.m", scopes).q, "outer");
});
test("scope names from findScope match normalized tracer qualnames", () => {
  const code = "class Cart:\n  def add_item(self):\n    pass\ndef outer():\n  def inner():\n    pass\n";
  const tree = parser.parse(code);
  const scopes = new Map();
  for (const offset of [0, code.indexOf("pass"), code.lastIndexOf("pass")]) {
    const s = findScope(tree, code, offset);
    scopes.set(s.qualifiedName, s);
  }
  assert.deepEqual([...scopes.keys()], ["<module>", "Cart.add_item", "outer.inner"]);
  assert.equal(scopeForStep("Cart.add_item", scopes).qualifiedName, "Cart.add_item");
  assert.equal(scopeForStep("outer.<locals>.inner", scopes).qualifiedName, "outer.inner");
});
