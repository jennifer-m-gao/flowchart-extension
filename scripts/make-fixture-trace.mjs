// Regenerates test/ui/fixtures/demo-run.trace.json with python/tracer.py (PYTHON env var picks the interpreter).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "test", "ui", "fixtures");
const out = path.join(os.tmpdir(), `pychart-fixture-${process.pid}.json`);
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

execFileSync(python, [path.join(ROOT, "python", "tracer.py"), path.join(FIXTURES, "demo-run.py"), out], { cwd: ROOT, stdio: "inherit" });
// Machine- and run-specific values would make the committed file churn: object addresses in reprs, the path, the time.
const trace = JSON.parse(fs.readFileSync(out, "utf8").replace(/ at 0x[0-9A-Fa-f]+/g, " at 0x0"));
fs.rmSync(out);
trace.target = "demo-run.py";
trace.elapsedMs = 0;
fs.writeFileSync(path.join(FIXTURES, "demo-run.trace.json"), JSON.stringify(trace) + "\n");
console.log(`demo-run.trace.json: ${trace.events.length} events, reason ${trace.reason}, python ${trace.python}`);
