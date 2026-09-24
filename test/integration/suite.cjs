// Runs inside a real VS Code extension host (see scripts/integration.mjs).
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000, what = 'condition') {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}: ${last && last.message ? last.message : JSON.stringify(last)}`);
}

exports.run = async function run() {
  const results = [];
  const step = async (name, fn) => {
    try {
      await fn();
      results.push(`PASS ${name}`);
    } catch (e) {
      results.push(`FAIL ${name}\n    ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join('\n    ')}`);
    }
  };

  const ws = vscode.workspace.workspaceFolders[0].uri;
  const src = (name) => vscode.Uri.joinPath(ws, 'src', name);
  const workspaceUri = vscode.Uri.joinPath(ws, '.paperworkspace', 'main.workspace');
  const workspace = async () => JSON.parse((await vscode.workspace.openTextDocument(workspaceUri)).getText());
  const textTabs = (uri) =>
    vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === uri.toString());
  const inspect = () => vscode.commands.executeCommand('paperWorkspace._inspect');
  // v2 model: file nodes (one per source file) contain editor nodes (snippets).
  const fileNode = (p, file) => p.nodes.find((n) => n.type === 'file' && n.file === file);
  const editorsIn = (p, file) => {
    const f = fileNode(p, file);
    return f ? p.nodes.filter((n) => n.type === 'editor' && n.parent === f.id) : [];
  };

  await vscode.extensions.getExtension('paper-workspace.paper-workspace').activate();

  await step('manual mode: Add Selection creates a node with the selected lines and opens the canvas', async () => {
    await vscode.commands.executeCommand('paperWorkspace.setMode', 'manual');
    const editor = await vscode.window.showTextDocument(src('a.ts'));
    editor.selection = new vscode.Selection(2, 0, 5, 3); // lines 3-6
    await vscode.commands.executeCommand('paperWorkspace.addSelection');
    const p = await workspace();
    assert.equal(p.version, 2);
    assert.ok(fileNode(p, 'src/a.ts'), 'file node for a.ts');
    const editors = editorsIn(p, 'src/a.ts');
    assert.equal(editors.length, 1);
    assert.deepEqual(editors[0].target, { start: 3, end: 6 });
    assert.equal(editors[0].anchor, 'export function three() {');
    const canvasTab = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .find((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === 'paperWorkspace.canvas');
    assert.ok(canvasTab, 'canvas tab is open');
  });

  await step('canvas webview boots in VS Code (CSP, module script) and requests the source file', async () => {
    const state = await waitFor(async () => {
      const s = await inspect();
      const c = s.canvases[0];
      return c && c.ready && c.files.includes('src/a.ts') ? s : undefined;
    }, 15000, 'webview ready + openDoc');
    assert.equal(state.canvases[0].received.ready, 1, 'ready sent exactly once');
  });

  await step('adding lines inside an existing target reuses that snippet', async () => {
    const editor = await vscode.window.showTextDocument(src('a.ts'));
    editor.selection = new vscode.Selection(3, 0, 4, 0);
    await vscode.commands.executeCommand('paperWorkspace.addSelection');
    assert.equal((await workspace()).nodes.length, 2);
  });

  await step('adding other lines of the same file adds a second snippet inside the same file node', async () => {
    const editor = await vscode.window.showTextDocument(src('a.ts'));
    editor.selection = new vscode.Selection(6, 0, 6, 5); // line 7
    await vscode.commands.executeCommand('paperWorkspace.addSelection');
    const p = await workspace();
    assert.equal(p.nodes.filter((n) => n.type === 'file').length, 1);
    const editors = editorsIn(p, 'src/a.ts');
    assert.equal(editors.length, 2);
    assert.deepEqual(editors[1].target, { start: 7, end: 7 });
    assert.ok(editors[1].position.y > editors[0].position.y, 'placed below the first snippet');
  });

  await step('focusing a paper reveals its file in the Explorer and keeps the canvas active', async () => {
    await vscode.commands.executeCommand('paperWorkspace._simulate', workspaceUri.toString(), {
      type: 'nodeFocused',
      file: 'src/a.ts',
    });
    const s = await waitFor(async () => {
      const r = await inspect();
      return r.canvases[0] && r.canvases[0].lastRevealed === 'src/a.ts' ? r : undefined;
    }, 4000, 'reveal');
    assert.ok(s);
    await sleep(300);
    const active = vscode.window.tabGroups.activeTabGroup.activeTab;
    assert.ok(
      active && active.input instanceof vscode.TabInputCustom && active.input.viewType === 'paperWorkspace.canvas',
      'canvas is still the active editor',
    );
  });

  await step('layout is auto-saved to .paperworkspace/main.workspace', async () => {
    await waitFor(async () => !(await vscode.workspace.openTextDocument(workspaceUri)).isDirty, 5000, 'workspace saved');
    const disk = JSON.parse(fs.readFileSync(workspaceUri.fsPath, 'utf8'));
    assert.equal(disk.nodes.length, 3);
  });

  await step('Ctrl+click on an import path adds the imported file to the canvas', async () => {
    const line = "import Banner from './components/Banner';";
    await vscode.commands.executeCommand('paperWorkspace._simulate', workspaceUri.toString(), {
      type: 'goToDefinition',
      file: 'src/e.ts',
      line: 1,
      column: line.indexOf('components') + 1,
    });
    const p = await waitFor(async () => {
      const r = await workspace();
      return editorsIn(r, 'src/components/Banner.tsx').length === 1 ? r : undefined;
    }, 15000, 'Banner.tsx snippet');
    assert.equal(editorsIn(p, 'src/components/Banner.tsx')[0].target, undefined, 'a module path opens the whole file');
  });

  await step('IntelliSense in papers comes from VS Code language providers', async () => {
    const ask = (request) =>
      vscode.commands.executeCommand('paperWorkspace._simulate', workspaceUri.toString(), { type: 'language', id: 1, file: 'src/a.ts', request });
    // The TypeScript server may still be loading the project; retry until it answers.
    const hover = await waitFor(() => ask({ kind: 'hover', line: 3, column: 18 }), 30000, 'hover');
    assert.ok(hover.contents.some((c) => c.value.includes('three')), JSON.stringify(hover));
    const completion = await waitFor(() => ask({ kind: 'completion', line: 4, column: 10 }), 15000, 'completion');
    const labels = completion.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    assert.ok(labels.includes('seven'), 'completes a declaration from the same file');
  });

  await step('take-over mode: opening a file closes its text tab and adds it to the target', async () => {
    await vscode.commands.executeCommand('paperWorkspace.setMode', 'takeover');
    await vscode.window.showTextDocument(src('b.ts'), { preview: false });
    await waitFor(async () => editorsIn(await workspace(), 'src/b.ts').length === 1, 8000, 'b.ts snippet');
    await waitFor(() => textTabs(src('b.ts')).length === 0, 4000, 'b.ts tab closed');
    const [editor] = editorsIn(await workspace(), 'src/b.ts');
    assert.equal(editor.target, undefined, 'whole-file editor has no target');
  });

  await step('take-over mode: opening at a line (go to definition) shows a window around it', async () => {
    const line = 119; // 0-based -> line 120
    await vscode.window.showTextDocument(src('c.ts'), {
      preview: false,
      selection: new vscode.Range(line, 0, line, 0),
    });
    await waitFor(async () => editorsIn(await workspace(), 'src/c.ts').length === 1, 8000, 'c.ts snippet');
    const [editor] = editorsIn(await workspace(), 'src/c.ts');
    assert.deepEqual(editor.target, { start: 118, end: 147 }, 'got ' + JSON.stringify(editor.target));
  });

  await step('off mode: files open normally and nothing is added', async () => {
    await vscode.commands.executeCommand('paperWorkspace.setMode', 'off');
    await vscode.window.showTextDocument(src('d.ts'), { preview: false });
    await sleep(800);
    assert.equal(textTabs(src('d.ts')).length, 1, 'off mode leaves the tab alone');
    assert.equal(fileNode(await workspace(), 'src/d.ts'), undefined);
  });

  await step('mode and target are persisted in workspace state', async () => {
    const s = await inspect();
    assert.equal(s.target, workspaceUri.toString());
    assert.equal(s.mode, 'off');
  });

  fs.writeFileSync(process.env.PW_RESULTS, results.join('\n') + '\n');
};
