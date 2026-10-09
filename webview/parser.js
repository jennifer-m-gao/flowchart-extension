const STATEMENT_TYPES = new Set([
  "AssignStatement",
  "AugAssignStatement",
  "ReturnStatement",
  "ExpressionStatement",
  "IfStatement",
  "ForStatement",
  "WhileStatement",
  "WithStatement",
  "TryStatement",
  "RaiseStatement",
  "AssertStatement",
  "DeleteStatement",
  "ImportStatement",
  "ImportFromStatement",
  "PassStatement",
  "BreakStatement",
  "ContinueStatement"
]);

export function parseCode(tree, code) {
  const nodes = [];

  function visit(node) {
    if (STATEMENT_TYPES.has(node.name)) {
      nodes.push(code.slice(node.from, node.to).trim());
    }

    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child);
    }
  }

  visit(tree.topNode);

  let mermaidCode = "flowchart LR\n    start([\"Start\"])\n";

  nodes.forEach((text, index) => {
    mermaidCode += `    n${index}["${escapeLabel(text)}"]\n`;
  });
  mermaidCode += "    endNode([\"End\"])\n";

  if (nodes.length === 0) {
    mermaidCode += "    start --> endNode\n";
  } else {
    mermaidCode += "    start --> n0\n";
    for (let index = 0; index < nodes.length - 1; index++) {
      mermaidCode += `    n${index} --> n${index + 1}\n`;
    }
    mermaidCode += `    n${nodes.length - 1} --> endNode\n`;
  }

  return mermaidCode;
}

function escapeLabel(label) {
  return label
    .replace(/&/g, "#amp;")
    .replace(/"/g, "#quot;")
    .replace(/\n/g, "#10;");
}
