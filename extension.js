const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	let panel;
	let webviewReady = false;
	let updateTimer;
	let cursorTimer;
	let sourceDocument = vscode.window.activeTextEditor?.document;

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

function getNonce() {
	return crypto.randomBytes(16).toString('hex');
}

function deactivate() {}

module.exports = {
	activate,
	deactivate
};
