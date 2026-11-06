const hasSpan = (n) => typeof n.from === "number" && typeof n.to === "number" && n.to > n.from;

// Id of the graph node the cursor is in: the smallest enclosing span, else the first node starting on the cursor's line.
export function nodeAtOffset(nodes, offset, code) {
  let best = null;
  for (const n of nodes) {
    if (hasSpan(n) && n.from <= offset && offset < n.to && (!best || n.to - n.from <= best.to - best.from)) {
      best = n;
    }
  }
  if (best) {
    return best.id;
  }

  const lineStart = code.lastIndexOf("\n", offset - 1) + 1;
  const newline = code.indexOf("\n", offset);
  const lineEnd = newline === -1 ? code.length : newline;
  for (const n of nodes) {
    if (hasSpan(n) && n.from >= lineStart && n.from < lineEnd && (!best || n.from < best.from)) {
      best = n;
    }
  }
  return best ? best.id : null;
}
