const FUNCTION_DEFINITION = "FunctionDefinition";
const CLASS_DEFINITION = "ClassDefinition";
const CALL_EXPRESSION = "CallExpression";
const VARIABLE_NAME = "VariableName";
const DECORATED_STATEMENT = "DecoratedStatement";

export function functionGraph(tree, code) {
  const functions = new Map();

  findFunctions(tree.cursor(), code, functions, []);

  const nodeIds = new Map([...functions.keys()].map((name, index) => [name, `function${index}`]));
  const externalIds = new Map();
  const edgeKeys = new Set();
  const edges = [];
  let nextId = nodeIds.size;

  for (const [caller, { calls }] of functions) {
    for (const calledName of calls) {
      // Bare calls only reach top-level defs; nested defs and methods are not callable by bare name.
      let target = functions.has(calledName) && !calledName.includes(".") ? nodeIds.get(calledName) : externalIds.get(calledName);
      if (target === undefined) {
        target = `external${nextId++}`;
        externalIds.set(calledName, target);
      }
      const source = nodeIds.get(caller);
      const key = `${source} --> ${target}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push({ source, target });
      }
    }
  }

  const nodes = [
    ...[...nodeIds].map(([name, id]) => ({ id, kind: "function", label: name, from: functions.get(name).from, to: functions.get(name).to })),
    ...[...externalIds].map(([name, id]) => ({ id, kind: "external", label: name, from: null, to: null })),
  ];

  return { nodes, edges };
}

function findFunctions(cursor, code, functions, scope) {
  let childScope = scope;

  if (cursor.name === FUNCTION_DEFINITION || cursor.name === CLASS_DEFINITION) {
    const isFunction = cursor.name === FUNCTION_DEFINITION;
    const name = findDefinitionName(cursor, code);
    if (name !== undefined) {
      childScope = [...scope, name];
      if (isFunction) {
        const qualified = childScope.join(".");
        const def = cursor.node;
        const from = def.parent?.name === DECORATED_STATEMENT ? def.parent.from : def.from;
        functions.set(qualified, { calls: new Set(), from, to: def.to });
        findCalls(cursor, code, qualified, functions);
      }
    }
  }

  if (cursor.firstChild()) {
    do {
      findFunctions(cursor, code, functions, childScope);
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

// Scans only the function's own children: nested defs/classes are scanned on their own.
function findCalls(cursor, code, currentFunction, functions) {
  if (cursor.firstChild()) {
    do {
      collectCalls(cursor, code, functions.get(currentFunction).calls);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}

function collectCalls(cursor, code, calls) {
  if (cursor.name === FUNCTION_DEFINITION || cursor.name === CLASS_DEFINITION) {
    return;
  }

  if (cursor.name === CALL_EXPRESSION && cursor.firstChild()) {
    do {
      if (cursor.name === VARIABLE_NAME) {
        calls.add(code.slice(cursor.from, cursor.to));
        break;
      }
    } while (cursor.nextSibling());
    cursor.parent();
  }

  if (cursor.firstChild()) {
    do {
      collectCalls(cursor, code, calls);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}
