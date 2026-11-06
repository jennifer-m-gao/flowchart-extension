import test from "node:test";
import assert from "node:assert/strict";
import { parser } from "@lezer/python";
import { buildCfg } from "../../webview/cfg/buildCfg.js";

function moduleCfg(src) {
  return buildCfg(parser.parse(src).topNode, src);
}
function functionCfg(src) {
  const tree = parser.parse(src);
  const fn = tree.topNode.getChild("FunctionDefinition");
  return buildCfg(fn, src);
}
function edges(cfg) {
  const label = new Map(cfg.nodes.map(n => [n.id, n.label]));
  return cfg.edges
    .map(e => `${label.get(e.source)} ${e.label ? `-${e.label}->` : "->"} ${label.get(e.target)}`)
    .sort();
}
function node(cfg, lbl) {
  return cfg.nodes.find(n => n.label === lbl);
}

test("E1 sequence chains statements", () => {
  const src = "x = 1\ny = 2\n";
  const cfg = moduleCfg(src);
  assert.deepEqual(edges(cfg), ["Start -> x = 1", "x = 1 -> y = 2", "y = 2 -> End"].sort());
  const x = node(cfg, "x = 1");
  assert.equal(src.slice(x.from, x.to), "x = 1");
  assert.equal(x.kind, "statement");
  assert.ok(cfg.nodes.every(n => !("unreachable" in n)));
  assert.deepEqual(cfg.nodes.map(n => n.id), ["start", "n0", "n1", "end"]);
  assert.deepEqual(node(cfg, "Start"), { id: "start", kind: "start", label: "Start", from: 0, to: 0 });
  assert.deepEqual(node(cfg, "End"), { id: "end", kind: "end", label: "End", from: src.length, to: src.length });
});

test("E2 if/elif/else", () => {
  const src = "if a:\n  x = 1\nelif b:\n  x = 2\nelse:\n  x = 3\ny = 0\n";
  const cfg = moduleCfg(src);
  assert.deepEqual(edges(cfg), [
    "Start -> if a",
    "if a -True-> x = 1",
    "if a -False-> elif b",
    "elif b -True-> x = 2",
    "elif b -False-> x = 3",
    "x = 1 -> y = 0",
    "x = 2 -> y = 0",
    "x = 3 -> y = 0",
    "y = 0 -> End",
  ].sort());
  const ifA = node(cfg, "if a");
  assert.equal(ifA.kind, "decision");
  assert.equal(node(cfg, "elif b").kind, "decision");
  assert.equal(src.slice(ifA.from, ifA.to), "if a");
  const elif = node(cfg, "elif b");
  assert.equal(src.slice(elif.from, elif.to), "elif b");
});

test("E3 if without else falls through on False", () => {
  const cfg = moduleCfg("if a:\n  x = 1\ny = 0\n");
  assert.deepEqual(edges(cfg), [
    "Start -> if a",
    "if a -True-> x = 1",
    "if a -False-> y = 0",
    "x = 1 -> y = 0",
    "y = 0 -> End",
  ].sort());
});

test("E4 while/else with break inside an if", () => {
  const src = "while a:\n  if b:\n    break\n  x = 1\nelse:\n  y = 2\nz = 3\n";
  const cfg = moduleCfg(src);
  assert.deepEqual(edges(cfg), [
    "Start -> while a",
    "while a -True-> if b",
    "if b -True-> break",
    "if b -False-> x = 1",
    "x = 1 -loop-> while a",
    "while a -False-> y = 2",
    "y = 2 -> z = 3",
    "break -> z = 3",
    "z = 3 -> End",
  ].sort());
  const loop = node(cfg, "while a");
  assert.equal(loop.kind, "loop");
  assert.equal(src.slice(loop.from, loop.to), "while a");
  assert.equal(node(cfg, "break").kind, "break");
});

test("E5 for/else with continue inside an if", () => {
  const cfg = moduleCfg("for x in xs:\n  if x:\n    continue\n  y = x\nelse:\n  z = 1\n");
  assert.deepEqual(edges(cfg), [
    "Start -> for x in xs",
    "for x in xs -next-> if x",
    "if x -True-> continue",
    "continue -> for x in xs",
    "if x -False-> y = x",
    "y = x -loop-> for x in xs",
    "for x in xs -done-> z = 1",
    "z = 1 -> End",
  ].sort());
  assert.equal(node(cfg, "for x in xs").kind, "loop");
  assert.equal(node(cfg, "continue").kind, "continue");
});

