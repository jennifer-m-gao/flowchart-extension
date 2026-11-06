import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SCALE, MIN_SCALE, fit, identity, panBy, toTransform, zoomAt } from "../../webview/interact/viewport.js";

const toContent = (v, px, py) => [(px - v.tx) / v.scale, (py - v.ty) / v.scale];

test("identity", () => {
  assert.deepEqual(identity(), { scale: 1, tx: 0, ty: 0 });
});

test("zoomAt keeps the content point under the pointer fixed", () => {
  const v = { scale: 1.5, tx: 30, ty: -20 };
  for (const factor of [1.2, 0.5, 2]) {
    const z = zoomAt(v, factor, 120, 80);
    const [bx, by] = toContent(v, 120, 80);
    const [ax, ay] = toContent(z, 120, 80);
    assert.ok(Math.abs(ax - bx) < 1e-9 && Math.abs(ay - by) < 1e-9);
    assert.ok(Math.abs(z.scale - v.scale * factor) < 1e-9);
  }
});

test("zoomAt clamps at both ends", () => {
  assert.equal(zoomAt(identity(), 100, 0, 0).scale, MAX_SCALE);
  assert.equal(zoomAt(identity(), 0.001, 0, 0).scale, MIN_SCALE);
  const pinned = zoomAt({ scale: MAX_SCALE, tx: 5, ty: 7 }, 2, 50, 50);
  assert.deepEqual(pinned, { scale: MAX_SCALE, tx: 5, ty: 7 });
});

test("panBy is additive", () => {
  const v = panBy(panBy({ scale: 2, tx: 1, ty: 2 }, 10, -5), 3, 4);
  assert.deepEqual(v, { scale: 2, tx: 14, ty: 1 });
});

test("fit centres a small graph at scale 1", () => {
  assert.deepEqual(fit(100, 50, 400, 300), { scale: 1, tx: 150, ty: 125 });
});

test("fit shrinks a large graph to the view minus padding, centred", () => {
  assert.deepEqual(fit(1000, 200, 532, 400), { scale: 0.5, tx: 16, ty: 150 });
});

test("fit never goes below MIN_SCALE and tolerates empty sizes", () => {
  assert.equal(fit(100000, 100, 400, 300).scale, MIN_SCALE);
  assert.deepEqual(fit(0, 0, 400, 300), { scale: 1, tx: 200, ty: 150 });
});

test("toTransform formats", () => {
  assert.equal(toTransform({ scale: 0.5, tx: 10, ty: -3 }), "translate(10,-3) scale(0.5)");
});
