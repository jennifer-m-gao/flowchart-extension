import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parser } from "@lezer/python";
import { buildCfg } from "../../webview/cfg/buildCfg.js";
import { listScopes } from "../../webview/run/scopes.js";
import { loadTrace, createPlayer, frameAt } from "../../webview/run/player.js";

const FIXTURES = new URL("../ui/fixtures/", import.meta.url);
const CODE = fs.readFileSync(new URL("demo-run.py", FIXTURES), "utf8").replace(/\r\n/g, "\n");
const TRACE = JSON.parse(fs.readFileSync(new URL("demo-run.trace.json", FIXTURES), "utf8"));
const STDOUT = [
  "['fail', 'pass']",
  "all scores read",
  "['pass', 'fail']",
  "all scores read",
  "[]",
  "error [Errno 2] No such file or directory: 'no-such-file.txt'",
  "cleanup",
  "",
].join("\n");

function load(trace = TRACE) {
  const scopes = listScopes(parser.parse(CODE), CODE);
  const graphs = new Map();
  const graphFor = (key) => graphs.get(key) || graphs.set(key, buildCfg(scopes.get(key).node, CODE)).get(key);
  return { loaded: loadTrace(trace, { scopes, graphFor, code: CODE }), graphFor };
}
const { loaded, graphFor } = load();
const steps = loaded.steps;
const nodeId = (scope, label) => graphFor(scope).nodes.find((n) => n.label === label).id;
// Step indices of the k-th (1-based) call of a scope, in order.
const callSteps = (scope, k) => {
  const first = steps.find((s) => s.scopeKey === scope && s.callOrdinal.k === k);
  return loaded.ownerSteps.get(first.callId);
};
const lastOf = (list) => list.at(-1);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test("total is the number of call, line and return events", () => {
  const want = TRACE.events.filter((e) => e.e !== "exception").length;
  assert.equal(loaded.total, want);
  assert.equal(steps.length, want);
  assert.equal(steps[0].kind, "call");
  assert.equal(steps[0].nodeId, "start");
  assert.equal(lastOf(steps).kind, "return");
  assert.equal(lastOf(steps).nodeId, "end");
});

test("player seek clamps, prev stops at 0, next stops at the end and stops playing", () => {
  const p = createPlayer(loaded);
  assert.equal(p.seek(-5), 0);
  assert.equal(p.seek(1e9), loaded.total - 1);
  assert.equal(p.seek("x"), 0);
  assert.equal(p.prev(), 0);
  p.seek(loaded.total - 2);
  p.play();
  assert.equal(p.playing, true);
  assert.equal(p.next(), loaded.total - 1);
  assert.equal(p.playing, false);
  p.playing = true;
  assert.equal(p.next(), loaded.total - 1);
  assert.equal(p.playing, false);
});

test("player play at the end starts over; toggle, pause and speed clamp", () => {
  const p = createPlayer(loaded);
  p.seek(loaded.total - 1);
  p.toggle();
  assert.deepEqual([p.index, p.playing], [0, true]);
  p.toggle();
  assert.equal(p.playing, false);
  p.play();
  p.pause();
  assert.equal(p.playing, false);
  assert.equal(p.speed, 4);
  p.setSpeed(50);
  assert.equal(p.speed, 20);
  p.setSpeed(0);
  assert.equal(p.speed, 1);
  p.setSpeed("7");
  assert.equal(p.speed, 7);
});

test("follows execution across functions with the call chain and call ordinal", () => {
  const i = callSteps("classify", 1)[1];
  const f = frameAt(loaded, i);
  assert.equal(f.scopeKey, "classify");
  assert.deepEqual(f.chain, ["main", "classify"]);
  assert.deepEqual(f.callOrdinal, { k: 1, of: 3 });
  assert.deepEqual(frameAt(loaded, callSteps("classify", 2)[0]).callOrdinal, { k: 2, of: 3 });
  const m = frameAt(loaded, callSteps("main", 1)[1]);
  assert.deepEqual([m.chain, m.callOrdinal], [["main"], { k: 1, of: 1 }]);
  assert.deepEqual(frameAt(loaded, 1).chain, ["<module>"]);
  assert.deepEqual(frameAt(loaded, callSteps("Cart.add_item", 1)[1]).chain, ["main", "Cart.add_item"]);
});