test("E6 function scope with return and unreachable code", () => {
  const src = "def f(a):\n  if a:\n    return 1\n  return 2\n  x = 3\n";
  const cfg = functionCfg(src);
  assert.deepEqual(edges(cfg), [
    "def f(a) -> if a",
    "if a -True-> return 1",
    "return 1 -> End",
    "if a -False-> return 2",
    "return 2 -> End",
    "x = 3 -> End",
  ].sort());
  assert.equal(node(cfg, "x = 3").unreachable, true);
  assert.ok(!("unreachable" in node(cfg, "return 2")));
  const start = node(cfg, "def f(a)");
  assert.equal(start.kind, "start");
  assert.equal(start.id, "start");
  assert.equal(src.slice(start.from, start.to), "def f(a)");
  assert.equal(node(cfg, "return 1").kind, "return");
  assert.equal(node(cfg, "End").to, src.length);
});

test("E7 raise goes to End as an exception", () => {
  const cfg = functionCfg("def g():\n  raise ValueError(1)\n");
  assert.deepEqual(edges(cfg), [
    "def g() -> raise ValueError(1)",
    "raise ValueError(1) -exception-> End",
  ].sort());
  assert.equal(node(cfg, "raise ValueError(1)").kind, "raise");
});

test("E8 full try/except/else/finally", () => {
  const src = "try:\n  a()\nexcept E as e:\n  b()\nexcept:\n  c()\nelse:\n  d()\nfinally:\n  f()\ng()\n";
  const cfg = moduleCfg(src);
  assert.deepEqual(edges(cfg), [
    "Start -> try",
    "try -> a()",
    "try -exception-> except E as e",
    "except E as e -> b()",
    "try -exception-> except",
    "except -> c()",
    "a() -> d()",
    "d() -> finally",
    "b() -> finally",
    "c() -> finally",
    "finally -> f()",
    "f() -> g()",
    "g() -> End",
  ].sort());
  assert.equal(node(cfg, "try").kind, "try");
  assert.equal(node(cfg, "except E as e").kind, "except");
  assert.equal(node(cfg, "except").kind, "except");
  const fin = node(cfg, "finally");
  assert.equal(fin.kind, "finally");
  assert.equal(src.slice(fin.from, fin.to), "finally");
  const handler = node(cfg, "except E as e");
  assert.equal(src.slice(handler.from, handler.to), "except E as e");
});

test("E9 return inside try/finally", () => {
  const cfg = functionCfg("def h():\n  try:\n    return 1\n  finally:\n    cleanup()\n  x = 2\n");
  assert.deepEqual(edges(cfg), [
    "def h() -> try",
    "try -> return 1",
    "return 1 -> finally",
    "try -exception-> finally",
    "finally -> cleanup()",
    "cleanup() -return-> End",
    "cleanup() -exception-> End",
    "x = 2 -> End",
  ].sort());
  assert.equal(node(cfg, "x = 2").unreachable, true);
  assert.ok(!("unreachable" in node(cfg, "finally")));
  assert.ok(!("unreachable" in node(cfg, "cleanup()")));
});

test("E10 break through a finally inside a loop", () => {
  const cfg = moduleCfg("for x in xs:\n  try:\n    break\n  finally:\n    f()\ny = 1\n");
  assert.deepEqual(edges(cfg), [
    "Start -> for x in xs",
    "for x in xs -next-> try",
    "try -> break",
    "break -> finally",
    "try -exception-> finally",
    "finally -> f()",
    "f() -break-> y = 1",
    "f() -exception-> End",
    "for x in xs -done-> y = 1",
    "y = 1 -> End",
  ].sort());
});

test("E11 with", () => {
  const src = "with open(p) as fh:\n  r = 1\n";
  const cfg = moduleCfg(src);
  assert.deepEqual(edges(cfg), [
    "Start -> with open(p) as fh",
    "with open(p) as fh -> r = 1",
    "r = 1 -> End",
  ].sort());
  const w = node(cfg, "with open(p) as fh");
  assert.equal(w.kind, "statement");
  assert.equal(src.slice(w.from, w.to), "with open(p) as fh");
});

test("E12 match", () => {
  const src = "match v:\n  case 1:\n    a = 1\n  case _:\n    a = 2\n";
  const cfg = moduleCfg(src);
  assert.deepEqual(edges(cfg), [
    "Start -> match v",
    "match v -> case 1",
    "case 1 -True-> a = 1",
    "case 1 -False-> case _",
    "case _ -True-> a = 2",
    "case _ -False-> End",
    "a = 1 -> End",
    "a = 2 -> End",
  ].sort());
  const m = node(cfg, "match v");
  assert.equal(m.kind, "statement");
  assert.equal(src.slice(m.from, m.to), "match v");
  const c = node(cfg, "case 1");
  assert.equal(c.kind, "decision");
  assert.equal(src.slice(c.from, c.to), "case 1");
});

