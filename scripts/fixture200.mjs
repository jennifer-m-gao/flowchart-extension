// Deterministic Python fixture: one function, `def big(xs):`, of at least `lines` lines.
const BLOCKS = [
  (i) => [
    `if xs[${i}] > ${i}:`,
    `    a${i} = ${i}`,
    `elif xs[${i}] < 0:`,
    `    a${i} = -${i}`,
    "else:",
    `    a${i} = 0`,
  ],
  (i) => [
    `for v${i} in xs:`,
    `    if v${i} == ${i}:`,
    "        continue",
    `    total += v${i}`,
  ],
  (i) => [
    `while total > ${i}:`,
    `    total -= ${i + 1}`,
    `    if total < ${i}:`,
    "        break",
  ],
  (i) => [
    "try:",
    `    r${i} = xs[${i}] / total`,
    "except ZeroDivisionError:",
    `    r${i} = 0`,
    "finally:",
    `    count += 1`,
  ],
  (i) => [
    `b${i} = total + ${i}`,
    `c${i} = b${i} * 2`,
  ],
];

export function makeFunction(lines = 200) {
  const out = ["def big(xs):", "    total = 0", "    count = 0"];
  for (let i = 0; out.length < lines; i++) {
    for (const line of BLOCKS[i % BLOCKS.length](i)) {
      out.push(`    ${line}`);
    }
  }
  out.push("    return total");
  return `${out.join("\n")}\n`;
}
