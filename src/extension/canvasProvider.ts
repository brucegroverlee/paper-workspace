import * as vscode from 'vscode';
import { MEDIA_EXTS, isMediaPath, parseWorkspace, serializeWorkspace } from '../shared/workspace';
import type { HostToWebview, TextChange, WebviewToHost } from '../shared/protocol';
import type { LanguageRequest } from '../shared/language';
import { WorkspaceStore, canvasConfig, editorSettings, replaceDocument, updateCanvasConfig } from './workspaceStore';
import type { TakeoverController } from './takeover';
import { findDefinition } from './definition';
import { LanguageBridge, diagnosticsFor } from './language';

export const CANVAS_VIEW_TYPE = 'paperWorkspace.canvas';

/** Custom editor for `.workspace` files: renders the canvas webview and keeps it in sync with files. */
export class CanvasProvider implements vscode.CustomTextEditorProvider {
  private readonly sessions = new Map<string, CanvasSession>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: WorkspaceStore,
    private readonly takeover: TakeoverController,
  ) {}

  static register(context: vscode.ExtensionContext, store: WorkspaceStore, takeover: TakeoverController) {
    const provider = new CanvasProvider(context, store, takeover);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(CANVAS_VIEW_TYPE, provider, {
        // Monaco state is expensive to rebuild; keep the canvas alive when its tab is hidden.
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }),
    );
    return provider;
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
    const key = document.uri.toString();
    const session = new CanvasSession(this.context, this.store, this.takeover, document, panel);
    this.sessions.set(key, session);
    panel.onDidDispose(() => {
      session.dispose();
      if (this.sessions.get(key) === session) this.sessions.delete(key);
      this.store.viewports.delete(key);
    });
  }

  /** Diagnostic snapshot used by the integration tests (`paperWorkspace._inspect`). */
  inspect() {
    return [...this.sessions.entries()].map(([workspace, s]) => ({ workspace, ...s.inspect() }));
  }

  /** Test hook: feed a message to a canvas session as if its webview had sent it. */
  simulate(workspaceUri: string, message: WebviewToHost) {
    return this.sessions.get(workspaceUri)?.onMessage(message);
  }

  /** Open a workspace in the canvas and scroll to a node once the webview is ready. */
  async reveal(workspaceUri: vscode.Uri, nodeId?: string) {
    await vscode.commands.executeCommand('vscode.openWith', workspaceUri, CANVAS_VIEW_TYPE);
    if (nodeId) this.sessions.get(workspaceUri.toString())?.post({ type: 'revealNode', id: nodeId });
  }
}

