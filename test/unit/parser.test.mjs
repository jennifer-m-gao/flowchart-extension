import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { parseCode } from "../../webview/parser.js";

function timeline(source) {
  return parseCode(parser.parse(source), source);
}

test("empty source links Start directly to End", () => {
  const out = timeline("");
  assert.match(out, /^flowchart LR\n/);
  assert.ok(out.includes('start(["Start"])'));
  assert.ok(out.includes('endNode(["End"])'));
  assert.ok(out.includes("start --> endNode"));
  assert.ok(!out.includes("n0"));
});

test("statements are chained in order", () => {
  const out = timeline("x = 1\ny = 2\nreturn_value = x\n");
  for (const s of [
    'n0["x = 1"]',
    'n1["y = 2"]',
    'n2["return_value = x"]',
    "start --> n0",
    "n0 --> n1",
    "n1 --> n2",
    "n2 --> endNode",
  ]) {
    assert.ok(out.includes(s), s);
  }
});

test("double quotes are escaped", () => {
  assert.ok(timeline('s = "hi"\n').includes('n0["s = #quot;hi#quot;"]'));
});

test("function with repeated calls (whole output)", () => {
  assert.equal(
    timeline("def a():\n  b()\n  b()\n"),
    'flowchart LR\n    start(["Start"])\n    n0["b()"]\n    n1["b()"]\n    endNode(["End"])\n    start --> n0\n    n0 --> n1\n    n1 --> endNode\n'
  );
});

test.todo("1.1 CFG: compound statements (if/for/while) emit only their header line, not the whole body");
test.todo("1.1 CFG: statements nested in if/for/while bodies are not duplicated");
test.todo("1.1 CFG: augmented assignment (x += 1, UpdateStatement) appears in the timeline");

test("< and > in labels are escaped as #lt; / #gt;", () => {
  const out = timeline("x = a < b > c\n");
  assert.ok(out.includes('n0["x = a #lt; b #gt; c"]'));
  const line = out.split("\n").find((l) => l.includes("n0["));
  assert.ok(!/[<>]/.test(line));
});
