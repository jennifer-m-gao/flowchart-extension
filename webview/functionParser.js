const FUNCTION_DEFINITION = "FunctionDefinition";
const CALL_EXPRESSION = "CallExpression";
const VARIABLE_NAME = "VariableName";

export function parseFunctions(tree, code) {
  const functions = new Map();

  findFunctions(tree.cursor(), code, functions);

  const names = [...functions.keys()];
  const nodeIds = new Map(names.map((name, index) => [name, `function${index}`]));
  const calledNames = new Set();
  let mermaidCode = "flowchart TD\n";

  for (const calls of functions.values()) {
    for (const calledName of calls) {
      calledNames.add(calledName);
    }
  }

  for (const name of calledNames) {
    if (!nodeIds.has(name)) {
      nodeIds.set(name, `external${nodeIds.size}`);
    }
  }

  for (const [name, id] of nodeIds) {
    mermaidCode += `    ${id}["${escapeLabel(name)}"]\n`;
  }

  for (const [name, calls] of functions) {
    for (const calledName of calls) {
      mermaidCode += `    ${nodeIds.get(name)} --> ${nodeIds.get(calledName)}\n`;
    }
  }

  return mermaidCode;
}

function findFunctions(cursor, code, functions) {
  if (cursor.name === FUNCTION_DEFINITION) {
    const functionName = findDefinitionName(cursor, code);
    if (functionName !== undefined) {
      functions.set(functionName, []);
      findCalls(cursor, code, functionName, functions);
    }
  }

  if (cursor.firstChild()) {
    do {
      findFunctions(cursor, code, functions);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}

function findDefinitionName(cursor, code) {
  if (!cursor.firstChild()) {
    return undefined;
  }

  do {
    if (cursor.name === VARIABLE_NAME) {
      const name = code.slice(cursor.from, cursor.to);
      cursor.parent();
      return name;
    }
  } while (cursor.nextSibling());

  cursor.parent();
  return undefined;
}

function findCalls(cursor, code, currentFunction, functions) {
  if (cursor.name === CALL_EXPRESSION && cursor.firstChild()) {
    do {
      if (cursor.name === VARIABLE_NAME) {
        functions.get(currentFunction).push(code.slice(cursor.from, cursor.to));
        break;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (cursor.firstChild()) {
    do {
      findCalls(cursor, code, currentFunction, functions);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}

function escapeLabel(label) {
  return label.replace(/&/g, "#amp;").replace(/"/g, "#quot;");
}