test("E13 module-level definitions collapse", () => {
  const src = "x = 1\n@dec\ndef g():\n  pass\nclass C(B):\n  pass\ny = 2\n";
  const cfg = moduleCfg(src);
  assert.deepEqual(edges(cfg), [
    "Start -> x = 1",
    "x = 1 -> def g()",
    "def g() -> class C(B)",
    "class C(B) -> y = 2",
    "y = 2 -> End",
  ].sort());
  const g = node(cfg, "def g()");
  assert.equal(g.kind, "def");
  assert.equal(g.from, 6);
  assert.equal(src.slice(g.from, g.to).trim(), "@dec\ndef g():\n  pass");
  assert.equal(node(cfg, "class C(B)").kind, "def");
  assert.equal(node(cfg, "pass"), undefined);
});

test("E14 nested def inside a function is not descended into", () => {
  const cfg = functionCfg("def outer():\n  def inner():\n    pass\n  return inner\n");
  assert.deepEqual(edges(cfg), [
    "def outer() -> def inner()",
    "def inner() -> return inner",
    "return inner -> End",
  ].sort());
});

test("E15 empty module links Start to End", () => {
  assert.deepEqual(edges(moduleCfg("")), ["Start -> End"]);
});

test("E15 function with only pass", () => {
  assert.deepEqual(edges(functionCfg("def p():\n  pass\n")), ["def p() -> pass", "pass -> End"].sort());
});

test("E15 comments are skipped", () => {
  assert.deepEqual(edges(moduleCfg("# c\nx = 1  # t\n")), ["Start -> x = 1", "x = 1 -> End"].sort());
  assert.deepEqual(edges(moduleCfg("# only a comment\n")), ["Start -> End"]);
});

test("E15 multi-line statements are normalized", () => {
  const cfg = moduleCfg("z = (1 +\n     2)\n");
  assert.ok(node(cfg, "z = (1 + 2)"));
});

test("E15 long labels are truncated to 60 characters", () => {
  const src = `x = "${"a".repeat(70)}"\n`;
  const cfg = moduleCfg(src);
  const n = cfg.nodes.find(x => x.kind === "statement");
  assert.equal(n.label.length, 60);
  assert.ok(n.label.endsWith("…"));
  assert.equal(n.label.slice(0, 59), src.slice(0, 59));
  const exact = `x = "${"a".repeat(54)}"`;
  assert.equal(exact.length, 60);
  assert.ok(node(moduleCfg(exact + "\n"), exact));
});

test("E15 malformed if does not throw and becomes a statement", () => {
  const cfg = moduleCfg("if x\n  y=1\n");
  assert.deepEqual(edges(cfg), ["Start -> if x", "if x -> y=1", "y=1 -> End"].sort());
  assert.equal(node(cfg, "if x").kind, "statement");
});

test("E15 walrus condition keeps its full header", () => {
  const cfg = moduleCfg("if (n := 3) > 2:\n  pass\n");
  assert.equal(node(cfg, "if (n := 3) > 2").kind, "decision");
});

test("output is plain data with no Lezer node names", () => {
  const src = "try:\n  a()\nexcept E as e:\n  b()\nexcept:\n  c()\nelse:\n  d()\nfinally:\n  f()\ng()\n";
  for (const cfg of [moduleCfg(src), moduleCfg("for x in xs:\n  try:\n    break\n  finally:\n    f()\ny = 1\n")]) {
    assert.deepEqual(JSON.parse(JSON.stringify(cfg)), cfg);
    for (const n of cfg.nodes) assert.ok(!n.kind.endsWith("Statement"), n.kind);
  }
});

