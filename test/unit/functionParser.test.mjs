import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { parseFunctions } from "../../webview/functionParser.js";

function functions(source) {
  return parseFunctions(parser.parse(source), source);
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
    'flowchart TD\n    function0["a"]\n    external1["b"]\n    function0 --> external1\n    function0 --> external1\n'
  );
});

test.todo("plan 006: repeated calls produce a single edge");
test.todo("plan 006: same-named methods in different classes are separate nodes");
test.todo("plan 006: calls inside a nested function are not attributed to the outer function");

test("functions mode uses the shared escaper", () => {
  const src = readFileSync(new URL("../../webview/functionParser.js", import.meta.url), "utf8");
  assert.match(src, /from "\.\/escapeLabel\.js"/);
});
