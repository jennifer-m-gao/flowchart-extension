export function migrateMode(saved) {
  return saved === "functions" || saved === "flow" ? saved : "flow";
}

export function scopeKey(scope) {
  return `${scope.kind}:${scope.qualifiedName}:${scope.node.from}:${scope.node.to}`;
}

export function shouldRender(prev, next) {
  return !prev
    || prev.code !== next.code
    || prev.viewKind !== next.viewKind
    || prev.follow !== next.follow
    || (next.viewKind === "flow" && prev.scopeKey !== next.scopeKey);
}

// What update() does, given what is shown, what is rendering (or null), and what is wanted.
// A cursor move only re-highlights; it cancels a render only when that render targets something no longer wanted.
export function renderAction(shown, rendering, next) {
  if (!shouldRender(shown, next)) {
    return rendering ? "cancel-and-highlight" : "highlight";
  }
  return rendering && !shouldRender(rendering, next) ? "wait" : "render";
}

// vscode.setState replaces the whole state, so every write merges into what is saved.
export function mergeState(prev, patch) {
  return { ...(prev || {}), ...patch };
}

// Either store (webview state or the host's globalState) having the dismissal hides the tip.
export function shouldShowTip(saved, hostDismissed) {
  return !hostDismissed && !(saved && saved.tipDismissed);
}
