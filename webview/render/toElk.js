export const FONT_PX = 12; // must match .cfg-node text font-size in index.css
export const CHAR_W = 7.2; // monospace average width at 12px

export function nodeSize(node) {
  const textW = Math.ceil(node.label.length * CHAR_W);
  if (node.kind === "decision" || node.kind === "loop") {
    return { width: Math.max(96, textW + 56), height: 56 };
  }
  if (node.kind === "start" || node.kind === "end") {
    return { width: Math.max(72, textW + 32), height: 32 };
  }
  return { width: Math.max(80, textW + 24), height: 32 };
}

export function toElk(graph) {
  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST", // loop back-edges point upward
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES", // keep source order
      "elk.spacing.nodeNode": "24",
      "elk.layered.spacing.nodeNodeBetweenLayers": "32",
      "elk.spacing.edgeLabel": "4",
      "elk.edgeLabels.inline": "true",
    },
    children: graph.nodes.map((n) => ({ id: n.id, ...nodeSize(n) })),
    edges: graph.edges.map((e, i) => ({
      id: `e${i}`,
      sources: [e.source],
      targets: [e.target],
      ...(e.label ? { labels: [{ text: e.label, width: Math.ceil(e.label.length * 6.6) + 8, height: 14 }] } : {}),
    })),
  };
}
