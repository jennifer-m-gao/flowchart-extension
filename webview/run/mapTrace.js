// Pure mapping from tracer events (python/tracer.py, format v1) to PyChart graph nodes.
// `call` events map to the scope's start node and `return` events to its end node.

// "A.m.<locals>.inner" -> "A.m.inner"; "<module>" stays.
export function normalizeQualname(q) {
  return q.split(".").filter(p => p !== "<locals>").join(".");
}

// Offset of each line start; line N (1-based) starts at result[N - 1]. "\r\n" ends a line at the "\n".
export function lineStarts(code) {
  const starts = [0];
  for (let i = code.indexOf("\n"); i !== -1; i = code.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

// The node a 1-based `line` belongs to: the node starting first on that line, else the
// smallest node spanning the line start (a continuation line), else null.
export function mapStepToNode(graph, code, line, starts) {
  const lineStart = starts[line - 1];
  if (lineStart === undefined) return null;
  const lineEnd = line < starts.length ? starts[line] : code.length + 1;
  let onLine = null;
  let spanning = null;
  for (const n of graph.nodes) {
    if (n.kind === "start" || n.kind === "end") continue;
    if (n.from >= lineStart && n.from < lineEnd) {
      if (!onLine || n.from < onLine.from) onLine = n;
    } else if (n.from <= lineStart && lineStart < n.to) {
      if (!spanning || n.to - n.from < spanning.to - spanning.from) spanning = n;
    }
  }
  return onLine || spanning;
}

// scopes: Map<findScope qualifiedName, scopeInfo>. Lambdas, generator expressions and
// pre-3.12 comprehension frames ("<...>") belong to their parent; unknown names such as
// class bodies walk up ("A.b.c" -> "A.b" -> "A") and end at "<module>".
export function scopeForStep(qualname, scopes) {
  const parts = normalizeQualname(qualname).split(".");
  while (parts.length && parts[parts.length - 1].startsWith("<")) parts.pop();
  for (; parts.length; parts.pop()) {
    const scope = scopes.get(parts.join("."));
    if (scope) return scope;
  }
  return scopes.get("<module>");
}
