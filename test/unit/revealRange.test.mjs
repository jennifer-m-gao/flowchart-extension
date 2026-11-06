import test from "node:test";
import assert from "node:assert/strict";
import { revealRange } from "../../webview/interact/revealRange.js";

const CODE = "x = 1\ndef f():\n    pass\n";

test("single-line statement is selected unchanged", () => {
  assert.deepEqual(revealRange(CODE, 0, 5), { from: 0, to: 5 });
});

test("a single line plus its trailing newline is still a selection", () => {
  assert.deepEqual(revealRange(CODE, 0, 6), { from: 0, to: 6 });
  assert.deepEqual(revealRange("x = 1\r\n", 0, 7), { from: 0, to: 7 });
});

test("multi-line def becomes a caret at its start", () => {
  const from = CODE.indexOf("def");
  assert.deepEqual(revealRange(CODE, from, CODE.length), { from, to: from });
});

test("out-of-range values are clamped", () => {
  assert.deepEqual(revealRange("abc", -5, 99), { from: 0, to: 3 });
});

test("from > to is swapped", () => {
  assert.deepEqual(revealRange(CODE, 5, 0), { from: 0, to: 5 });
});