test("a class body draws on the module's graph and keeps the module's visits", () => {
  const moduleSteps = steps.filter((s) => s.scopeKey === "<module>");
  assert.ok(moduleSteps.some((s) => s.line === 32), "the class body's def __init__ line is a module step");
  assert.ok(moduleSteps.every((s) => s.callId === steps[0].callId), "one owner for the module and the class body");
  assert.ok(moduleSteps.every((s) => s.nodeId !== "start" || s === steps[0]), "the class body's call is not a second start");
});

test("visits: a full loop visits the for node elements + 1 times", () => {
  const loop = nodeId("classify", "for s in scores");
  const f = frameAt(loaded, lastOf(callSteps("classify", 2))); // classify([60, 10])
  assert.equal(f.visits.get(loop), 3);
  assert.equal(f.nodeId, "end");
  assert.ok(f.visited.has(nodeId("classify", 'print("all scores read")')));
});

test("visits: continue goes back to the for node, break skips the rest", () => {
  const loop = nodeId("classify", "for s in scores");
  const third = callSteps("classify", 3); // classify([-5])
  const cont = third.find((i) => steps[i].nodeId === nodeId("classify", "continue"));
  assert.equal(steps[third[third.indexOf(cont) + 1]].nodeId, loop);
  assert.equal(frameAt(loaded, lastOf(third)).visits.get(loop), 2);

  const first = callSteps("classify", 1); // [5, -1, 70, 101, 40]: breaks at 101
  const brk = first.find((i) => steps[i].nodeId === nodeId("classify", "break"));
  const after = first.slice(first.indexOf(brk) + 1).map((i) => steps[i].nodeId);
  assert.ok(!after.includes(loop) && !after.includes(nodeId("classify", "if s >= 50")));
  const f = frameAt(loaded, lastOf(first));
  assert.equal(f.visits.get(loop), 4);
  assert.equal(f.visits.get(nodeId("classify", "if s >= 50")), 2);
  assert.ok(!f.visited.has(nodeId("classify", 'print("all scores read")')));
});

test("visits count only this call and only up to the index", () => {
  const loop = nodeId("classify", "for s in scores");
  const second = callSteps("classify", 2);
  assert.equal(frameAt(loaded, second[0]).visits.get(loop), undefined);
  const firstLoop = second.find((i) => steps[i].nodeId === loop);
  assert.equal(frameAt(loaded, firstLoop).visits.get(loop), 1);
});

test("locals and changes: old -> new, accumulation, no leaks between calls", () => {
  const first = callSteps("classify", 1);
  const i = first.find((j) => steps[j].changed.s?.[1] === "-1");
  const f = frameAt(loaded, i);
  assert.deepEqual(f.changed.s, ["5", "-1"]);
  assert.equal(f.locals.results, "['fail']");
  assert.equal(frameAt(loaded, lastOf(first)).locals.results, "['fail', 'pass']");
  assert.deepEqual(frameAt(loaded, first[2]).changed, { results: [undefined, "[]"] });
  assert.equal(frameAt(loaded, callSteps("classify", 2)[1]).locals.results, undefined, "a new call starts empty");
  const add = frameAt(loaded, lastOf(callSteps("Cart.add_item", 1)));
  assert.deepEqual(Object.keys(add.locals).sort(), ["item", "qty", "self"]);
  const main = frameAt(loaded, lastOf(callSteps("main", 1)));
  assert.ok(!("s" in main.locals) && !("results" in main.locals) && "cart" in main.locals);
  const toLast = frameAt(loaded, lastOf(callSteps("main", 1)));
  assert.ok(toLast.lastSeen.size > 0);
  assert.equal(toLast.lastSeen.get(nodeId("main", "cart = Cart()")).scores, "[5, -1, 70, 101, 40]");
});

test("deleted names leave the locals", () => {
  const load = callSteps("load", 1);
  const withE = load.find((i) => "e" in steps[i].locals);
  assert.ok(withE !== undefined);
  assert.ok(!("e" in frameAt(loaded, lastOf(load)).locals));
});

test("output: whole stdout at the last step, a prefix before", () => {
  assert.equal(frameAt(loaded, loaded.total - 1).outputText, STDOUT);
  const firstReturn = lastOf(callSteps("classify", 1));
  assert.equal(frameAt(loaded, firstReturn).outputText, "", "print runs after classify returns");
  assert.equal(frameAt(loaded, firstReturn + 1).outputText, "['fail', 'pass']\n");
  for (let i = 0; i < loaded.total; i++) assert.ok(STDOUT.startsWith(frameAt(loaded, i).outputText));
});

