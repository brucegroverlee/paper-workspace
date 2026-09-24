import * as vscode from 'vscode';
import {
  DEFAULT_EDITOR_WIDTH,
  LineRange,
  WORKSPACE_DIR,
  WORKSPACE_EXT,
  XY,
  absolutePosition,
  addSnippet,
  canvasBackgroundOf,
  clampFocusPercent,
  clampNodeSize,
  clampRange,
  emptyWorkspace,
  isBoxNode,
  isFileNode,
  parseWorkspace,
  serializeWorkspace,
} from '../shared/workspace';
import { isAbsoluteWorkspacePath, sanitizeWorkspaceName, toWorkspacePath } from '../shared/paths';
import type { CanvasConfig, EditorSettings } from '../shared/protocol';

export type Mode = 'off' | 'manual' | 'takeover';

export const MODE_LABELS: Record<Mode, string> = {
  off: 'Off',
  manual: 'Manual',
  takeover: 'Take over',
};

const MEDIA_DIR = 'media';
const MODE_KEY = 'paperWorkspace.mode';
const TARGET_KEY = 'paperWorkspace.target';

/** Owns extension state (mode, target workspace) and knows how to read/modify `.workspace` documents. */
export class WorkspaceStore implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  /** Last viewport reported by each open canvas, so new nodes land where the user is looking. */
  readonly viewports = new Map<string, { center: XY; zoom: number }>();

  constructor(private readonly context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher(`**/${WORKSPACE_DIR}/*${WORKSPACE_EXT}`);
    watcher.onDidCreate(() => this.changeEmitter.fire(), null, this.disposables);
    watcher.onDidDelete(() => this.changeEmitter.fire(), null, this.disposables);
    this.disposables.push(
      watcher,
      this.changeEmitter,
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.changeEmitter.fire()),
    );
    this.updateContext();
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }

  get mode(): Mode {
    return this.context.workspaceState.get<Mode>(MODE_KEY, 'manual');
  }

  async setMode(mode: Mode) {
    await this.context.workspaceState.update(MODE_KEY, mode);
    this.updateContext();
    this.changeEmitter.fire();
  }

  private updateContext() {
    void vscode.commands.executeCommand('setContext', 'paperWorkspace.enabled', this.mode !== 'off');
  }

  get target(): vscode.Uri | undefined {
    const s = this.context.workspaceState.get<string>(TARGET_KEY);
    return s ? vscode.Uri.parse(s) : undefined;
  }

  async setTarget(uri: vscode.Uri | undefined) {
    await this.context.workspaceState.update(TARGET_KEY, uri?.toString());
    this.changeEmitter.fire();
  }

  isTarget(uri: vscode.Uri) {
    return this.target?.toString() === uri.toString();
  }

  refresh() {
    this.changeEmitter.fire();
  }

  /** All `.workspace` files in `<folder>/.paperworkspace/` for every workspace folder. */
  async list(): Promise<vscode.Uri[]> {
    const result: vscode.Uri[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const dir = vscode.Uri.joinPath(folder.uri, WORKSPACE_DIR);
      try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [name, type] of entries) {
          if (type === vscode.FileType.File && name.endsWith(WORKSPACE_EXT)) result.push(vscode.Uri.joinPath(dir, name));
        }
      } catch {
        // No .paperworkspace folder yet.
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** The folder that owns a workspace: the parent of its `.paperworkspace` directory. */
  rootFor(workspaceUri: vscode.Uri): vscode.Uri {
    const dir = vscode.Uri.joinPath(workspaceUri, '..');
    if (dir.path.endsWith('/' + WORKSPACE_DIR)) return vscode.Uri.joinPath(dir, '..');
    // A .workspace file living elsewhere: resolve relative to its own workspace folder, or its directory.
    return vscode.workspace.getWorkspaceFolder(workspaceUri)?.uri ?? dir;
  }

  toWorkspacePath(workspaceUri: vscode.Uri, fileUri: vscode.Uri): string {
    const root = this.rootFor(workspaceUri);
    if (root.scheme === fileUri.scheme && root.authority === fileUri.authority) {
      const rel = toWorkspacePath(root.path, fileUri.path);
      if (rel !== undefined) return rel;
    }
    return fileUri.scheme === 'file' ? fileUri.fsPath.replace(/\\/g, '/') : fileUri.toString();
  }

  /** Where pasted and copied-in media of a workspace are stored: `<root>/.paperworkspace/media`. */
  mediaDirFor(workspaceUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(this.rootFor(workspaceUri), WORKSPACE_DIR, MEDIA_DIR);
  }

  /** Write media bytes into the workspace's media folder under a free name; returns the workspace path. */
  async saveMedia(workspaceUri: vscode.Uri, name: string, bytes: Uint8Array): Promise<string> {
    const dir = this.mediaDirFor(workspaceUri);
    await vscode.workspace.fs.createDirectory(dir);
    const dot = name.lastIndexOf('.');
    const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[^\w.-]+/g, '-').slice(0, 60) || 'media';
    const ext = dot > 0 ? name.slice(dot) : '';
    let uri = vscode.Uri.joinPath(dir, stem + ext);
    for (let i = 2; await exists(uri); i++) uri = vscode.Uri.joinPath(dir, `${stem}-${i}${ext}`);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return this.toWorkspacePath(workspaceUri, uri);
  }

  /** Workspace path for a media file: files under the workspace root are referenced, others are copied into its media folder. */
  async importMedia(workspaceUri: vscode.Uri, fileUri: vscode.Uri): Promise<string> {
    const root = this.rootFor(workspaceUri);
    if (root.scheme === fileUri.scheme && root.authority === fileUri.authority && toWorkspacePath(root.path, fileUri.path) !== undefined) {
      return this.toWorkspacePath(workspaceUri, fileUri);
    }
    const name = fileUri.path.split('/').pop() || 'media';
    return this.saveMedia(workspaceUri, name, await vscode.workspace.fs.readFile(fileUri));
  }

  resolveWorkspacePath(workspaceUri: vscode.Uri, p: string): vscode.Uri {
    if (isAbsoluteWorkspacePath(p)) return /^[a-zA-Z][\w+.-]+:\/\//.test(p) ? vscode.Uri.parse(p) : vscode.Uri.file(p);
    return vscode.Uri.joinPath(this.rootFor(workspaceUri), ...p.split('/'));
  }

  async create(name: string, folder?: vscode.WorkspaceFolder): Promise<vscode.Uri> {
    const ws = folder ?? vscode.workspace.workspaceFolders?.[0];
    if (!ws) throw new Error('Open a folder to create a workspace workspace.');
    const safe = sanitizeWorkspaceName(name) || 'workspace';
    const dir = vscode.Uri.joinPath(ws.uri, WORKSPACE_DIR);
    await vscode.workspace.fs.createDirectory(dir);
    let uri = vscode.Uri.joinPath(dir, safe + WORKSPACE_EXT);
    for (let i = 2; await exists(uri); i++) uri = vscode.Uri.joinPath(dir, `${safe}-${i}${WORKSPACE_EXT}`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeWorkspace(emptyWorkspace()), 'utf8'));
    if (!this.target || !(await exists(this.target))) await this.setTarget(uri);
    this.changeEmitter.fire();
    return uri;
  }

  /** Return the target workspace, asking the user to pick or create one if needed. */
  async resolveTarget(): Promise<vscode.Uri | undefined> {
    const target = this.target;
    if (target && (await exists(target))) return target;
    const workspaces = await this.list();
    if (workspaces.length === 1) {
      await this.setTarget(workspaces[0]);
      return workspaces[0];
    }
    if (workspaces.length === 0) {
      const create = await vscode.window.showInformationMessage(
        'No workspace workspace yet. Create one?',
        'Create "main"',
      );
      return create ? this.create('main') : undefined;
    }
    const pick = await vscode.window.showQuickPick(
      workspaces.map((uri) => ({ label: labelFor(uri), description: vscode.workspace.asRelativePath(uri), uri })),
      { placeHolder: 'Choose the target workspace workspace' },
    );
    if (!pick) return undefined;
    await this.setTarget(pick.uri);
    return pick.uri;
  }

  /**
   * Add a snippet (editor node) for `fileUri` to a workspace: inside the file's existing file node when there is one,
   * otherwise in a new file node. Returns the editor node id (new, or an existing one that already covers `target`).
   * Edits the workspace's TextDocument so an open canvas updates and undo works.
   */
  async addSnippet(
    workspaceUri: vscode.Uri,
    fileUri: vscode.Uri,
    requested: LineRange | undefined,
    position?: XY,
    /** Workspace path of a file node to place a new file node next to (e.g. the file a Ctrl+click came from). */
    besideFile?: string,
  ): Promise<string> {
    const workspaceDoc = await vscode.workspace.openTextDocument(workspaceUri);
    const { workspace } = parseWorkspace(workspaceDoc.getText());
    const source = await vscode.workspace.openTextDocument(fileUri);
    const target = requested && clampRange(requested, source.lineCount);

    let origin: XY = { x: 0, y: 0 };
    const vp = this.viewports.get(workspaceUri.toString());
    const beside = besideFile !== undefined ? workspace.nodes.find((n) => isFileNode(n) && n.file === besideFile) : undefined;
    const topLevel = workspace.nodes.filter((n) => isBoxNode(n) && n.parent === undefined);
    if (beside) {
      const at = absolutePosition(workspace, beside.id); // the file may sit in a group
      origin = { x: at.x + beside.width + 80, y: at.y };
    } else if (vp) origin = { x: vp.center.x - DEFAULT_EDITOR_WIDTH / 2, y: vp.center.y - 200 };
    else if (topLevel.length) {
      const right = topLevel.reduce((a, n) => (n.position.x + n.width > a.position.x + a.width ? n : a));
      origin = { x: right.position.x + right.width + 80, y: right.position.y };
    }

    const result = addSnippet(workspace, {
      file: this.toWorkspacePath(workspaceUri, fileUri),
      target,
      anchor: target && source.lineAt(target.start - 1).text.trim(),
      lineHeight: editorSettings().lineHeight,
      origin,
      position,
    });
    if (!result.created) return result.editorId;
    await replaceDocument(workspaceDoc, serializeWorkspace(result.workspace));
    // The canvas may not be open yet (it is revealed after this), so persist here rather than rely on it.
    if (vscode.workspace.getConfiguration('paperWorkspace').get<boolean>('autoSaveLayout', true)) await workspaceDoc.save();
    return result.editorId;
  }
}