test("edges are unique", () => {
  const cfg = moduleCfg("for x in xs:\n  try:\n    break\n  finally:\n    f()\ny = 1\n");
  const keys = cfg.edges.map(e => `${e.source}|${e.target}|${e.label}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const e of cfg.edges) if (!e.label) assert.ok(!("label" in e));
});

test("unsupported scopes throw", () => {
  const src = "if a:\n  pass\n@dec\nclass C:\n  pass\n";
  const top = parser.parse(src).topNode;
  assert.throws(() => buildCfg(top.getChild("IfStatement"), src), /unsupported scope/);
  assert.throws(() => buildCfg(top.getChild("DecoratedStatement"), src), /unsupported scope/);
});

test("decorated function scope unwraps to the function", () => {
  const src = "@dec\nasync def g():\n  return 1\n";
  const cfg = buildCfg(parser.parse(src).topNode.getChild("DecoratedStatement"), src);
  assert.deepEqual(edges(cfg), ["async def g() -> return 1", "return 1 -> End"].sort());
  const start = node(cfg, "async def g()");
  assert.equal(src.slice(start.from, start.to), "async def g()");
});

test("async for header includes async", () => {
  const cfg = functionCfg("async def f():\n  async for a in b:\n    pass\n");
  assert.equal(node(cfg, "async for a in b").kind, "loop");
});

test("break and continue outside a loop end the path", () => {
  const cfg = moduleCfg("break\nx = 1\ncontinue\n");
  assert.deepEqual(edges(cfg), ["Start -> break", "x = 1 -> continue"].sort());
  assert.equal(node(cfg, "x = 1").unreachable, true);
  assert.equal(node(cfg, "continue").unreachable, true);
});

test("continue through a finally loops back with a continue label", () => {
  const cfg = moduleCfg("while a:\n  try:\n    continue\n  finally:\n    f()\n");
  assert.deepEqual(edges(cfg), [
    "Start -> while a",
    "while a -True-> try",
    "try -> continue",
    "continue -> finally",
    "try -exception-> finally",
    "finally -> f()",
    "f() -continue-> while a",
    "f() -exception-> End",
    "while a -False-> End",
  ].sort());
});

test("raise inside try/finally goes through finally", () => {
  const cfg = functionCfg("def f():\n  try:\n    raise E\n  except E:\n    pass\n  finally:\n    g()\n");
  assert.deepEqual(edges(cfg), [
    "def f() -> try",
    "try -> raise E",
    "raise E -> finally",
    "try -exception-> except E",
    "except E -> pass",
    "pass -> finally",
    "finally -> g()",
    "g() -exception-> End",
    "g() -> End",
  ].sort());
});

test("try without finally returns body and handler exits", () => {
  const cfg = moduleCfg("try:\n  a()\nexcept:\n  b()\nc()\n");
  assert.deepEqual(edges(cfg), [
    "Start -> try",
    "try -> a()",
    "try -exception-> except",
    "except -> b()",
    "a() -> c()",
    "b() -> c()",
    "c() -> End",
  ].sort());
});

test("nested finally blocks chain abrupt exits outward", () => {
  const src =
    "def f():\n" +
    "  for x in xs:\n" +
    "    try:\n" +
    "      try:\n" +
    "        return 1\n" +
    "      finally:\n" +
    "        a()\n" +
    "      break\n" +
    "    finally:\n" +
    "      b()\n";
  const cfg = functionCfg(src);
  assert.deepEqual(edges(cfg), [
    "def f() -> for x in xs",
    "for x in xs -next-> try",
    "for x in xs -done-> End",
    "try -> try",
    "try -> return 1",
    "try -exception-> finally",
    "try -exception-> finally",
    "return 1 -> finally",
    "finally -> a()",
    "finally -> b()",
    "a() -> finally",
    "break -> finally",
    "b() -return-> End",
    "b() -exception-> End",
    "b() -break-> End",
  ].sort());
  assert.equal(node(cfg, "break").unreachable, true);
});

test("break inside an inner loop within a try targets the inner loop directly", () => {
  const cfg = moduleCfg("try:\n  while a:\n    break\nfinally:\n  f()\n");
  assert.deepEqual(edges(cfg), [
    "Start -> try",
    "try -> while a",
    "while a -True-> break",
    "while a -False-> finally",
    "break -> finally",
    "try -exception-> finally",
    "finally -> f()",
    "f() -exception-> End",
    "f() -> End",
  ].sort());
});

test("half-typed compound statements never throw and still reach End", () => {
  for (const src of [
    "while a\n  x=1\n",
    "for x in xs\n  y=1\n",
    "try\n  a()\n",
    "with f\n  r=1\n",
    "match v\n  case 1:\n    a=1\n",
    "match v:\n  case 1\n    a=1\n",
    "def g(\n",
    "class C\n",
  ]) {
    const cfg = moduleCfg(src);
    assert.ok(cfg.edges.some(e => e.target === "end"), src);
  }
  assert.deepEqual(edges(functionCfg("def g(")), ["def g( -> End"]);
});
