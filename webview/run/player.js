// Pure replay model over a python/tracer.py trace (format v1): one step per call/line/return event.
import { lineStarts, mapStepToNode, normalizeQualname, scopeForStep } from "./mapTrace.js";

// graphFor(scopeKey) -> {nodes, edges}; the caller memoises it.
export function loadTrace(trace, { scopes, graphFor, code }) {
  const starts = lineStarts(code);
  const nodeOf = new Map(); // scopeKey \0 line -> node id
  const frames = new Map(); // callId -> { owner, locals, lastNode }
  const active = []; // frames in call order
  const calls = new Map(); // scopeKey -> calls so far
  const ownerSteps = new Map(); // owner callId -> its step indices, ascending
  const steps = [];
  const chunks = trace.output || [];
  let output = "";
  let chunk = 0;

  trace.events.forEach((ev, eventIndex) => {
    if (ev.e !== "call" && ev.e !== "line" && ev.e !== "return") return;
    // Text written while an earlier event was the latest came before this step runs.
    while (chunk < chunks.length && chunks[chunk][0] < eventIndex) output += chunks[chunk++][2];

    let frame = frames.get(ev.c);
    if (!frame) {
      const scopeKey = scopeForStep(ev.q, scopes).qualifiedName;
      const parent = active.at(-1);
      // Class bodies, lambdas and genexprs draw on their parent's graph: keep that call's visits going.
      // A recursive call has its own scope name, so it gets its own owner.
      let owner = normalizeQualname(ev.q) !== scopeKey && parent?.owner.scopeKey === scopeKey ? parent.owner : null;
      if (!owner) {
        const k = (calls.get(scopeKey) || 0) + 1;
        calls.set(scopeKey, k);
        const outer = parent?.owner.chain;
        owner = {
          callId: ev.c,
          scopeKey,
          graph: graphFor(scopeKey),
          chain: !outer || outer[0] === "<module>" ? [scopeKey] : [...outer, scopeKey],
          callOrdinal: { k, of: 0 },
          merged: false,
        };
        ownerSteps.set(ev.c, []);
      } else {
        owner = { ...owner, merged: true };
      }
      frame = { owner, locals: {}, lastNode: undefined };
      frames.set(ev.c, frame);
      active.push(frame);
    }
    const { owner } = frame;

    let nodeId;
    if (ev.e !== "line" && !owner.merged) {
      nodeId = ev.e === "call" ? "start" : "end";
    } else {
      const key = `${owner.scopeKey}\u0000${ev.l}`;
      if (!nodeOf.has(key)) nodeOf.set(key, mapStepToNode(owner.graph, code, ev.l, starts)?.id ?? null);
      nodeId = nodeOf.get(key);
    }

    const changed = {};
    if (ev.v) {
      const old = frame.locals;
      const locals = { ...old };
      for (const name of ev.v.del || []) delete locals[name];
      for (const [name, value] of Object.entries(ev.v.set || {})) {
        locals[name] = value;
        changed[name] = [old[name], value];
      }
      frame.locals = locals;
    }

    const list = ownerSteps.get(owner.callId);
    // Several steps in a row on one node (an "n" repeat, a continuation line) are one visit.
    const prevNode = list.length ? steps[list.at(-1)].nodeId : undefined;
    list.push(steps.length);
    steps.push({
      kind: ev.e,
      scopeKey: owner.scopeKey,
      nodeId,
      callId: owner.callId,
      line: ev.l,
      chain: owner.chain,
      callOrdinal: owner.callOrdinal,
      locals: frame.locals,
      changed,
      visit: nodeId !== null && nodeId !== prevNode,
      outputEnd: output.length,
    });

    if (ev.e === "return") {
      frames.delete(ev.c);
      active.splice(active.lastIndexOf(frame), 1);
    }
  });

  while (chunk < chunks.length) output += chunks[chunk++][2];
  if (steps.length) steps.at(-1).outputEnd = output.length; // nothing runs after the last step
  for (const step of steps) step.callOrdinal.of = calls.get(step.scopeKey);

  return {
    steps,
    total: steps.length,
    reason: trace.reason,
    exception: trace.exception ?? null,
    exitCode: trace.exitCode ?? null,
    limits: trace.limits ?? null,
    output,
    ownerSteps,
  };
}

export function createPlayer(loaded) {
  const last = Math.max(0, loaded.total - 1);
  return {
    index: 0,
    playing: false,
    speed: 4,
    seek(i) {
      this.index = Math.min(last, Math.max(0, Math.round(i) || 0));
      return this.index;
    },
    next() {
      if (this.index < last) this.index++;
      if (this.index === last) this.playing = false;
      return this.index;
    },
    prev() {
      return this.seek(this.index - 1);
    },
    play() {
      if (this.index === last) this.index = 0; // play at the end starts over
      this.playing = last > 0;
    },
    pause() {
      this.playing = false;
    },
    toggle() {
      if (this.playing) this.pause();
      else this.play();
    },
    setSpeed(stepsPerSecond) {
      this.speed = Math.min(20, Math.max(1, +stepsPerSecond || 1));
    },
  };
}

// Everything the view needs at one step. Scans only this call's steps up to index.
export function frameAt(loaded, index) {
  const step = loaded.steps[index];
  const visits = new Map();
  const lastSeen = new Map();
  for (const i of loaded.ownerSteps.get(step.callId)) {
    if (i > index) break;
    const s = loaded.steps[i];
    if (s.nodeId === null) continue;
    if (s.visit) visits.set(s.nodeId, (visits.get(s.nodeId) || 0) + 1);
    lastSeen.set(s.nodeId, s.locals);
  }
  return {
    step,
    scopeKey: step.scopeKey,
    nodeId: step.nodeId,
    chain: step.chain,
    callOrdinal: step.callOrdinal,
    locals: step.locals,
    changed: step.changed,
    visits,
    visited: new Set(visits.keys()),
    lastSeen,
    outputText: loaded.output.slice(0, step.outputEnd),
  };
}
