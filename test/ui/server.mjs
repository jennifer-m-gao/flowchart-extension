// Serves the PyChart webview from a built checkout, with harness.html standing in for the VS Code host.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CHECKOUT = process.env.PYCHART_CHECKOUT || path.resolve(HERE, "..", "..");
export const NONCE = "harnessNonce0123456789abcdef";

// VS Code "Dark Modern" / "Light Modern" values (the current default themes) for every var index.css reads.
const THEMES = `
body.vscode-dark {
  --vscode-editor-background:#1f1f1f; --vscode-editor-foreground:#cccccc; --vscode-foreground:#cccccc;
  --vscode-editor-font-family:Consolas, 'Courier New', monospace;
  --vscode-descriptionForeground:#9d9d9d; --vscode-focusBorder:#0078d4;
  --vscode-panel-border:#2b2b2b; --vscode-editorWidget-border:#454545; --vscode-sideBar-background:#181818;
  --vscode-dropdown-background:#313131; --vscode-dropdown-foreground:#cccccc; --vscode-dropdown-border:#3c3c3c; --vscode-input-border:#3c3c3c;
  --vscode-button-background:#0078d4; --vscode-button-foreground:#ffffff;
  --vscode-button-secondaryBackground:#313131; --vscode-button-secondaryForeground:#cccccc;
  --vscode-editorWidget-background:#202020; --vscode-editor-inactiveSelectionBackground:#3a3d41;
  --vscode-editorCursor-foreground:#aeafad; --vscode-editorLineNumber-foreground:#6e7681;
  --vscode-testing-iconPassed:#73c991; --vscode-testing-iconFailed:#f14c4c; --vscode-errorForeground:#f85149;
}
body.vscode-light {
  --vscode-editor-background:#ffffff; --vscode-editor-foreground:#3b3b3b; --vscode-foreground:#3b3b3b;
  --vscode-editor-font-family:Consolas, 'Courier New', monospace;
  --vscode-descriptionForeground:#3b3b3b; --vscode-focusBorder:#005fb8;
  --vscode-panel-border:#e5e5e5; --vscode-editorWidget-border:#c8c8c8; --vscode-sideBar-background:#f8f8f8;
  --vscode-dropdown-background:#ffffff; --vscode-dropdown-foreground:#3b3b3b; --vscode-dropdown-border:#cecece; --vscode-input-border:#cecece;
  --vscode-button-background:#005fb8; --vscode-button-foreground:#ffffff;
  --vscode-button-secondaryBackground:#e5e5e5; --vscode-button-secondaryForeground:#3b3b3b;
  --vscode-editorWidget-background:#f8f8f8; --vscode-editor-inactiveSelectionBackground:#e5ebf1;
  --vscode-editorCursor-foreground:#000000; --vscode-editorLineNumber-foreground:#6e7681;
  --vscode-testing-iconPassed:#388a34; --vscode-testing-iconFailed:#f14c4c; --vscode-errorForeground:#f85149;
}`;

export function defaultCandidates() {
  const e = process.env;
  if (process.platform === "win32") {
    return [
      `${e.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${e["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      `${e.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${e["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${e.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ];
  }
  if (process.platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
}

// First browser that exists: the CHROME env var, then the platform's usual install paths; null if none.
export function findBrowser(candidates = defaultCandidates()) {
  const list = process.env.CHROME ? [process.env.CHROME, ...candidates] : candidates;
  return list.find((p) => fs.existsSync(p)) ?? null;
}

const SHIM = "window.__posted=[];window.__state=undefined;window.acquireVsCodeApi=()=>({postMessage:m=>window.__posted.push(m),getState:()=>window.__state,setState:s=>{window.__state=s}});";

// Fill the placeholders the way extension.js does; the CSP meta is kept intact.
export function harnessHtml(origin) {
  const html = fs.readFileSync(path.join(CHECKOUT, "webview", "index.html"), "utf8")
    .replace(/\{\{cspSource\}\}/g, origin)
    .replace(/\{\{nonce\}\}/g, NONCE)
    .replace("{{scriptUri}}", `${origin}/dist/webview/bundle.js`)
    .replace("{{styleUri}}", `${origin}/webview/index.css`)
    .replace("<body>", '<body class="vscode-dark">')
    .replace("</head>", `<style>${THEMES}</style>\n</head>`)
    .replace(`<script nonce="${NONCE}" src=`, `<script nonce="${NONCE}">${SHIM}</script>\n  <script nonce="${NONCE}" src=`);
  if (!html.includes(SHIM) || !html.includes("Content-Security-Policy")) {
    throw new Error("index.html no longer matches the harness template");
  }
  return html;
}

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".py": "text/plain" };

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const origin = `http://${req.headers.host}`;
    if (url.pathname === "/" || url.pathname === "/harness.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(harnessHtml(origin));
    }
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204); // Chrome asks for it; a VS Code webview never does
      return res.end();
    }
    // Only the folders the real webview may load (localResourceRoots).
    const file = path.normalize(path.join(CHECKOUT, decodeURIComponent(url.pathname)));
    const allowed = ["webview", "dist"].some((d) => file.startsWith(path.join(CHECKOUT, d) + path.sep));
    if (!allowed || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.env.PORT) || 5173);
  console.log(`harness at http://127.0.0.1:${server.address().port}/harness.html`);
}
