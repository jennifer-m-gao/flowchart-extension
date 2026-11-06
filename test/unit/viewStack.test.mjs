import test from "node:test";
import assert from "node:assert/strict";
import { createViewStack } from "../../webview/viewStack.js";

test("push, pop, replace and depth", () => {
  const s = createViewStack({ kind: "flow", follow: true });
  assert.equal(s.depth(), 1);
  s.push({ kind: "functions" });
  assert.equal(s.depth(), 2);
  assert.equal(s.current().kind, "functions");
  s.replace({ kind: "flow", follow: false });
  assert.equal(s.current().follow, false);
  assert.deepEqual(s.pop(), { kind: "flow", follow: true });
  assert.equal(s.depth(), 1);
});

test("pop at depth 1 keeps the view", () => {
  const s = createViewStack({ kind: "functions" });
  assert.deepEqual(s.pop(), { kind: "functions" });
  assert.equal(s.depth(), 1);
});
