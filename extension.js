const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	let panel;
	let webviewReady = false;
	let updateTimer;
	let cursorTimer;
	let running = false;
	let sourceDocument = vscode.window.activeTextEditor?.document;

	const post = message => panel?.webview.postMessage(message);
	const runError = message => post({ type: 'runStatus', state: 'error', message });

	// Runs the file once under python/tracer.py and posts the trace (only on an explicit Run, D19).
	const runFile = async () => {
		if (running) {
			post({ type: 'runStatus', state: 'running' });
			return;
		}
		const doc = sourceDocument;
		if (!doc || doc.languageId !== 'python') {
			runError('Open a Python file to run it.');
			return;
		}
		running = true;
		const codeVersion = doc.version;
		const id = crypto.randomBytes(8).toString('hex');
		const outPath = path.join(os.tmpdir(), `pychart-trace-${id}.json`);
		let tempTarget;
		try {
			post({ type: 'runStatus', state: 'running' });
			let target;
			if (doc.isUntitled || doc.uri.scheme !== 'file') {
				tempTarget = path.join(os.tmpdir(), `pychart-${id}.py`);
				fs.writeFileSync(tempTarget, doc.getText(), 'utf8');
				target = tempTarget;
			} else {
				await doc.save(); // like VS Code's Run Python File (D26)
				target = doc.uri.fsPath;
			}
			const python = await resolvePython(doc.uri);
			if (!python) {
				runError('No Python interpreter found. Install Python or select one with "Python: Select Interpreter".');
				return;
			}
			const tracerPath = path.join(context.extensionPath, 'python', 'tracer.py');
			// 15 s outer safety net above the tracer's own 10 s limit
			const result = await runProcess(python.exe, [...python.prefix, tracerPath, target, outPath], path.dirname(target), 15000);
			if (result.killed) {
				runError('The run took too long and was stopped.');
				return;
			}
			let trace;
			try {
				trace = JSON.parse(fs.readFileSync(outPath, 'utf8'));
			} catch {
				runError(result.stderr.slice(0, 500) || 'The run produced no trace.');
				return;
			}
			post({ type: 'trace', trace, codeVersion });
			post({ type: 'runStatus', state: 'done', reason: trace.reason });
		} catch (err) {
			runError(String(err?.message || err));
		} finally {
			running = false;
			fs.rmSync(outPath, { force: true });
			if (tempTarget) {
				fs.rmSync(tempTarget, { force: true });
			}
		}
	};

	const sourceOffset = () => {
		const editor = vscode.window.visibleTextEditors.find(e => e.document === sourceDocument);
		return editor ? sourceDocument.offsetAt(editor.selection.active) : 0;
	};

	const updatePanel = () => {
		updateTimer = undefined; // no text-change update pending any more
		if (!panel || !webviewReady) {
			return;
		}

		if (!sourceDocument) {
			panel.webview.postMessage({
				type: 'setMessage',
				text: 'Open a Python file in the editor to generate a diagram.'
			});
			return;
		}

		if (sourceDocument.languageId !== 'python') {
			panel.webview.postMessage({
				type: 'setMessage',
				text: 'The PyChart visualizer supports Python files.'
			});
			return;
		}

		panel.webview.postMessage({
			type: 'setCode',
			code: sourceDocument.getText(),
			offset: sourceOffset()
		});
	};

	const openFlowchart = () => {
		if (panel) {
			panel.reveal(vscode.ViewColumn.Beside);
			updatePanel();
			return;
		}

		panel = vscode.window.createWebviewPanel(
			'flowchartVisualizer',
			'PyChart Visualizer',
			vscode.ViewColumn.Beside,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.file(path.join(context.extensionPath, 'webview')),
					vscode.Uri.file(path.join(context.extensionPath, 'dist'))
				]
			}
		);

		const panelDisposables = [];
		const nonce = getNonce();
		const webviewPath = path.join(context.extensionPath, 'webview');
		const scriptUri = panel.webview.asWebviewUri(
			vscode.Uri.file(path.join(context.extensionPath, 'dist', 'webview', 'bundle.js'))
		);
		const styleUri = panel.webview.asWebviewUri(vscode.Uri.file(path.join(webviewPath, 'index.css')));
		const htmlPath = path.join(webviewPath, 'index.html');
		const htmlContent = fs.readFileSync(htmlPath, 'utf8');

		panel.webview.html = htmlContent
			.replace(/\{\{cspSource\}\}/g, panel.webview.cspSource)
			.replace(/\{\{nonce\}\}/g, nonce)
			.replace('{{scriptUri}}', scriptUri.toString())
			.replace('{{styleUri}}', styleUri.toString());

		panel.webview.onDidReceiveMessage(message => {
			if (message.type === 'ready') {
				webviewReady = true;
				panel.webview.postMessage({ type: 'tipState', dismissed: context.globalState.get('pychart.tipDismissed', false) });
				updatePanel();
			} else if (message.type === 'tipDismissed') {
				context.globalState.update('pychart.tipDismissed', true);
			} else if (message.type === 'run') {
				runFile();
			} else if (message.type === 'reveal' && sourceDocument
				&& Number.isInteger(message.from) && Number.isInteger(message.to)) {
				const length = sourceDocument.getText().length;
				const from = Math.max(0, Math.min(message.from, length));
				const to = Math.max(from, Math.min(message.to, length));
				const editor = vscode.window.visibleTextEditors.find(e => e.document === sourceDocument);
				const range = new vscode.Range(sourceDocument.positionAt(from), sourceDocument.positionAt(to));
				vscode.window.showTextDocument(sourceDocument, {
					viewColumn: editor ? editor.viewColumn : vscode.ViewColumn.One,
					selection: range,
					preserveFocus: false
				}).then(shown => shown.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport));
			}
		}, undefined, panelDisposables);

		panel.onDidDispose(() => {
			panel = undefined;
			webviewReady = false;
			clearTimeout(updateTimer);
			clearTimeout(cursorTimer);
			while (panelDisposables.length) {
				panelDisposables.pop().dispose();
			}
		});
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('pychart-extension.openFlowchart', openFlowchart),
		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor) {
				sourceDocument = editor.document;
			}
			updatePanel();
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === sourceDocument) {
				clearTimeout(updateTimer);
				updateTimer = setTimeout(updatePanel, 100);
			}
		}),
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (!panel || !webviewReady || event.textEditor.document !== sourceDocument) {
				return;
			}
			clearTimeout(cursorTimer);
			cursorTimer = setTimeout(() => {
				// a pending setCode already carries the fresh offset; a stale-order setCursor would use the old document
				if (panel && webviewReady && updateTimer === undefined) {
					panel.webview.postMessage({ type: 'setCursor', offset: sourceDocument.offsetAt(event.selections[0].active) });
				}
			}, 50);
		}),
		vscode.workspace.onDidCloseTextDocument(document => {
			if (document === sourceDocument) {
				sourceDocument = undefined;
				updatePanel();
			}
		})
	);
}

