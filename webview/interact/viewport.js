// Screen = content * scale + (tx, ty). All functions return a new view.
export const MIN_SCALE = 0.2, MAX_SCALE = 4;

const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

export function identity() {
  return { scale: 1, tx: 0, ty: 0 };
}

export function zoomAt(v, factor, px, py) {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return { scale, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k };
}

export function panBy(v, dx, dy) {
  return { scale: v.scale, tx: v.tx + dx, ty: v.ty + dy };
}

export function fit(contentW, contentH, viewW, viewH, padding = 16) {
  const scale = clampScale(Math.min(
    1,
    contentW > 0 ? (viewW - 2 * padding) / contentW : 1,
    contentH > 0 ? (viewH - 2 * padding) / contentH : 1,
  ));
  return { scale, tx: (viewW - contentW * scale) / 2, ty: (viewH - contentH * scale) / 2 };
}

export function toTransform(v) {
  return `translate(${v.tx},${v.ty}) scale(${v.scale})`;
}
