import { statSync } from "node:fs";
const LIMIT = 2000000; // 2 MB, D23 (1.2) target
const size = statSync(new URL("../dist/webview/bundle.js", import.meta.url)).size;
console.log(`bundle: ${size} bytes (limit ${LIMIT}, ${((size / LIMIT) * 100).toFixed(1)}%)`);
if (size >= LIMIT) { console.error("bundle size gate FAILED"); process.exit(1); }
