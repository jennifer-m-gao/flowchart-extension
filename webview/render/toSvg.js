const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function xml(s) {
  return String(s).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);
}

const num = (n) => Math.round(n * 10) / 10;

// Native tooltip text for a box (emitted as its SVG <title>).
// TODO(drill-down plan): function nodes in Functions mode add "Double-click: open its flowchart".
export function nodeHint(node) {
  return `${node.label}\n${node.from == null ? "Not defined in this file" : "Click or Enter: go to code"}`;
}

export function toSvg(laidOut, graph) {
  const W = num(laidOut.width + 32);
  const H = num(laidOut.height + 32);
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  let out = `<svg xmlns="http://www.w3.org/2000/svg" class="cfg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  out += '<defs><marker id="cfg-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="cfg-arrowhead"/></marker></defs>';
  out += '<g class="cfg-root" transform="translate(16,16)">';

  // Edges first so nodes paint over them.
  for (const elkEdge of laidOut.edges ?? []) {
    const edge = graph.edges[Number(elkEdge.id.slice(1))];
    const section = elkEdge.sections[0];
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${num(p.x)},${num(p.y)}`).join(" ");
    out += `<g class="cfg-edge cfg-edge--${xml(edge.label ?? "plain")}">`;
    out += `<path d="${d}" marker-end="url(#cfg-arrow)"/>`;
    const label = elkEdge.labels?.[0];
    if (edge.label && label) {
      out += `<text class="cfg-edge-label" x="${num(label.x + label.width / 2)}" y="${num(label.y + label.height - 3)}" text-anchor="middle">${xml(edge.label)}</text>`;
    }
    out += "</g>";
  }

  for (const child of laidOut.children ?? []) {
    const node = nodesById.get(child.id);
    const w = num(child.width);
    const h = num(child.height);
    const cls = `cfg-node cfg-node--${xml(node.kind)}${node.unreachable ? " is-unreachable" : ""}`;
    const range = node.from == null ? "" : ` data-from="${xml(node.from)}" data-to="${xml(node.to)}"`;
    out += `<g class="${cls}" data-id="${xml(node.id)}" data-kind="${xml(node.kind)}"${range} transform="translate(${num(child.x)},${num(child.y)})" tabindex="0" role="button" aria-label="${xml(`${node.kind}: ${node.label}`)}">`;
    out += `<title>${xml(nodeHint(node))}</title>`;
    if (node.kind === "decision" || node.kind === "loop") {
      out += `<polygon points="${num(w / 2)},0 ${w},${num(h / 2)} ${num(w / 2)},${h} 0,${num(h / 2)}"/>`;
    } else if (node.kind === "start" || node.kind === "end") {
      out += `<rect width="${w}" height="${h}" rx="${num(h / 2)}"/>`;
    } else {
      out += `<rect width="${w}" height="${h}" rx="4"/>`;
    }
    out += `<text x="${num(w / 2)}" y="${num(h / 2)}" dominant-baseline="central" text-anchor="middle">${xml(node.label)}</text>`;
    out += "</g>";
  }

  return `${out}</g></svg>`;
}
