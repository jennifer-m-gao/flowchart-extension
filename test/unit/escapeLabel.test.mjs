import test from "node:test";
import assert from "node:assert/strict";
import { escapeLabel } from "../../webview/escapeLabel.js";

test("plain text is unchanged", () => {
  assert.equal(escapeLabel("plain"), "plain");
});

for (const [input, expected] of [
  ["&", "#amp;"],
  ['"', "#quot;"],
  ["<", "#lt;"],
  [">", "#gt;"],
  ["\n", "#10;"],
]) {
  test(`escapes ${JSON.stringify(input)}`, () => {
    assert.equal(escapeLabel(input), expected);
  });
}

test("ampersand is escaped first, so entities are not double-decoded", () => {
  assert.equal(escapeLabel("&lt;"), "#amp;lt;");
});
