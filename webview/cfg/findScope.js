// Finds the innermost function containing `offset`, or the module scope.
export function findScope(tree, code, offset) {
  let best = null;
  let bestStart = -1;
  tree.iterate({
    enter(ref) {
      if (ref.name !== "FunctionDefinition") return;
      const node = ref.node;
      const start = node.parent?.name === "DecoratedStatement" ? node.parent.from : node.from;
      const end = node.to;
      const inside = (start <= offset && offset < end) || (offset === end && code[end - 1] !== "\n");
      if (inside && start > bestStart) {
        best = node;
        bestStart = start;
      }
    },
  });

  if (!best) return { node: tree.topNode, kind: "module", name: "<module>", qualifiedName: "<module>" };

  const nameOf = (n) => {
    const v = n.getChild("VariableName");
    return v ? code.slice(v.from, v.to) : "?";
  };
  const parts = [];
  for (let n = best.parent; n; n = n.parent) {
    if (n.name === "FunctionDefinition" || n.name === "ClassDefinition") parts.unshift(nameOf(n));
  }
  const name = nameOf(best);
  return { node: best, kind: "function", name, qualifiedName: [...parts, name].join(".") };
}
