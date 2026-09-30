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

  await step('papers get the active color theme and VS Code grammars for highlighting', async () => {
    const s = await inspect();
    const setting = vscode.workspace.getConfiguration('workbench').get('colorTheme');
    assert.equal(s.canvases[0].textmateTheme, setting.replace(/^Default /, ''), `theme ${setting} resolved`);
    const simulate = (request) => vscode.commands.executeCommand('paperWorkspace._simulate', workspaceUri.toString(), { type: 'textmate', id: 1, request });
    const grammar = await simulate({ kind: 'grammar', scopeName: 'source.tsx' });
    assert.ok(grammar && JSON.parse(grammar.content).scopeName === 'source.tsx', 'TSX grammar content');
    const config = await simulate({ kind: 'languageConfiguration', languageId: 'typescriptreact' });
    assert.ok(config && Array.isArray(config.brackets), 'language configuration parsed from JSONC');
    assert.equal(await simulate({ kind: 'grammar', scopeName: 'source.nope' }), null);
  });

  await step('papers get the staged and committed versions of their files, updated after git add and commit', async () => {
    const a = fs.readFileSync(src('a.ts').fsPath, 'utf8');
    const banner = fs.readFileSync(src('components/Banner.tsx').fsPath, 'utf8');
    const bases = (file) => inspect().then((s) => JSON.stringify(s.canvases[0].gitBases[file]));
    const expectBases = (file, index, ref, what) => waitFor(async () => (await bases(file)) === JSON.stringify({ index, ref }), 15000, what);
    await expectBases('src/a.ts', a, a, 'a.ts: index and HEAD');
    await expectBases('src/components/Banner.tsx', '', '', 'untracked Banner.tsx: in neither');
    const cp = require('node:child_process');
    const git = (...args) => cp.execFileSync('git', ['-c', 'user.name=pw', '-c', 'user.email=pw@example.com', ...args], { cwd: ws.fsPath });
    // The Git extension may notice outside git commands late; make it look now, as focusing the window would.
    git('add', 'src/components/Banner.tsx');
    await vscode.commands.executeCommand('git.refresh');
    await expectBases('src/components/Banner.tsx', banner, '', 'staged Banner.tsx: in the index, not in HEAD');
    git('commit', '-q', '-m', 'banner');
    await vscode.commands.executeCommand('git.refresh');
    await expectBases('src/components/Banner.tsx', banner, banner, 'committed Banner.tsx');
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

  await step('Copy reference puts a reference to the workspace or one of its items on the clipboard', async () => {
    const copy = (node) => vscode.commands.executeCommand('paperWorkspace._simulate', workspaceUri.toString(), { type: 'copyReference', node });
    const [editor] = editorsIn(await workspace(), 'src/a.ts');
    const ref = await copy({ type: 'editor', id: editor.id });
    assert.equal(ref, `paperworkspace:.paperworkspace/main.workspace#editor/${editor.id}`);
    assert.equal(await vscode.env.clipboard.readText(), ref);
    assert.equal(await copy(undefined), 'paperworkspace:.paperworkspace/main.workspace');
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

  await step('export/import carries media; rename moves the media folder', async () => {
    const pw = vscode.Uri.joinPath(ws, '.paperworkspace');
    const bytes = Buffer.from('fake-png-bytes');
    const docBytes = Buffer.from('<svg/>');
    fs.mkdirSync(vscode.Uri.joinPath(pw, 'media', 'shared').fsPath, { recursive: true });
    fs.mkdirSync(vscode.Uri.joinPath(ws, 'docs').fsPath, { recursive: true });
    fs.writeFileSync(vscode.Uri.joinPath(pw, 'media', 'shared', 'shot.png').fsPath, bytes);
    fs.writeFileSync(vscode.Uri.joinPath(ws, 'docs', 'diagram.svg').fsPath, docBytes);
    const rect = { position: { x: 0, y: 0 }, width: 100, height: 80 };
    const sharedUri = vscode.Uri.joinPath(pw, 'shared.workspace');
    fs.writeFileSync(
      sharedUri.fsPath,
      JSON.stringify({
        version: 2,
        nodes: [
          { id: 'm1', type: 'media', src: '.paperworkspace/media/shared/shot.png', ...rect },
          { id: 'm2', type: 'media', src: 'docs/diagram.svg', ...rect },
        ],
        edges: [],
      }),
    );

    const bundle = vscode.Uri.joinPath(ws, 'shared.paperbundle');
    await vscode.commands.executeCommand('paperWorkspace.exportWorkspace', sharedUri, bundle);
    const exported = JSON.parse(fs.readFileSync(bundle.fsPath, 'utf8'));
    assert.equal(exported.format, 'paper-workspace-bundle');
    assert.equal(Buffer.from(exported.media['.paperworkspace/media/shared/shot.png'].data, 'base64').toString(), bytes.toString());
    assert.ok(exported.media['docs/diagram.svg'], 'repository media is embedded too');

    await vscode.commands.executeCommand('paperWorkspace.importWorkspace', bundle);
    const importedUri = vscode.Uri.joinPath(pw, 'shared-2.workspace');
    const imported = JSON.parse(fs.readFileSync(importedUri.fsPath, 'utf8'));
    const srcOf = (w, id) => w.nodes.find((n) => n.id === id).src;
    assert.equal(srcOf(imported, 'm1'), '.paperworkspace/media/shared-2/shot.png', 'owned media is copied into the new folder');
    assert.equal(fs.readFileSync(vscode.Uri.joinPath(ws, ...srcOf(imported, 'm1').split('/')).fsPath).toString(), bytes.toString());
    assert.equal(srcOf(imported, 'm2'), 'docs/diagram.svg', 'identical repository file stays referenced');

    await vscode.commands.executeCommand('paperWorkspace.renameWorkspace', importedUri, 'copy');
    const renamedUri = vscode.Uri.joinPath(pw, 'copy.workspace');
    const renamed = JSON.parse(fs.readFileSync(renamedUri.fsPath, 'utf8'));
    assert.equal(srcOf(renamed, 'm1'), '.paperworkspace/media/copy/shot.png');
    assert.ok(fs.existsSync(vscode.Uri.joinPath(pw, 'media', 'copy', 'shot.png').fsPath));
    assert.ok(!fs.existsSync(vscode.Uri.joinPath(pw, 'media', 'shared-2').fsPath));
  });

  await step('duplicate copies owned media into its own folder and keeps repository files referenced', async () => {
    const pw = vscode.Uri.joinPath(ws, '.paperworkspace');
    await vscode.commands.executeCommand('paperWorkspace.duplicateWorkspace', vscode.Uri.joinPath(pw, 'copy.workspace'), 'twin');
    const twin = JSON.parse(fs.readFileSync(vscode.Uri.joinPath(pw, 'twin.workspace').fsPath, 'utf8'));
    const srcOf = (id) => twin.nodes.find((n) => n.id === id).src;
    assert.equal(srcOf('m1'), '.paperworkspace/media/twin/shot.png');
    assert.equal(fs.readFileSync(vscode.Uri.joinPath(pw, 'media', 'twin', 'shot.png').fsPath).toString(), 'fake-png-bytes');
    assert.equal(srcOf('m2'), 'docs/diagram.svg');
    const original = JSON.parse(fs.readFileSync(vscode.Uri.joinPath(pw, 'copy.workspace').fsPath, 'utf8'));
    assert.equal(original.nodes.find((n) => n.id === 'm1').src, '.paperworkspace/media/copy/shot.png', 'original is untouched');

    await vscode.commands.executeCommand('paperWorkspace.deleteWorkspace', vscode.Uri.joinPath(pw, 'twin.workspace'), true);
    assert.ok(fs.existsSync(vscode.Uri.joinPath(pw, 'media', 'copy', 'shot.png').fsPath), "deleting the copy keeps the original's media");
  });

  await step('delete removes the media folder and loose media only that workspace uses', async () => {
    const pw = vscode.Uri.joinPath(ws, '.paperworkspace');
    const media = (...p) => vscode.Uri.joinPath(pw, 'media', ...p).fsPath;
    fs.writeFileSync(media('only-mine.png'), 'a');
    fs.writeFileSync(media('also-theirs.png'), 'b');
    const rect = { position: { x: 0, y: 0 }, width: 100, height: 80 };
    const write = (name, srcs) =>
      fs.writeFileSync(
        vscode.Uri.joinPath(pw, name + '.workspace').fsPath,
        JSON.stringify({ version: 2, nodes: srcs.map((src, i) => ({ id: 'm' + i, type: 'media', src, ...rect })), edges: [] }),
      );
    write('doomed', ['.paperworkspace/media/only-mine.png', '.paperworkspace/media/also-theirs.png', 'docs/diagram.svg']);
    write('keeper', ['.paperworkspace/media/also-theirs.png']);

    await vscode.commands.executeCommand('paperWorkspace.deleteWorkspace', vscode.Uri.joinPath(pw, 'doomed.workspace'), true);
    assert.ok(!fs.existsSync(vscode.Uri.joinPath(pw, 'doomed.workspace').fsPath));
    assert.ok(!fs.existsSync(media('only-mine.png')), 'loose media only it used is removed');
    assert.ok(fs.existsSync(media('also-theirs.png')), 'media another workspace shows is kept');
    assert.ok(fs.existsSync(vscode.Uri.joinPath(ws, 'docs', 'diagram.svg').fsPath), 'repository files are never touched');

    await vscode.commands.executeCommand('paperWorkspace.deleteWorkspace', vscode.Uri.joinPath(pw, 'copy.workspace'), true);
    assert.ok(!fs.existsSync(media('copy')), 'its own media folder is removed');
  });

  fs.writeFileSync(process.env.PW_RESULTS, results.join('\n') + '\n');
};
