import * as vscode from 'vscode';
import { MEDIA_EXTS, WORKSPACE_DIR, isFolderNode, isMediaPath, parseWorkspace, serializeWorkspace, type WorkspaceFile } from '../shared/workspace';
import type { HostToWebview, TextChange, WebviewToHost } from '../shared/protocol';
import type { LanguageRequest } from '../shared/language';
import { formatReference } from '../shared/reference';
import { withLines } from '../shared/paths';
import { WorkspaceStore, canvasConfig, editorSettings, exists, labelFor, replaceDocument, updateCanvasConfig } from './workspaceStore';
import type { TakeoverController } from './takeover';
import { findDefinition } from './definition';
import { LanguageBridge, diagnosticsFor } from './language';
import { INDEX_REF, gitDiffRef, onGitChange, readGitBase } from './git';
import { affectsTextmateTheme, readTextmateInit, readTextmateTheme, textmateRequest } from './textmate';
import { NodeClipboard } from './clipboard';

export const CANVAS_VIEW_TYPE = 'paperWorkspace.canvas';

/** Custom editor for `.workspace` files: renders the canvas webview and keeps it in sync with files. */
export class CanvasProvider implements vscode.CustomTextEditorProvider {
  private readonly sessions = new Map<string, CanvasSession>();
  /** Copied nodes, shared by every canvas so they can be pasted into another workspace. */
  private readonly clipboard: NodeClipboard;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: WorkspaceStore,
    private readonly takeover: TakeoverController,
  ) {
    this.clipboard = new NodeClipboard(store);
    context.subscriptions.push(this.clipboard);
  }

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
    const session = new CanvasSession(this.context, this.store, this.takeover, this.clipboard, document, panel);
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
  /** workspace `file` key -> URI of a file that no longer exists; reopened if it comes back (undo, git checkout...). */
  private readonly missing = new Map<string, vscode.Uri>();
  /** Folder paths shown by folder nodes -> whether the folder is missing (undefined until first checked). */
  private readonly folders = new Map<string, boolean | undefined>();
  /** Documents currently being edited from this webview; their change events must not echo back. */
  private readonly applying = new Map<string, number>();
  private readonly editQueues = new Map<string, Promise<void>>();
  private lastWritten: string | undefined;
  private autosaveTimer: NodeJS.Timeout | undefined;
  private readonly language = new LanguageBridge();
  /** workspace `file` key -> git versions last sent to the webview (see `gitBase`). */
  private readonly gitBases = new Map<string, { index: string | null; ref: string | null }>();
  private gitTimer: NodeJS.Timeout | undefined;
  /** Color theme whose token colors were sent with `init` (undefined: Monaco highlighting). */
  private textmateTheme: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: WorkspaceStore,
    private readonly takeover: TakeoverController,
    private readonly clipboard: NodeClipboard,
    private readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
  ) {
    const distUri = vscode.Uri.joinPath(context.extensionUri, 'dist');
    // The workspace root is readable so media nodes can show images and videos stored in the workspace.
    panel.webview.options = { enableScripts: true, localResourceRoots: [distUri, store.rootFor(document.uri)] };
    panel.webview.html = this.html(distUri);

    // Deletions from anywhere (Explorer, terminal, git); changes are already covered by the documents.
    const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false);
    this.disposables.push(
      watcher,
      watcher.onDidDelete((uri) => this.onFileDeleted(uri)),
      watcher.onDidCreate((uri) => this.onFileCreated(uri)),
      panel.webview.onDidReceiveMessage((m: WebviewToHost) => this.onMessage(m)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e)),
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDocumentSaved(doc)),
      vscode.languages.onDidChangeDiagnostics((e) => {
        for (const uri of e.uris) this.postDiagnostics(uri);
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('editor')) this.post({ type: 'settings', settings: editorSettings() });
        if (e.affectsConfiguration('paperWorkspace.gitDiffBase')) this.scheduleGitRefresh();
        if (affectsTextmateTheme(e)) void this.postTextmateTheme();
        if (['minNodeWidth', 'minNodeHeight', 'newFileWidth', 'newFileHeight', 'focusPercent', 'canvasBackground', 'showFileTitleByDefault', 'showEditorTitleByDefault'].some((k) => e.affectsConfiguration(`paperWorkspace.${k}`))) {
          this.post({ type: 'config', config: canvasConfig() });
        }
      }),
      onGitChange(() => this.scheduleGitRefresh()),
      // Git work done outside VS Code (terminal, another tool) can be noticed late; re-check when coming back.
      vscode.window.onDidChangeWindowState((s) => s.focused && this.scheduleGitRefresh()),
      panel.onDidChangeViewState((e) => e.webviewPanel.visible && this.scheduleGitRefresh()),
      vscode.window.onDidChangeActiveColorTheme(() => void this.postTextmateTheme()),
      clipboard.onDidChange((marker) => this.post({ type: 'clipboard', marker })),
    );
  }

  dispose() {
    clearTimeout(this.autosaveTimer);
    clearTimeout(this.gitTimer);
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
      gitBases: Object.fromEntries(this.gitBases),
      textmateTheme: this.textmateTheme,
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
        // Read before `ready` flips, so messages posted meanwhile stay queued behind `init`.
        const textmate = await readTextmateInit();
        this.textmateTheme = textmate?.theme.name;
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
          textmate,
        } satisfies HostToWebview);
        this.queue.splice(0).forEach((q) => this.post(q));
        if (this.clipboard.marker) this.post({ type: 'clipboard', marker: this.clipboard.marker });
        this.syncFolders(workspace);
        break;
      }
      case 'update':
        await this.writeWorkspace(serializeWorkspace(m.workspace));
        this.syncFolders(m.workspace);
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
            if (stat.type & vscode.FileType.Directory) {
              // A folder is on the canvas once: dropping it again shows the one there.
              const { id, created } = await this.store.addFolder(this.document.uri, uri, { x: m.position.x + offset, y: m.position.y + offset });
              if (!created) this.post({ type: 'revealNode', id });
              else offset += 48;
              continue;
            }
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
      case 'saveSnapshot':
        await this.saveSnapshot(m.scope, m.data);
        break;
      case 'save':
        await this.saveAll();
        break;
      case 'viewSource':
        // showTextDocument always uses the text editor, never this custom editor.
        await vscode.window.showTextDocument(this.document, { viewColumn: vscode.ViewColumn.Beside });
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
      case 'revealInExplorer':
        this.lastRevealed = undefined; // an explicit request always reveals
        await this.revealInExplorer(m.path);
        break;
      case 'relinkFile':
        await this.relinkFile(m.file);
        break;
      case 'relinkFolder':
        await this.relinkFolder(m.folder);
        break;
      case 'copyReference': {
        const reference = formatReference({ workspace: this.store.toWorkspacePath(this.document.uri, this.document.uri), node: m.node });
        await vscode.env.clipboard.writeText(reference);
        void vscode.window.setStatusBarMessage(`Paper Workspace: copied ${reference}`, 4000);
        return reference; // for integration tests (`_simulate`)
      }
      case 'copyPath': {
        const text = withLines(this.copyablePath(m.path, m.relative), m.lines);
        await vscode.env.clipboard.writeText(text);
        void vscode.window.setStatusBarMessage(`Paper Workspace: copied ${text}`, 4000);
        return text; // for integration tests (`_simulate`)
      }
      case 'copyNodes':
        await this.clipboard.copy(this.document.uri, m.marker, m.workspace);
        break;
      case 'pasteNodes': {
        const workspace = await this.clipboard.paste(this.document.uri, m.marker);
        if (workspace) this.post({ type: 'pasteNodes', marker: m.marker, workspace });
        return workspace; // for integration tests (`_simulate`)
      }
      case 'textmate': {
        const result = await textmateRequest(m.request);
        this.post({ type: 'textmateResult', id: m.id, result });
        return result; // for integration tests (`_simulate`)
      }
    }
  }

  /**
   * A file or folder's path as VS Code's Explorer copies it: the OS path, or the path relative to its workspace folder
   * (with the folder name in a multi-root window) using `explorer.copyRelativePathSeparator`.
   */
  private copyablePath(path: string, relative: boolean): string {
    const uri = path ? this.store.resolveWorkspacePath(this.document.uri, path) : this.store.rootFor(this.document.uri);
    if (!relative) return uri.scheme === 'file' ? uri.fsPath : uri.toString();
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const multiRoot = (vscode.workspace.workspaceFolders?.length ?? 0) > 1;
    let rel = folder && folder.uri.toString() === uri.toString() ? (multiRoot ? folder.name : '.') : vscode.workspace.asRelativePath(uri, multiRoot);
    const setting = vscode.workspace.getConfiguration('explorer').get<string>('copyRelativePathSeparator', 'auto');
    const sep = setting === '/' || setting === '\\' ? setting : process.platform === 'win32' ? '\\' : '/';
    if (sep === '\\') rel = rel.replace(/\//g, '\\');
    return rel;
  }

  private async postTextmateTheme() {
    const theme = await readTextmateTheme();
    if (theme) this.post({ type: 'textmateTheme', theme });
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

  // ---- git gutter ----------------------------------------------------------------------------

  /** Send the git versions of a file shown on the canvas, if they changed since last sent. */
  private async postGitBase(file: string) {
    const s = this.files.get(file);
    if (!s) return;
    const uri = vscode.Uri.parse(s);
    const ref = gitDiffRef();
    const [index, older] = await Promise.all([readGitBase(uri, INDEX_REF), ref === undefined ? null : readGitBase(uri, ref)]);
    const bases = { index, ref: older };
    if (this.files.get(file) !== s || JSON.stringify(this.gitBases.get(file)) === JSON.stringify(bases)) return;
    this.gitBases.set(file, bases);
    this.post({ type: 'gitBase', file, ...bases });
  }

  /** Repository status changes come in bursts (save, stage, commit, checkout); re-read the bases once after them. */
  private scheduleGitRefresh() {
    clearTimeout(this.gitTimer);
    this.gitTimer = setTimeout(() => {
      for (const file of this.files.keys()) void this.postGitBase(file);
    }, 300);
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
    // Checked first: VS Code keeps serving a deleted file's document while an editor still has it open.
    if (!(await exists(uri))) return this.markMissing(file, uri);
    this.missing.delete(file);
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
      // A (re)loaded model needs its base again, even an unchanged one.
      this.gitBases.delete(file);
      void this.postGitBase(file);
    } catch (e) {
      this.post({ type: 'doc', file, error: `Cannot open ${file}: ${(e as Error).message}` });
    }
  }

  private markMissing(file: string, uri: vscode.Uri) {
    this.files.delete(file);
    this.gitBases.delete(file);
    this.missing.set(file, uri);
    this.post({ type: 'doc', file, missing: true });
  }

  /** A file (or a folder containing files) shown on the canvas was deleted or moved away. */
  private onFileDeleted(uri: vscode.Uri) {
    for (const [file, s] of [...this.files]) {
      const fileUri = vscode.Uri.parse(s);
      if (isSameOrInside(fileUri, uri)) this.markMissing(file, fileUri);
    }
    for (const [folder, missing] of this.folders) {
      if (!missing && isSameOrInside(this.store.resolveWorkspacePath(this.document.uri, folder), uri)) void this.checkFolder(folder);
    }
  }

  private onFileCreated(uri: vscode.Uri) {
    for (const [file, missingUri] of [...this.missing]) {
      if (isSameOrInside(missingUri, uri)) void this.openDoc(file);
    }
    for (const [folder, missing] of this.folders) {
      if (missing && isSameOrInside(this.store.resolveWorkspacePath(this.document.uri, folder), uri)) void this.checkFolder(folder);
    }
  }

  // ---- folder nodes --------------------------------------------------------------------------

  /** Track the folders the layout shows: new ones are checked (and reported), removed ones forgotten. */
  private syncFolders(workspace: WorkspaceFile) {
    const shown = new Set(workspace.nodes.filter(isFolderNode).map((n) => n.folder));
    for (const folder of [...this.folders.keys()]) if (!shown.has(folder)) this.folders.delete(folder);
    for (const folder of shown) {
      if (this.folders.has(folder)) continue;
      this.folders.set(folder, undefined);
      void this.checkFolder(folder);
    }
  }

  /** Whether a folder exists; its nodes are told when that changes. */
  private async checkFolder(folder: string) {
    let missing = true;
    try {
      missing = !((await vscode.workspace.fs.stat(this.store.resolveWorkspacePath(this.document.uri, folder))).type & vscode.FileType.Directory);
    } catch {
      /* deleted or moved */
    }
    if (!this.folders.has(folder) || this.folders.get(folder) === missing) return;
    this.folders.set(folder, missing);
    this.post({ type: 'folderState', folder, missing });
  }

  /** Ask for the folder that replaces a missing one (e.g. where it was moved to) and point its nodes at it. */
  private async relinkFolder(folder: string) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: `"${folder || 'The workspace folder'}" no longer exists`,
      openLabel: 'Show on canvas',
      defaultUri: this.store.rootFor(this.document.uri),
    });
    if (!picked?.[0]) return;
    const newFolder = this.store.toFolderPath(this.document.uri, picked[0]);
    if (newFolder === folder) await this.checkFolder(folder); // it is back where it was
    else this.post({ type: 'folderRelinked', folder, newFolder });
  }

  /** Ask for the file that replaces a missing one (e.g. where it was moved to) and point its nodes at it. */
  private async relinkFile(file: string) {
    const root = this.store.rootFor(this.document.uri);
    const name = file.split('/').pop() ?? file;
    const browse: vscode.QuickPickItem = { label: '$(folder-opened) Browse…', alwaysShow: true };
    const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { uri?: vscode.Uri }>();
    pick.title = `"${file}" no longer exists`;
    pick.placeholder = 'Search the file to show instead';
    pick.matchOnDescription = true;
    pick.busy = true;
    pick.items = [browse];
    pick.show();

    void vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*'), `**/{node_modules,.git,${WORKSPACE_DIR}}/**`, 20000).then((uris) => {
      const items = uris
        .filter((u) => !isMediaPath(u.path))
        .map((uri) => ({ label: uri.path.split('/').pop() ?? uri.path, description: this.store.toWorkspacePath(this.document.uri, uri), uri }))
        .sort((a, b) => a.description.localeCompare(b.description));
      // Files with the same name first: the likely new home of a moved file.
      const same = items.filter((i) => i.label === name);
      const others = items.filter((i) => i.label !== name);
      pick.items = [
        browse,
        ...(same.length ? [{ label: 'Same name', kind: vscode.QuickPickItemKind.Separator }, ...same] : []),
        ...(others.length ? [{ label: 'Other files', kind: vscode.QuickPickItemKind.Separator }, ...others] : []),
      ];
      if (same.length) pick.activeItems = [same[0]];
      pick.busy = false;
    });

    const chosen = await new Promise<(vscode.QuickPickItem & { uri?: vscode.Uri }) | undefined>((resolve) => {
      pick.onDidAccept(() => resolve(pick.selectedItems[0]));
      pick.onDidHide(() => resolve(undefined));
    });
    pick.dispose();
    let uri = chosen?.uri;
    if (chosen === browse) {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Show on canvas', defaultUri: root });
      uri = picked?.[0];
    }
    if (!uri) return;
    const newFile = this.store.toWorkspacePath(this.document.uri, uri);
    if (newFile === file) await this.openDoc(file); // it is back where it was
    else this.post({ type: 'fileRelinked', file, newFile });
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
      this.syncFolders(workspace);
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

  // ---- snapshots ----------------------------------------------------------------------------

  /** Asks where to store a snapshot (named after the workspace, scope and time), writes it and offers to open it. */
  private async saveSnapshot(scope: 'view' | 'workspace', data: string) {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
    const name = labelFor(this.document.uri);
    const dest = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(this.store.rootFor(this.document.uri), `${name} ${scope} ${when}.png`),
      filters: { 'PNG image': ['png'] },
      saveLabel: 'Save snapshot',
      title: scope === 'view' ? `Save a snapshot of the current view of "${name}"` : `Save a snapshot of the whole "${name}" workspace`,
    });
    if (!dest) return;
    try {
      await vscode.workspace.fs.writeFile(dest, Buffer.from(data, 'base64'));
    } catch (e) {
      void vscode.window.showErrorMessage(`Paper Workspace: could not save the snapshot: ${(e as Error).message}`);
      return;
    }
    const open = 'Open';
    const reveal = process.platform === 'darwin' ? 'Reveal in Finder' : 'Reveal in File Explorer';
    const pick = await vscode.window.showInformationMessage(`Paper Workspace: snapshot saved to ${dest.fsPath}.`, open, reveal);
    if (pick === open) await vscode.commands.executeCommand('vscode.open', dest, { viewColumn: vscode.ViewColumn.Beside });
    else if (pick === reveal) await vscode.commands.executeCommand('revealFileInOS', dest);
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
      // wasm-unsafe-eval: the Oniguruma regex engine that TextMate grammars need is WebAssembly.
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval' ${webview.cspSource}`,
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
  <meta name="pw-onig" content="${asset('onig.wasm')}" />
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

/** Whether `uri` is `parent` or lies inside it (paths compare case-insensitively on Windows). */
function isSameOrInside(uri: vscode.Uri, parent: vscode.Uri) {
  if (uri.scheme !== parent.scheme || uri.authority !== parent.authority) return false;
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p).replace(/\/+$/, '');
  const a = norm(uri.path);
  const b = norm(parent.path);
  return a === b || a.startsWith(b + '/');
}