// Spawns without a shell; resolves { code, stderr (first ~500 chars), killed } and never rejects.
function runProcess(exe, args, cwd, timeoutMs) {
	return new Promise(resolve => {
		let stderr = '';
		let killed = false;
		let child;
		try {
			child = spawn(exe, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
		} catch (err) {
			resolve({ code: null, stderr: String(err), killed });
			return;
		}
		const timer = setTimeout(() => {
			killed = true;
			child.kill();
		}, timeoutMs);
		child.stdout.resume(); // drain so a chatty child never blocks on a full pipe
		child.stderr.on('data', data => {
			if (stderr.length < 500) {
				stderr += data;
			}
		});
		child.on('error', err => {
			clearTimeout(timer);
			resolve({ code: null, stderr: String(err), killed });
		});
		child.on('close', code => {
			clearTimeout(timer);
			resolve({ code, stderr, killed });
		});
	});
}

// ms-python's active interpreter, then its execution command, then python / py -3 (Windows) / python3.
async function resolvePython(uri) {
	const candidates = [];
	let api;
	try {
		api = await vscode.extensions.getExtension('ms-python.python')?.activate();
	} catch {
		// fall through to the next source
	}
	try {
		const env = await api.environments.resolveEnvironment(api.environments.getActiveEnvironmentPath(uri));
		if (env?.executable?.uri?.fsPath) {
			candidates.push([env.executable.uri.fsPath]);
		}
	} catch {
		// fall through
	}
	try {
		const command = api.settings.getExecutionDetails(uri).execCommand;
		if (Array.isArray(command) && command.length) {
			candidates.push(command);
		}
	} catch {
		// fall through
	}
	candidates.push(['python']);
	if (process.platform === 'win32') {
		candidates.push(['py', '-3']);
	}
	candidates.push(['python3']);
	for (const [exe, ...prefix] of candidates) {
		if ((await runProcess(exe, [...prefix, '--version'], undefined, 2000)).code === 0) {
			return { exe, prefix };
		}
	}
	return null;
}

function getNonce() {
	return crypto.randomBytes(16).toString('hex');
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};
