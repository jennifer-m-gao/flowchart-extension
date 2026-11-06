const clamp = (n, max) => Math.max(0, Math.min(n, max));

// Editor range for a clicked node: select a single-line node, put the caret at the start of a multi-line one.
export function revealRange(code, from, to) {
  let a = clamp(from, code.length);
  let b = clamp(to, code.length);
  if (a > b) {
    [a, b] = [b, a];
  }
  const text = code.slice(a, b).replace(/\r?\n$/, "");
  return text.includes("\n") ? { from: a, to: a } : { from: a, to: b };
}
