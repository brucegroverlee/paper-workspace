import * as vscode from 'vscode';
import { CANVAS_VIEW_TYPE } from './canvasProvider';
import { MODE_LABELS, WorkspaceStore, labelFor } from './workspaceStore';

type Item = { kind: 'mode' } | { kind: 'workspace'; uri: vscode.Uri };

const MODE_ICONS = { off: 'circle-slash', manual: 'hand', takeover: 'zap' } as const;
const MODE_HINTS = {
  off: 'Paper Workspace is disabled: files open normally and add-to-canvas actions are hidden.',
  manual: 'Add code with "Add Selection to Paper Workspace" (Ctrl+Alt+P), the Explorer menu, or Shift+drag into a canvas.',
  takeover: 'Opening a text file adds it to the target workspace instead of a normal editor tab.',
} as const;

/** Side panel: the extension mode plus every `.workspace` file, with the target marked. */
export class WorkspacesView implements vscode.TreeDataProvider<Item> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: WorkspaceStore) {
    store.onDidChange(() => this.emitter.fire());
  }

  async getChildren(element?: Item): Promise<Item[]> {
    if (element) return [];
    const workspaces = await this.store.list();
    // Empty list lets the view's welcome content ("New Workspace") show.
    if (!workspaces.length) return [];
    return [{ kind: 'mode' }, ...workspaces.map((uri) => ({ kind: 'workspace' as const, uri }))];
  }

  getTreeItem(item: Item): vscode.TreeItem {
    if (item.kind === 'mode') {
      const mode = this.store.mode;
      const t = new vscode.TreeItem(`Mode: ${MODE_LABELS[mode]}`);
      t.iconPath = new vscode.ThemeIcon(MODE_ICONS[mode]);
      t.tooltip = MODE_HINTS[mode];
      t.contextValue = 'mode';
      t.command = { command: 'paperWorkspace.setMode', title: 'Set Mode' };
      return t;
    }
    const isTarget = this.store.isTarget(item.uri);
    const t = new vscode.TreeItem(labelFor(item.uri));
    t.resourceUri = item.uri;
    t.description = [isTarget ? 'target' : '', multiRootLabel(item.uri)].filter(Boolean).join(' · ');
    t.iconPath = new vscode.ThemeIcon(isTarget ? 'target' : 'layout');
    t.tooltip = vscode.workspace.asRelativePath(item.uri);
    t.contextValue = isTarget ? 'workspaceTarget' : 'workspace';
    t.command = { command: 'vscode.openWith', title: 'Open', arguments: [item.uri, CANVAS_VIEW_TYPE] };
    return t;
  }
}

function multiRootLabel(uri: vscode.Uri) {
  if ((vscode.workspace.workspaceFolders?.length ?? 0) < 2) return '';
  return vscode.workspace.getWorkspaceFolder(uri)?.name ?? '';
}
