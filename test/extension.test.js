const assert = require('assert');
const fs = require('fs');
const path = require('path');

const vscode = require('vscode');
const extensionRoot = path.join(__dirname, '..');

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('visualizer keeps its diagram and footer controls without a text-entry area', () => {
		const html = fs.readFileSync(path.join(extensionRoot, 'webview', 'index.html'), 'utf8');
		const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));

		assert.match(html, /<main class="flowchart"/);
		assert.match(html, /id="display"/);
		assert.match(html, /<footer class="diagram-toolbar">/);
		assert.match(html, /<select id="diagram-mode">/);
		assert.match(html, /<option value="functions">/);
		assert.match(html, /<option value="timeline">/);
		assert.match(html, /id="time-track"/);
		assert.doesNotMatch(html, /<textarea\b/i);
		assert.ok(manifest.contributes.commands.some(command =>
			command.command === 'flowchart-extension.openFlowchart'
		));
	});

	test('opens the visualizer from its command', async () => {
		await vscode.commands.executeCommand('flowchart-extension.openFlowchart');
	});
});