class CanvasSession {
  private readonly disposables: vscode.Disposable[] = [];
  private ready = false;
  private readonly queue: HostToWebview[] = [];
  /** workspace `file` key -> resolved document URI string. */
  private readonly files = new Map<string, string>();
  /** Documents currently being edited from this webview; their change events must not echo back. */
  private readonly applying = new Map<string, number>();
  private readonly editQueues = new Map<string, Promise<void>>();
  private lastWritten: string | undefined;
  private autosaveTimer: NodeJS.Timeout | undefined;
  private readonly language = new LanguageBridge();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: WorkspaceStore,
    private readonly takeover: TakeoverController,
    private readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
  ) {
    const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
    // The workspace root is readable so media nodes can show images and videos stored in the workspace.
    panel.webview.options = { enableScripts: true, localResourceRoots: [distUri, store.rootFor(document.uri)] };
    panel.webview.html = this.html(distUri);

    this.disposables.push(
      panel.webview.onDidReceiveMessage((m: WebviewToHost) => this.onMessage(m)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e)),
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDocumentSaved(doc)),
      vscode.languages.onDidChangeDiagnostics((e) => {
        for (const uri of e.uris) this.postDiagnostics(uri);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('editor')) this.post({ type: 'settings', settings: editorSettings() });
        if (['minNodeWidth', 'minNodeHeight', 'focusPercent', 'canvasBackground'].some((k) => e.affectsConfiguration(`paperWorkspace.${k}`))) {
          this.post({ type: 'config', config: canvasConfig() });
        }
      }),
    );
  }

  dispose() {
    clearTimeout(this.autosaveTimer);
    clearTimeout(this.revealTimer);
    this.disposables.forEach((d) => d.dispose());
  }

  private readonly received = new Map<string, number>();

  inspect() {
    return {
      ready: this.ready,
      files: [...this.files.keys()],
      received: Object.fromEntries(this.received),
      lastRevealed: this.lastRevealed?.file,
    };
  }

  post(message: HostToWebview) {
    if (!this.ready) this.queue.push(message);
    else void this.panel.webview.postMessage(message);
  }

  /** Public so integration tests can drive the host side without a real webview UI. */
  async onMessage(m: WebviewToHost) {
    this.received.set(m.type, (this.received.get(m.type) ?? 0) + 1);
    switch (m.type) {
      case 'ready': {
        const { workspace, error } = parseWorkspace(this.document.getText());
        this.ready = true;
        const mediaRoot = this.panel.webview.asWebviewUri(this.store.rootFor(this.document.uri)).toString();
        void this.panel.webview.postMessage({
          type: 'init',
          workspace,
          error,
          settings: editorSettings(),
          config: canvasConfig(),
          mediaRoot,
        } satisfies HostToWebview);
        this.queue.splice(0).forEach((q) => this.post(q));
        break;
      }
      case 'update':
        await this.writeWorkspace(serializeWorkspace(m.workspace));
        break;
      case 'openDoc':
        await this.openDoc(m.file);
        break;
      case 'edit':
        await this.enqueueEdit(m.file, m.changes);
        break;
      case 'viewport':
        this.store.viewports.set(this.document.uri.toString(), { center: m.center, zoom: m.zoom });
        break;
      case 'openInEditor': {
        const uri = this.store.resolveWorkspacePath(this.document.uri, m.file);
        this.takeover.bypassOnce(uri);
        const start = new vscode.Position(Math.max(0, m.line - 1), 0);
        await vscode.window.showTextDocument(uri, {
          viewColumn: vscode.ViewColumn.Beside,
          selection: new vscode.Range(start, start),
        });
        break;
      }
      case 'goToDefinition':
        await this.goToDefinition(m.file, m.line, m.column);
        break;
      case 'language': {
        const result = await this.languageRequest(m.file, m.request);
        this.post({ type: 'languageResult', id: m.id, result });
        return result; // for integration tests (`_simulate`)
      }
      case 'dropUris': {
        let offset = 0;
        const media: string[] = [];
        for (const s of m.uris) {
          const uri = vscode.Uri.parse(s);
          try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type & vscode.FileType.Directory) continue;
            if (isMediaPath(uri.path)) {
              media.push(await this.store.importMedia(this.document.uri, uri));
              continue;
            }
            await this.store.addSnippet(this.document.uri, uri, undefined, {
              x: m.position.x + offset,
              y: m.position.y + offset,
            });
            offset += 48;
          } catch (e) {
            void vscode.window.showWarningMessage(`Paper Workspace: could not add ${uri.fsPath}: ${(e as Error).message}`);
          }
        }
        if (media.length) this.post({ type: 'mediaAdded', srcs: media, position: m.position });
        break;
      }
      case 'pickMedia': {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: 'Add to canvas',
          defaultUri: this.store.rootFor(this.document.uri),
          filters: { 'Images and videos': MEDIA_EXTS },
        });
        if (!picked?.length) break;
        try {
          const srcs = await Promise.all(picked.map((uri) => this.store.importMedia(this.document.uri, uri)));
          this.post({ type: 'mediaAdded', srcs, position: m.position });
        } catch (e) {
          void vscode.window.showWarningMessage(`Paper Workspace: could not add media: ${(e as Error).message}`);
        }
        break;
      }
      case 'saveMedia':
        try {
          const src = await this.store.saveMedia(this.document.uri, m.name, Buffer.from(m.data, 'base64'));
          this.post({ type: 'mediaAdded', srcs: [src], position: m.position });
        } catch (e) {
          void vscode.window.showWarningMessage(`Paper Workspace: could not save the pasted media: ${(e as Error).message}`);
        }
        break;
      case 'save':
        await this.saveAll();
        break;
      case 'setConfig':
        try {
          await updateCanvasConfig(m.config);
        } catch (e) {
          void vscode.window.showWarningMessage(`Paper Workspace: could not save the configuration: ${(e as Error).message}`);
          this.post({ type: 'config', config: canvasConfig() });
        }
        break;
      case 'nodeFocused':
        this.scheduleExplorerReveal(m.file);
        break;
    }
  }

  // ---- go to definition ----------------------------------------------------------------------

  /** Ctrl/Cmd+click: add (or reveal) a paper for the definition, next to the file that was clicked. */
  private async goToDefinition(file: string, line: number, column: number) {
    const source = this.store.resolveWorkspacePath(this.document.uri, file);
    try {
      const doc = await vscode.workspace.openTextDocument(source);
      const found = await findDefinition(doc, new vscode.Position(line - 1, column - 1));
      if (!found) {
        void vscode.window.setStatusBarMessage('Paper Workspace: no definition found', 3000);
        return;
      }
      const id = await this.store.addSnippet(this.document.uri, found.uri, found.target, undefined, file);
      this.post({ type: 'revealNode', id });
    } catch (e) {
      void vscode.window.showWarningMessage(`Paper Workspace: could not go to definition: ${(e as Error).message}`);
    }
  }

  // ---- intellisense -------------------------------------------------------------------------

  private async languageRequest(file: string, request: LanguageRequest) {
    const s = this.files.get(file);
    if (!s) return null;
    // Let this webview's pending edits land first, so positions refer to the same text in both places.
    await this.editQueues.get(file);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === s) ?? (await vscode.workspace.openTextDocument(vscode.Uri.parse(s)));
    return this.language.handle(doc, request);
  }

  private postDiagnostics(uri: vscode.Uri) {
    const keys = this.keysFor(uri);
    if (!keys.length) return;
    const diagnostics = diagnosticsFor(uri);
    for (const file of keys) this.post({ type: 'diagnostics', file, diagnostics });
  }

  // ---- explorer sync -------------------------------------------------------------------------

  private revealTimer: NodeJS.Timeout | undefined;
  private lastRevealed: { file: string; at: number } | undefined;

  /** Select the focused paper's file in the Explorer, then give keyboard focus back to the canvas. */
  private scheduleExplorerReveal(file: string) {
    if (!vscode.workspace.getConfiguration('paperWorkspace').get<boolean>('revealInExplorer', true)) return;
    clearTimeout(this.revealTimer);
    // Debounced: selection changes arrive in bursts (click, box-select, reveal after add).
    this.revealTimer = setTimeout(() => void this.revealInExplorer(file), 150);
  }

  private async revealInExplorer(file: string) {
    const now = Date.now();
    if (this.lastRevealed?.file === file && now - this.lastRevealed.at < 1000) return;
    this.lastRevealed = { file, at: now };
    const uri = this.store.resolveWorkspacePath(this.document.uri, file);
    if (!vscode.workspace.getWorkspaceFolder(uri)) return; // the Explorer only shows workspace files
    try {
      // `revealInExplorer` also focuses the Explorer; take focus back so typing in the paper continues.
      await vscode.commands.executeCommand('revealInExplorer', uri);
      this.panel.reveal(this.panel.viewColumn, false);
      this.post({ type: 'restoreFocus' });
    } catch (e) {
      console.warn('[workspace-workspace] reveal in explorer failed', e);
    }
  }

  // ---- workspace layout -----------------------------------------------------------------------

  private async writeWorkspace(text: string) {
    if (text === this.document.getText()) return;
    this.lastWritten = text;
    await replaceDocument(this.document, text);
  }

  private scheduleAutosave() {
    if (!vscode.workspace.getConfiguration('paperWorkspace').get<boolean>('autoSaveLayout', true)) return;
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      if (this.document.isDirty) void this.document.save();
    }, 800);
  }

  // ---- source documents ----------------------------------------------------------------------

  private async openDoc(file: string) {
    const uri = this.store.resolveWorkspacePath(this.document.uri, file);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      this.files.set(file, doc.uri.toString());
      this.post({
        type: 'doc',
        file,
        text: doc.getText(),
        languageId: doc.languageId,
        eol: doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n',
        dirty: doc.isDirty,
      });
      this.postDiagnostics(doc.uri);
    } catch (e) {
      this.post({ type: 'doc', file, error: `Cannot open ${file}: ${(e as Error).message}` });
    }
  }

  private keysFor(uri: vscode.Uri): string[] {
    const s = uri.toString();
    const keys: string[] = [];
    for (const [k, v] of this.files) if (v === s) keys.push(k);
    return keys;
  }

  /** Edits for one file are applied strictly in order so the host document matches the webview model. */
  private enqueueEdit(file: string, changes: TextChange[]) {
    const prev = this.editQueues.get(file) ?? Promise.resolve();
    const next = prev.then(() => this.applyEdit(file, changes)).catch((e) => {
      console.error('[workspace-workspace] edit failed', e);
    });
    this.editQueues.set(file, next);
    return next;
  }

  private async applyEdit(file: string, changes: TextChange[]) {
    const s = this.files.get(file);
    if (!s) return;
    const uri = vscode.Uri.parse(s);
    const edit = new vscode.WorkspaceEdit();
    for (const c of changes) {
      edit.replace(uri, new vscode.Range(c.startLine - 1, c.startColumn - 1, c.endLine - 1, c.endColumn - 1), c.text);
    }
    this.applying.set(s, (this.applying.get(s) ?? 0) + 1);
    try {
      await vscode.workspace.applyEdit(edit);
    } finally {
      const n = (this.applying.get(s) ?? 1) - 1;
      if (n <= 0) this.applying.delete(s);
      else this.applying.set(s, n);
    }
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === s);
    if (doc) this.post({ type: 'docState', file, dirty: doc.isDirty, length: doc.getText().length, ack: true });
  }

  private onDocumentChanged(e: vscode.TextDocumentChangeEvent) {
    if (e.document === this.document) {
      // Any layout change (canvas, commands, undo) is persisted; only echoes are not re-sent.
      if (e.contentChanges.length) this.scheduleAutosave();
      const text = this.document.getText();
      if (text === this.lastWritten) return;
      const { workspace, error } = parseWorkspace(text);
      this.post({ type: 'workspace', workspace, error });
      return;
    }
    const keys = this.keysFor(e.document.uri);
    if (!keys.length) return;
    const echo = this.applying.has(e.document.uri.toString());
    for (const file of keys) {
      if (echo || !e.contentChanges.length) {
        this.post({ type: 'docState', file, dirty: e.document.isDirty });
        continue;
      }
      this.post({
        type: 'docChanged',
        file,
        changes: e.contentChanges.map((c) => ({
          startLine: c.range.start.line + 1,
          startColumn: c.range.start.character + 1,
          endLine: c.range.end.line + 1,
          endColumn: c.range.end.character + 1,
          text: c.text,
        })),
        length: e.document.getText().length,
        dirty: e.document.isDirty,
      });
    }
  }

  private onDocumentSaved(doc: vscode.TextDocument) {
    for (const file of this.keysFor(doc.uri)) this.post({ type: 'docState', file, dirty: false });
  }

  /** Ctrl/Cmd+S inside the canvas: save the layout and every dirty file shown on it. */
  private async saveAll() {
    const uris = new Set([this.document.uri.toString(), ...this.files.values()]);
    const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && uris.has(d.uri.toString()));
    await Promise.all(dirty.map((d) => d.save()));
  }

  // ---- html ----------------------------------------------------------------------------------

  private html(distUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(distUri, name)).toString();
    const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join('');
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource} data:`,
      `media-src ${webview.cspSource} data: blob:`,
      // Monaco injects <style> tags at runtime.
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' ${webview.cspSource}`,
      `worker-src blob:`,
      `connect-src ${webview.cspSource}`,
    ].join('; ');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="pw-worker" content="${asset('editor.worker.js')}" />
  <link rel="stylesheet" href="${asset('webview.css')}" />
  <title>Paper Workspace</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
  }
}
