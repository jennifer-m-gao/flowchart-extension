import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { findScope } from "../../webview/cfg/findScope.js";
import { migrateMode, renderAction, scopeKey, shouldRender } from "../../webview/viewState.js";

test("migrateMode", () => {
  assert.equal(migrateMode("timeline"), "flow");
  assert.equal(migrateMode("flow"), "flow");
  assert.equal(migrateMode("functions"), "functions");
  assert.equal(migrateMode(undefined), "flow");
  assert.equal(migrateMode("bogus"), "flow");
});

const base = { code: "x", viewKind: "flow", follow: true, scopeKey: "a" };

test("shouldRender", () => {
  assert.equal(shouldRender(null, base), true);
  assert.equal(shouldRender(base, { ...base }), false);
  assert.equal(shouldRender(base, { ...base, code: "y" }), true);
  assert.equal(shouldRender(base, { ...base, follow: false }), true);
  assert.equal(shouldRender(base, { ...base, viewKind: "functions" }), true);
  assert.equal(shouldRender(base, { ...base, scopeKey: "b" }), true);
  const f = { ...base, viewKind: "functions" };
  assert.equal(shouldRender(f, { ...f, scopeKey: "b" }), false);
});

test("renderAction", () => {
  const other = { ...base, scopeKey: "b" };
  // Cursor move within the shown scope, nothing rendering: highlight only.
  assert.equal(renderAction(base, null, { ...base }), "highlight");
  // Cursor moved back to the shown scope while another scope renders: drop that render.
  assert.equal(renderAction(base, other, { ...base }), "cancel-and-highlight");
  // Cursor moves within the scope already rendering: let it finish.
  assert.equal(renderAction(base, other, { ...other }), "wait");
  assert.equal(renderAction(null, base, { ...base }), "wait");
  // Something new is wanted.
  assert.equal(renderAction(base, null, other), "render");
  assert.equal(renderAction(null, null, base), "render");
  assert.equal(renderAction(base, other, { ...base, code: "y" }), "render");
});

test("scopeKey from findScope", () => {
  const code = "def a():\n  x = 1\ndef b():\n  y = 2\n";
  const tree = parser.parse(code);
  const k = (o) => scopeKey(findScope(tree, code, o));
  assert.notEqual(k(12), k(30));
  assert.equal(k(12), k(14));
});
