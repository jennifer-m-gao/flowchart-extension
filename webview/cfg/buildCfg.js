// Pure control-flow-graph builder: Lezer Python scope -> { nodes, edges }.
// Only this module knows Lezer node names; the output is plain data (D5, D13).

const CLAUSE_KEYWORDS = new Set(["if", "elif", "else", "while", "for", "try", "except", "finally", "case"]);
const DEFINITIONS = new Set(["FunctionDefinition", "ClassDefinition", "DecoratedStatement"]);

function normalize(text) {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > 60 ? s.slice(0, 59) + "…" : s;
}

// Children of a Body/Script that are statements (skips ":", Comment, error nodes, keyword tokens).
function statements(parent) {
  const out = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.name === ":" || c.name === "Comment" || c.name === "⚠" || /^[a-z]/.test(c.name)) continue;
    out.push(c);
  }
  return out;
}

// Groups a compound statement's flat children into [{ kw, from, body }]; keywords without a Body are dropped.
function clauses(node) {
  const out = [];
  let kw = null;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (CLAUSE_KEYWORDS.has(c.name)) kw = c;
    else if (c.name === "Body" && kw) {
      out.push({ kw: kw.name, from: kw.from, body: c });
      kw = null;
    }
  }
  return out;
}

export function buildCfg(scopeNode, code) {
  let scope = scopeNode;
  if (scope.name === "DecoratedStatement") {
    scope = scope.getChild("FunctionDefinition") || scope.getChild("ClassDefinition") || scope;
  }
  if (scope.name !== "Script" && scope.name !== "FunctionDefinition") {
    throw new Error("buildCfg: unsupported scope " + scope.name);
  }

  const nodes = [];
  const byId = new Map();
  const edges = [];
  const edgeKeys = new Set();
  let counter = 0;

  function header(from, body) {
    return normalize(code.slice(from, body.from));
  }

  function addNode(kind, label, from, to, unreachable, id = "n" + counter++) {
    const n = { id, kind, label, from, to };
    if (unreachable) n.unreachable = true;
    nodes.push(n);
    byId.set(id, n);
    return id;
  }

  // Creates a node, unreachable when no pending source is reachable, and connects pending to it.
  function makeNode(kind, label, from, to, pending) {
    const id = addNode(kind, label, from, to, !pending.some(p => !byId.get(p.source).unreachable));
    connect(pending, id);
    return id;
  }

  function addEdge(source, target, label) {
    const key = source + "|" + target + "|" + (label || "");
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push(label ? { source, target, label } : { source, target });
  }

  function connect(pending, target) {
    for (const p of pending) addEdge(p.source, target, p.label);
  }

  function simple(node, pending) {
    const id = makeNode("statement", normalize(code.slice(node.from, node.to)), node.from, node.to, pending);
    return [{ source: id }];
  }

  function buildBody(parent, pending, ctx) {
    for (const child of statements(parent)) pending = dispatch(child, pending, ctx);
    return pending;
  }

  function dispatch(node, pending, ctx) {
    if (DEFINITIONS.has(node.name)) return buildDef(node, pending);
    switch (node.name) {
      case "IfStatement": return buildIf(node, pending, ctx);
      case "WhileStatement": return buildLoop(node, pending, ctx, "True", "False");
      case "ForStatement": return buildLoop(node, pending, ctx, "next", "done");
      case "BreakStatement":
      case "ContinueStatement": return buildJump(node, pending, ctx);
      case "ReturnStatement": return buildExit(node, pending, ctx, "return");
      case "RaiseStatement": return buildExit(node, pending, ctx, "raise");
      case "TryStatement": return buildTry(node, pending, ctx);
      case "WithStatement": return buildWith(node, pending, ctx);
      case "MatchStatement": return buildMatch(node, pending, ctx);
      default: return simple(node, pending);
    }
  }

  function buildDef(node, pending) {
    const def = node.name === "DecoratedStatement"
      ? node.getChild("FunctionDefinition") || node.getChild("ClassDefinition") || node
      : node;
    const body = def.getChild("Body");
    const label = normalize(code.slice(def.from, body ? body.from : def.to));
    return [{ source: makeNode("def", label, node.from, node.to, pending) }];
  }

  function buildIf(node, pending, ctx) {
    const cls = clauses(node);
    if (!cls.length) return simple(node, pending);
    const exits = [];
    let current = pending;
    for (const c of cls) {
      if (c.kw === "else") {
        exits.push(...buildBody(c.body, current, ctx));
        current = [];
      } else {
        const d = makeNode("decision", header(c.from, c.body), c.from, c.body.from, current);
        exits.push(...buildBody(c.body, [{ source: d, label: "True" }], ctx));
        current = [{ source: d, label: "False" }];
      }
    }
    return [...exits, ...current];
  }

  function buildLoop(node, pending, ctx, enterLabel, exitLabel) {
    const cls = clauses(node);
    if (!cls.length) return simple(node, pending);
    const loop = makeNode("loop", header(node.from, cls[0].body), node.from, cls[0].body.from, pending);
    const entry = { loopId: loop, breaks: [], frameDepth: ctx.frames.length };
    ctx.loops.push(entry);
    const bodyExits = buildBody(cls[0].body, [{ source: loop, label: enterLabel }], ctx);
    connect(bodyExits.map(e => ({ source: e.source, label: "loop" })), loop);
    ctx.loops.pop();
    let exits = [{ source: loop, label: exitLabel }];
    const elseClause = cls.find(c => c.kw === "else");
    if (elseClause) exits = buildBody(elseClause.body, exits, ctx);
    return [...exits, ...entry.breaks];
  }

  // Routes a break/continue/return/exception that leaves `source`: through the innermost
  // finally frame when one sits between here and the target, else straight to the target.
  function routeAbrupt(source, abrupt, ctx, viaFinally) {
    const frame = ctx.frames[ctx.frames.length - 1];
    const loop = abrupt.loop;
    if (frame && (!loop || ctx.frames.length > loop.frameDepth)) {
      addEdge(source, frame.finallyId);
      frame.abrupts.push(abrupt);
      return;
    }
    const label = viaFinally ? abrupt.kind : undefined;
    if (abrupt.kind === "break") loop.breaks.push(label ? { source, label } : { source });
    else if (abrupt.kind === "continue") addEdge(source, loop.loopId, label);
    else addEdge(source, "end", abrupt.kind === "exception" ? "exception" : label);
  }

  function buildJump(node, pending, ctx) {
    const kind = node.name === "BreakStatement" ? "break" : "continue";
    const id = makeNode(kind, normalize(code.slice(node.from, node.to)), node.from, node.to, pending);
    const loop = ctx.loops[ctx.loops.length - 1];
    if (loop) routeAbrupt(id, { kind, loop }, ctx, false);
    return [];
  }

  function buildExit(node, pending, ctx, kind) {
    const id = makeNode(kind, normalize(code.slice(node.from, node.to)), node.from, node.to, pending);
    routeAbrupt(id, { kind: kind === "raise" ? "exception" : "return" }, ctx, false);
    return [];
  }

  // Simplified try model:
  // - only one `exception` edge leaves the try node (not one per statement in the body);
  // - exceptions raised inside handlers/else/finally are modelled only through explicit `raise`;
  // - the type in `except E` is not used to choose among handlers.
  // Abrupt exits (return/raise/break/continue) inside a try with `finally` go to the finally
  // node and are re-routed from the end of the finally body to their real target.
  function buildTry(node, pending, ctx) {
    const cls = clauses(node);
    if (!cls.length || cls[0].kw !== "try") return simple(node, pending);
    const tryClause = cls[0];
    const tryId = makeNode("try", header(tryClause.from, tryClause.body), tryClause.from, tryClause.body.from, pending);
    const finClause = cls.find(c => c.kw === "finally");
    let frame = null;
    if (finClause) {
      // Created before the body so returns can target it; it runs whenever the try is reached.
      const finId = addNode("finally", header(finClause.from, finClause.body), finClause.from, finClause.body.from,
        byId.get(tryId).unreachable);
      frame = { finallyId: finId, abrupts: [] };
      ctx.frames.push(frame);
    }
    let bodyExits = buildBody(tryClause.body, [{ source: tryId }], ctx);
    const handlerExits = [];
    const handlers = cls.filter(c => c.kw === "except");
    for (const h of handlers) {
      const ex = makeNode("except", header(h.from, h.body), h.from, h.body.from, [{ source: tryId, label: "exception" }]);
      handlerExits.push(...buildBody(h.body, [{ source: ex }], ctx));
    }
    const elseClause = cls.find(c => c.kw === "else");
    if (elseClause) bodyExits = buildBody(elseClause.body, bodyExits, ctx);
    const normalExits = [...bodyExits, ...handlerExits];
    if (!frame) return normalExits;

    ctx.frames.pop();
    if (!handlers.length) {
      addEdge(tryId, frame.finallyId, "exception");
      frame.abrupts.push({ kind: "exception" });
    }
    connect(normalExits, frame.finallyId);
    const finExits = buildBody(finClause.body, [{ source: frame.finallyId }], ctx);
    const seen = new Set();
    for (const abrupt of frame.abrupts) {
      if (seen.has(abrupt.kind)) continue;
      seen.add(abrupt.kind);
      for (const e of finExits) routeAbrupt(e.source, abrupt, ctx, true);
    }
    return normalExits.length > 0 ? finExits.map(e => ({ source: e.source })) : [];
  }

  function buildWith(node, pending, ctx) {
    const body = node.getChild("Body");
    if (!body) return simple(node, pending);
    const id = makeNode("statement", header(node.from, body), node.from, body.from, pending);
    return buildBody(body, [{ source: id }], ctx);
  }

  function buildMatch(node, pending, ctx) {
    const matchBody = node.getChild("MatchBody");
    if (!matchBody) return simple(node, pending);
    const id = makeNode("statement", header(node.from, matchBody), node.from, matchBody.from, pending);
    const exits = [];
    let current = [{ source: id }];
    for (const clause of matchBody.getChildren("MatchClause")) {
      const body = clause.getChild("Body");
      if (!body) continue;
      const d = makeNode("decision", header(clause.from, body), clause.from, body.from, current);
      exits.push(...buildBody(body, [{ source: d, label: "True" }], ctx));
      current = [{ source: d, label: "False" }];
    }
    return [...exits, ...current];
  }

  const ctx = { loops: [], frames: [] };
  let pending;
  if (scope.name === "Script") {
    addNode("start", "Start", 0, 0, false, "start");
    pending = buildBody(scope, [{ source: "start" }], ctx);
  } else {
    const body = scope.getChild("Body");
    const headerTo = body ? body.from : scope.to;
    addNode("start", normalize(code.slice(scope.from, headerTo)), scope.from, headerTo, false, "start");
    pending = body ? buildBody(body, [{ source: "start" }], ctx) : [{ source: "start" }];
  }
  connect(pending, "end");
  nodes.push({ id: "end", kind: "end", label: "End", from: scopeNode.to, to: scopeNode.to });
  return { nodes, edges };
}
