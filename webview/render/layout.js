import ELK from "elkjs/lib/elk.bundled.js";

const elk = new ELK(); // no workerUrl → runs in-thread (D13)

export function layout(elkGraph) {
  return elk.layout(elkGraph);
}