export function labelFor(uri: vscode.Uri) {
  const name = uri.path.split('/').pop() ?? uri.path;
  return name.endsWith(WORKSPACE_EXT) ? name.slice(0, -WORKSPACE_EXT.length) : name;
}

export async function exists(uri: vscode.Uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function replaceDocument(doc: vscode.TextDocument, text: string) {
  if (doc.getText() === text) return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), text);
  await vscode.workspace.applyEdit(edit);
}

/** Settings edited from the canvas config panel. */
export function canvasConfig(): CanvasConfig {
  const c = vscode.workspace.getConfiguration('paperWorkspace');
  return {
    minNodeWidth: clampNodeSize(c.get('minNodeWidth')),
    minNodeHeight: clampNodeSize(c.get('minNodeHeight')),
    focusPercent: clampFocusPercent(c.get('focusPercent')),
    canvasBackground: canvasBackgroundOf(c.get('canvasBackground')),
  };
}

/** Store config panel changes as user settings, so every canvas (and the Settings UI) sees them. */
export async function updateCanvasConfig(patch: Partial<CanvasConfig>) {
  const c = vscode.workspace.getConfiguration('paperWorkspace');
  for (const key of ['minNodeWidth', 'minNodeHeight'] as const) {
    if (patch[key] !== undefined) await c.update(key, clampNodeSize(patch[key]), vscode.ConfigurationTarget.Global);
  }
  if (patch.focusPercent !== undefined) await c.update('focusPercent', clampFocusPercent(patch.focusPercent), vscode.ConfigurationTarget.Global);
  if (patch.canvasBackground !== undefined) {
    await c.update('canvasBackground', canvasBackgroundOf(patch.canvasBackground), vscode.ConfigurationTarget.Global);
  }
}

export function editorSettings(): EditorSettings {
  const c = vscode.workspace.getConfiguration('editor');
  const fontSize = c.get<number>('fontSize', 14);
  let lineHeight = c.get<number>('lineHeight', 0);
  // Mirrors VS Code: 0 = derived from font size, values < 8 are multipliers.
  if (lineHeight === 0) lineHeight = Math.round(fontSize * (process.platform === 'darwin' ? 1.5 : 1.35));
  else if (lineHeight < 8) lineHeight = Math.round(fontSize * lineHeight);
  return {
    fontFamily: c.get<string>('fontFamily', "Consolas, 'Courier New', monospace"),
    fontSize,
    lineHeight,
    tabSize: c.get<number>('tabSize', 4),
  };
}
