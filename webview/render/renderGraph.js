import { toElk } from "./toElk.js";
import { layout } from "./layout.js";
import { toSvg } from "./toSvg.js";

export async function renderGraph(graph) {
  return toSvg(await layout(toElk(graph)), graph);
}
