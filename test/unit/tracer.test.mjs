import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const tracer = join(root, "python", "tracer.py");
const fixture = name => join(root, "test", "fixtures", "trace", name);

function findPython() {
  for (const [exe, ...prefix] of [["python"], ["py", "-3"], ["python3"]]) {
    if (spawnSync(exe, [...prefix, "--version"], { timeout: 5000 }).status === 0) {
      return [exe, prefix];
    }
  }
  return null;
}
const python = findPython();
const opts = python ? {} : { skip: "no python on PATH" };

function trace(name, ...args) {
  const out = join(tmpdir(), `pychart-test-${randomBytes(6).toString("hex")}.json`);
  const t0 = performance.now();
  const r = spawnSync(python[0], [...python[1], tracer, fixture(name), out, ...args], { encoding: "utf8" });
  const ms = performance.now() - t0;
  try {
    assert.equal(r.status, 0, r.stderr);
    return { ...JSON.parse(readFileSync(out, "utf8")), wallMs: ms };
  } finally {
    rmSync(out, { force: true });
  }
}

// 1-based line of the first fixture line containing `text`
const lineOf = (name, text) => readFileSync(fixture(name), "utf8").split(/\r?\n/).findIndex(l => l.includes(text)) + 1;
const lines = (t, q) => t.events.filter(e => e.e === "line" && (!q || e.q === q));
const callIds = (t, q) => t.events.filter(e => e.e === "call" && e.q === q).map(e => e.c);
const text = t => t.output.map(o => o[2]).join("");

test("loops: for header, break and continue follow the real path", opts, () => {
  const t = trace("loops.py");
  assert.equal(t.reason, "done");
  const header = lineOf("loops.py", "for s in scores");
  const brk = lineOf("loops.py", "break");
  const cont = lineOf("loops.py", "continue");
  const ret = lineOf("loops.py", "return labels");
  const [first, second] = callIds(t, "classify");
  const steps = c => lines(t).filter(e => e.c === c).map(e => e.l);

  // first call breaks on 101: header seen for 5, -1, 70, 101 and no exit check
  const a = steps(first);
  assert.equal(a.filter(l => l === header).length, 4);
  assert.deepEqual(a.slice(a.indexOf(brk) + 1), [ret]);
  assert.equal(a[a.indexOf(cont) + 1], header);
  // second call runs out: once per element plus one exit check
  assert.equal(steps(second).filter(l => l === header).length, 2 + 1);
  assert.ok(text(t).includes("['fail', 'pass']\n"));
});

test("tryfinally: return line, then finally body, then the return event", opts, () => {
  const t = trace("tryfinally.py");
  const i = q => t.events.findIndex(q);
  const retLine = i(e => e.e === "line" && e.l === lineOf("tryfinally.py", "return x"));
  const finLine = i(e => e.e === "line" && e.l === lineOf("tryfinally.py", 'print("cleanup")'));
  const retEvent = i(e => e.e === "return" && e.q === "load");
  assert.ok(retLine >= 0 && retLine < finLine && finLine < retEvent);
  assert.equal(text(t), "cleanup\n");
});

test("raises: uncaught exception reports type, message and raise line", opts, () => {
  const t = trace("raises.py");
  assert.equal(t.reason, "exception");
  assert.deepEqual(t.exception, { type: "ValueError", message: "bad", line: lineOf("raises.py", "raise ValueError") });
});

test("infinite: stops at the step limit and at the time limit", opts, () => {
  const t = trace("infinite.py", "--max-steps", "500");
  assert.equal(t.reason, "limit");
  assert.equal(lines(t).length, 500);
  const timed = trace("infinite.py", "--max-seconds", "1", "--max-steps", "100000000");
  assert.equal(timed.reason, "limit");
  assert.ok(timed.wallMs < 3000, `took ${timed.wallMs} ms`);
});

test("asks: input() is reported as not supported", opts, () => {
  assert.equal(trace("asks.py").reason, "input-not-supported");
});

test("decorated: qualnames, merged comprehension and filtered locals", opts, () => {
  const t = trace("decorated.py");
  const names = new Set(t.events.map(e => e.q));
  assert.ok(names.has("Cart.add_item"));
  assert.ok(names.has("outer.<locals>.inner"));
  const comp = lines(t, "<module>").filter(e => e.l === lineOf("decorated.py", "doubled = ["));
  assert.equal(comp.length, 1);
  assert.ok(comp[0].n > 1);
  const values = t.events.flatMap(e => Object.values(e.v?.set ?? {}));
  assert.ok(values.length > 0);
  assert.ok(values.every(v => !v.startsWith("<function") && !v.startsWith("<module")), values.join(" | "));
  assert.ok(text(t).includes("6 [0, 2, 4] [6]\n"));
});

test("locals are stored as diffs", opts, () => {
  const t = trace("loops.py");
  const steps = lines(t, "classify");
  assert.ok(steps.some(e => e.v?.set?.s === "70"));
  assert.ok(steps.some(e => !("v" in e)));
});

test("print writes are coalesced into one chunk", opts, () => {
  const t = trace("loops.py");
  assert.ok(t.output.some(o => o[1] === "out" && o[2] === "a 1\n"));
});
