"""PyChart execution tracer (trace format v1, the contract with the webview player).

Usage: python tracer.py <target.py> <out.json> [--max-steps 10000] [--max-seconds 10]

Runs the target like `python target.py` under sys.settrace and writes the recorded
events and output to out.json only (never stdout). Stdlib only, Python 3.8+.
Exit code is 0 even when the target fails (see "reason"); 2 only for a usage error.

Each "line" event's "v" is the locals diff seen just before that line runs,
i.e. the effect of the previous step. Output chunks are [eventIndex, stream, text],
where eventIndex is the latest event when the text was written. Threads are not traced.
"""
import argparse
import builtins
import json
import os
import reprlib
import runpy
import sys
import time
import types


class _LimitReached(BaseException):
    """BaseException so a user's `except Exception` can't swallow it."""


class _InputNotSupported(BaseException):
    pass


CO_OPTIMIZED = 0x0001
_SKIP_TYPES =(types.ModuleType, types.FunctionType, types.BuiltinFunctionType, types.MethodType, type)
_MAX_VARS = 20
_MAX_REPR = 80

_repr = reprlib.Repr()
_repr.maxstring = _MAX_REPR
_repr.maxother = _MAX_REPR
_repr.maxlist = _repr.maxtuple = _repr.maxset = _repr.maxfrozenset = _repr.maxdeque = 8
_repr.maxdict = 6
_repr.maxlevel = 3


def safe_repr(value):
    try:
        text = _repr.repr(value)
    except Exception:
        return "<repr failed>"
    return text if len(text) <= _MAX_REPR else text[:_MAX_REPR - 3] + "..."


def frame_vars(frame):
    # Reading f_locals of an unoptimized frame makes 3.12 write it back after the
    # trace call, which clobbers inlined comprehension variables (a module-level
    # [y for y in ...] spanning lines came out empty). Module frames use f_globals
    # instead; class bodies show no variables.
    if frame.f_code.co_flags & CO_OPTIMIZED:
        return frame.f_locals
    return frame.f_globals if frame.f_code.co_name == "<module>" else {}


def snapshot(frame):
    snap = {}
    for name, value in frame_vars(frame).items():
        if name.startswith("__") or isinstance(value, _SKIP_TYPES):
            continue
        snap[name] = safe_repr(value)
        if len(snap) == _MAX_VARS:
            break
    return snap


def diff(old, new):
    changed = {k: r for k, r in new.items() if old.get(k) != r}
    gone = [k for k in old if k not in new]
    out = {}
    if changed:
        out["set"] = changed
    if gone:
        out["del"] = gone
    return out


class Capture:
    def __init__(self, tracer, stream):
        self.tracer = tracer
        self.stream = stream
        self.encoding = "utf-8"

    def write(self, text):
        text = str(text)
        if text:
            output = self.tracer.output
            step = len(self.tracer.events) - 1
            if output and output[-1][0] == step and output[-1][1] == self.stream:
                output[-1][2] += text
            else:
                output.append([step, self.stream, text])
        return len(text)

    def flush(self):
        pass

    def isatty(self):
        return False