test("exception path: except is visited and finally runs before load's end", () => {
  const load = callSteps("load", 1);
  const f = frameAt(loaded, lastOf(load));
  assert.equal(f.nodeId, "end");
  assert.ok(f.visited.has(nodeId("load", "except OSError as e")));
  const cleanup = nodeId("load", 'print("cleanup")');
  const at = load.findIndex((i) => steps[i].nodeId === cleanup);
  assert.ok(at >= 0 && at < load.length - 1);
  assert.equal(steps[load[at + 1]].nodeId, "end");
});

test("reason, exception and exit code come from the trace", () => {
  assert.equal(loaded.reason, "exception");
  assert.deepEqual(loaded.exception, { type: "FileNotFoundError", message: "[Errno 2] No such file or directory: 'no-such-file.txt'", line: 19 });
  assert.equal(loaded.exitCode, 1);
  assert.equal(load({ ...TRACE, reason: "limit" }).loaded.reason, "limit");
});

test("recursion gives each call its own visits", () => {
  const code = "def f(n):\n    if n:\n        f(n - 1)\n    return n\n\nf(1)\n";
  const scopes = listScopes(parser.parse(code), code);
  const trace = {
    reason: "done",
    output: [],
    events: [
      { e: "call", q: "<module>", c: 1, d: 1, l: 0 },
      { e: "line", q: "<module>", c: 1, d: 1, l: 1 },
      { e: "line", q: "<module>", c: 1, d: 1, l: 6 },
      { e: "call", q: "f", c: 2, d: 2, l: 1 },
      { e: "line", q: "f", c: 2, d: 2, l: 2, v: { set: { n: "1" } } },
      { e: "line", q: "f", c: 2, d: 2, l: 3 },
      { e: "call", q: "f", c: 3, d: 3, l: 1 },
      { e: "line", q: "f", c: 3, d: 3, l: 2, v: { set: { n: "0" } } },
      { e: "line", q: "f", c: 3, d: 3, l: 4 },
      { e: "return", q: "f", c: 3, d: 3, l: 4 },
      { e: "line", q: "f", c: 2, d: 2, l: 4 },
      { e: "return", q: "f", c: 2, d: 2, l: 4 },
      { e: "return", q: "<module>", c: 1, d: 1, l: 6 },
    ],
  };
  const r = loadTrace(trace, { scopes, graphFor: (k) => buildCfg(scopes.get(k).node, code), code });
  const inner = frameAt(r, 8);
  assert.deepEqual([inner.chain, inner.callOrdinal, inner.locals], [["f", "f"], { k: 2, of: 2 }, { n: "0" }]);
  assert.equal(inner.visits.size, 3); // start, if n, return n: not the outer call's f(n - 1)
  const outer = frameAt(r, 10);
  assert.deepEqual([outer.callOrdinal.k, outer.locals], [1, { n: "1" }]);
});

// Synthetic long run: one classify call whose loop lines repeat to about 10,000 steps.
function synthetic() {
  const body = TRACE.events.slice(15, 34); // classify call 4's line events
  const events = [TRACE.events[0], TRACE.events[14]];
  while (events.length < 10000) events.push(...body);
  events.push(TRACE.events[34], TRACE.events.at(-1));
  return { ...TRACE, output: [], events };
}

test("perf: frameAt < 2 ms (max and median), loadTrace reported", (t) => {
  const tLoad = performance.now();
  load();
  const fixtureLoad = performance.now() - tLoad;
  const times = [];
  for (let i = 0; i < loaded.total; i++) {
    const t0 = performance.now();
    frameAt(loaded, i);
    times.push(performance.now() - t0);
  }
  const big = synthetic();
  const t1 = performance.now();
  const bigLoaded = load(big).loaded;
  const bigLoad = performance.now() - t1;
  const bigTimes = [];
  for (let i = 0; i < bigLoaded.total; i++) {
    const t0 = performance.now();
    frameAt(bigLoaded, i);
    bigTimes.push(performance.now() - t0);
  }
  t.diagnostic(`loadTrace: fixture (${loaded.total} steps) ${fixtureLoad.toFixed(2)} ms; synthetic (${bigLoaded.total} steps, one call) ${bigLoad.toFixed(2)} ms`);
  t.diagnostic(`frameAt fixture: median ${median(times).toFixed(4)} ms, max ${Math.max(...times).toFixed(4)} ms`);
  t.diagnostic(`frameAt synthetic: median ${median(bigTimes).toFixed(4)} ms, max ${Math.max(...bigTimes).toFixed(4)} ms`);
  assert.ok(bigLoaded.total >= 10000);
  assert.ok(median(times) < 2 && Math.max(...times) < 2, `fixture frameAt median ${median(times)} max ${Math.max(...times)}`);
});
