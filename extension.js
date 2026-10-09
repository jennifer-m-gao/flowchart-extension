// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');


// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "flowchart-extension" is now active!');

	const panel = vscode.window.createWebviewPanel(
		'viewType',          // Internal identifier for the webview
		'Flowchart Visualizer',  // Title displayed in the tab
		vscode.ViewColumn.Beside, // Editor column to show it in
		{
			enableScripts: true, // CRITICAL: Must be true to run JS inside the Webview
			localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview'))]
		}
	);

	const htmlPath = path.join(context.extensionPath, 'webview', 'index.html');

	let htmlContent = fs.readFileSync(htmlPath, 'utf8');
	
	panel.webview.html = convertLocalPaths(htmlContent, panel, context);

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('flowchart-extension.helloWorld', function () {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from flowchart-extension!');
	});

	context.subscriptions.push(disposable);
}

function getWebviewContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Webview UI</title>
    </head>
    <body>
        <h1>Hello from the Webview!</h1>
    </body>
    </html>`;
}

function convertLocalPaths(html, panel, context) {
    // 1. Get the URI to the 'src' directory
    const srcUri = vscode.Uri.file(path.join(context.extensionPath, 'webview'));
    const webviewSrcUri = panel.webview.asWebviewUri(srcUri);

    // 2. Replace relative paths in your HTML with the webview-safe base URI
    // This turns href="style.css" into href="https://file+.vscode-resource.vscode-cdn.net/..."
    return html
        .replace(/href="style\.css"/g, `href="${webviewSrcUri}/style.css"`)
        .replace(/src="script\.js"/g, `src="${webviewSrcUri}/script.js"`);
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
