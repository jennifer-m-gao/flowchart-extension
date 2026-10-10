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
	let sourceDocument = vscode.window.activeTextEditor?.document;

	const updatePanel = () => {
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
			code: sourceDocument.getText()
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
				updatePanel();
			}
		}, undefined, context.subscriptions);

		panel.onDidDispose(() => {
			panel = undefined;
			webviewReady = false;
		}, undefined, context.subscriptions);
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