class Tracer:
    def __init__(self, target, max_steps, max_seconds):
        self.target = target
        self.max_steps = max_steps
        self.max_seconds = max_seconds
        self.events = []
        self.output = []
        self.steps = 0
        self.next_call = 0
        self.calls = {}  # id(frame) -> (callId, qualname, depth, last locals snapshot)
        self.is_target = {}  # co_filename -> bool
        self.t0 = time.perf_counter()

    def in_target(self, filename):
        hit = self.is_target.get(filename)
        if hit is None:
            hit = os.path.normcase(os.path.abspath(filename)) == os.path.normcase(self.target)
            self.is_target[filename] = hit
        return hit

    def trace(self, frame, event, arg):
        if not self.in_target(frame.f_code.co_filename):
            return None
        key = id(frame)
        if event == "call":
            code = frame.f_code
            qualname = getattr(code, "co_qualname", code.co_name)
            depth = 0
            f = frame
            while f is not None:
                if self.in_target(f.f_code.co_filename):
                    depth += 1
                f = f.f_back
            self.next_call += 1
            call_id = self.next_call
            self.calls[key] = [call_id, qualname, depth, {}]
            self.events.append({"e": "call", "q": qualname, "c": call_id, "d": depth, "l": frame.f_lineno})
            return self.trace
        info = self.calls.get(key)
        if info is None:  # frame entered before tracing started
            return self.trace
        call_id, qualname, depth, last = info
        if event == "line":
            if time.perf_counter() - self.t0 > self.max_seconds:
                raise _LimitReached()
            line = frame.f_lineno
            snap = snapshot(frame)
            v = diff(last, snap)
            info[3] = snap
            prev = self.events[-1]
            if prev["e"] == "line" and prev["c"] == call_id and prev["l"] == line:
                prev["n"] = prev.get("n", 1) + 1
                if v:
                    merged = prev.setdefault("v", {})
                    sets = merged.setdefault("set", {})
                    dels = merged.setdefault("del", [])
                    for name in v.get("del", ()):
                        sets.pop(name, None)
                        if name not in dels:
                            dels.append(name)
                    for name, text in v.get("set", {}).items():
                        sets[name] = text
                        if name in dels:
                            dels.remove(name)
                    if not sets:
                        del merged["set"]
                    if not dels:
                        del merged["del"]
                return self.trace
            if self.steps >= self.max_steps:
                raise _LimitReached()
            self.steps += 1
            step = {"e": "line", "c": call_id, "q": qualname, "l": line, "d": depth}
            if v:
                step["v"] = v
            self.events.append(step)
        elif event == "return":
            step = {"e": "return", "c": call_id, "q": qualname, "l": frame.f_lineno, "d": depth}
            v = diff(last, snapshot(frame))
            if v:
                step["v"] = v
            self.events.append(step)
            del self.calls[key]
        elif event == "exception":
            self.events.append({"e": "exception", "c": call_id, "l": frame.f_lineno, "x": arg[0].__name__})
        return self.trace


def _not_supported(*_args, **_kwargs):
    raise _InputNotSupported()


def exception_line(target_check, tb):
    line = None
    while tb is not None:
        if target_check(tb.tb_frame.f_code.co_filename):
            line = tb.tb_lineno
        tb = tb.tb_next
    return line


def main(argv):
    parser = argparse.ArgumentParser(prog="tracer.py")
    parser.add_argument("target")
    parser.add_argument("out")
    parser.add_argument("--max-steps", type=int, default=10000)
    parser.add_argument("--max-seconds", type=float, default=10)
    args = parser.parse_args(argv)
    target = os.path.abspath(args.target)
    if not os.path.isfile(target):
        parser.error("target not found: " + target)

    tracer = Tracer(target, args.max_steps, args.max_seconds)
    sys.argv = [target]
    sys.path.insert(0, os.path.dirname(target))
    builtins.input = _not_supported
    real_out, real_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = Capture(tracer, "out"), Capture(tracer, "err")

    reason, exc_info, exit_code = "done", None, 0
    try:
        sys.settrace(tracer.trace)
        runpy.run_path(target, run_name="__main__")
    except _LimitReached:
        reason, exit_code = "limit", None
    except _InputNotSupported:
        reason, exit_code = "input-not-supported", None
    except SystemExit as e:
        reason = "exit"
        exit_code = 0 if e.code is None else e.code if isinstance(e.code, int) else 1
    except BaseException as e:  # the user's program failed; report it, don't crash
        try:
            message = str(e)
        except Exception:
            message = "<str failed>"
        reason, exit_code = "exception", 1
        exc_info = {"type": type(e).__name__, "message": message,
                    "line": exception_line(tracer.in_target, e.__traceback__)}
    finally:
        sys.settrace(None)
        sys.stdout, sys.stderr = real_out, real_err

    result = {
        "version": 1,
        "python": "%d.%d.%d" % sys.version_info[:3],
        "target": target,
        "reason": reason,
        "exception": exc_info,
        "exitCode": exit_code,
        "limits": {"steps": args.max_steps, "seconds": args.max_seconds},
        "elapsedMs": round((time.perf_counter() - tracer.t0) * 1000, 1),
        "events": tracer.events,
        "output": tracer.output,
    }
    # ASCII-escaped JSON is valid UTF-8 and survives lone surrogates in user strings
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(json.dumps(result, separators=(",", ":")))  # one-shot dumps is much faster than streaming dump
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
