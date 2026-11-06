import { findScope } from "../cfg/findScope.js";

// Every function scope by the same qualifiedName follow-cursor uses, plus "<module>".
// shortcut: a name defined twice (e.g. in if/else) keeps the last def; pick by the call's line if that matters.
export function listScopes(tree, code) {
  const scopes = new Map([["<module>", { node: tree.topNode, qualifiedName: "<module>" }]]);
  tree.iterate({
    enter(ref) {
      if (ref.name !== "FunctionDefinition") return;
      const { node, qualifiedName } = findScope(tree, code, ref.from);
      scopes.set(qualifiedName, { node, qualifiedName });
    },
  });
  return scopes;
}
