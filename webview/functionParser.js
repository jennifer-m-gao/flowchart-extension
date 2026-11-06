import { PY_BUILTINS } from "./pyBuiltins.js";

const FUNCTION_DEFINITION = "FunctionDefinition";
const CLASS_DEFINITION = "ClassDefinition";
const CALL_EXPRESSION = "CallExpression";
const VARIABLE_NAME = "VariableName";
const MEMBER_EXPRESSION = "MemberExpression";
const PROPERTY_NAME = "PropertyName";
const DECORATED_STATEMENT = "DecoratedStatement";

export function functionGraph(tree, code, { hideBuiltins = false } = {}) {
  const functions = new Map();
  const classes = new Set(); // top-level class names

  findFunctions(tree.cursor(), code, functions, classes, []);

  const nodeIds = new Map([...functions.keys()].map((name, index) => [name, `function${index}`]));
  const externalIds = new Map();
  const edgeKeys = new Set();
  const edges = [];
  let nextId = nodeIds.size;

  for (const [caller, { calls, className }] of functions) {
    for (const calledName of calls) {
      let target;
      if (calledName.startsWith("self.")) {
        // self.m()/cls.m() resolve only to a method of the class directly enclosing the caller.
        const method = className && `${className}.${calledName.slice(5)}`;
        if (!method || !functions.has(method)) {
          continue;
        }
        target = nodeIds.get(method);
      } else if (classes.has(calledName) && functions.has(`${calledName}.__init__`)) {
        target = nodeIds.get(`${calledName}.__init__`);
      } else {
        // Bare calls only reach top-level defs; nested defs and methods are not callable by bare name.
        const local = functions.has(calledName) && !calledName.includes(".");
        if (!local && hideBuiltins && PY_BUILTINS.has(calledName) && !classes.has(calledName)) {
          continue; // user defs and classes named like a built-in are never hidden
        }
        target = local ? nodeIds.get(calledName) : externalIds.get(calledName);
      }
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

// scope: the enclosing defs and classes, as [{ name, kind: "class" | "function" }].
function findFunctions(cursor, code, functions, classes, scope) {
  let childScope = scope;

  if (cursor.name === FUNCTION_DEFINITION || cursor.name === CLASS_DEFINITION) {
    const isFunction = cursor.name === FUNCTION_DEFINITION;
    const name = findDefinitionName(cursor, code);
    if (name !== undefined) {
      childScope = [...scope, { name, kind: isFunction ? "function" : "class" }];
      if (isFunction) {
        const qualified = childScope.map((s) => s.name).join(".");
        const def = cursor.node;
        const from = def.parent?.name === DECORATED_STATEMENT ? def.parent.from : def.from;
        const className = scope.at(-1)?.kind === "class" ? scope.map((s) => s.name).join(".") : null;
        functions.set(qualified, { calls: new Set(), from, to: def.to, className });
        findCalls(cursor, code, qualified, functions);
      } else if (scope.length === 0) {
        classes.add(name);
      }
    }
  }

  if (cursor.firstChild()) {
    do {
      findFunctions(cursor, code, functions, classes, childScope);
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
    if (cursor.name === MEMBER_EXPRESSION) {
      const method = selfMethodName(cursor, code);
      if (method) {
        calls.add(`self.${method}`); // "." never appears in a bare name, so this cannot clash
      }
    } else {
      do {
        if (cursor.name === VARIABLE_NAME) {
          calls.add(code.slice(cursor.from, cursor.to));
          break;
        }
      } while (cursor.nextSibling());
    }
    cursor.parent();
  }

  if (cursor.firstChild()) {
    do {
      collectCalls(cursor, code, calls);
    } while (cursor.nextSibling());
    cursor.parent();
  }
}

// "m" for self.m / cls.m, else null. Leaves the cursor where it found it.
function selfMethodName(cursor, code) {
  if (!cursor.firstChild()) {
    return null;
  }
  let method = null;
  const receiver = cursor.name === VARIABLE_NAME ? code.slice(cursor.from, cursor.to) : "";
  if (receiver === "self" || receiver === "cls") {
    while (cursor.nextSibling() && cursor.name !== PROPERTY_NAME) {
      // skip the "." token
    }
    if (cursor.name === PROPERTY_NAME) {
      method = code.slice(cursor.from, cursor.to);
    }
  }
  cursor.parent();
  return method;
}
