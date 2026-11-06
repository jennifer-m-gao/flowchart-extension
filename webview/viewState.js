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
