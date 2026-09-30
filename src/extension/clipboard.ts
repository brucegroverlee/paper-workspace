import * as vscode from 'vscode';
import type { WorkspaceFile } from '../shared/workspace';
import { isAbsoluteWorkspacePath } from '../shared/paths';
import { isRemoteSrc, isWorkspaceOwnedPath, mediaFolderPath } from '../shared/bundle';
import { WorkspaceStore, labelFor } from './workspaceStore';

interface Entry {
  marker: string;
  workspace: WorkspaceFile;
  /** The workspace the nodes were copied from. */
  source: vscode.Uri;
  /** Target workspace URI -> the nodes made fit for it (so pasting again reuses the media copied the first time). */
  adopted: Map<string, Promise<WorkspaceFile>>;
}

/**
 * The node clipboard shared by every canvas, so nodes copied in one workspace can be pasted into another. The system
 * clipboard only gets a marker for them (the webviews compare it on paste, so copying anything else wins).
 */
export class NodeClipboard implements vscode.Disposable {
  private entry: Entry | undefined;
  private readonly changed = new vscode.EventEmitter<string>();
  /** Fires with the marker of newly copied nodes. */
  readonly onDidChange = this.changed.event;

  constructor(private readonly store: WorkspaceStore) {}

  get marker() {
    return this.entry?.marker;
  }

  async copy(source: vscode.Uri, marker: string, workspace: WorkspaceFile) {
    this.entry = { marker, workspace, source, adopted: new Map() };
    try {
      await vscode.env.clipboard.writeText(marker);
    } catch {
      // The canvases still have the nodes; only the check against other copied text is lost.
    }
    if (this.entry?.marker === marker) this.changed.fire(marker);
  }

  /** The nodes copied under `marker`, fit for pasting into `target`; undefined if something else was copied since. */
  paste(target: vscode.Uri, marker: string): Promise<WorkspaceFile> | undefined {
    const entry = this.entry;
    if (entry?.marker !== marker) return undefined;
    const key = target.toString();
    let adopted = entry.adopted.get(key);
    if (!adopted) {
      adopted = this.adopt(entry, target);
      entry.adopted.set(key, adopted);
    }
    return adopted;
  }

  /**
   * Paths are relative to a workspace's root: from a workspace with another root they are rewritten (absolute when
   * outside the target's root). Media stored in `.paperworkspace` (other than the target's own media folder) is copied
   * into the target's media folder, like "Duplicate" does, so the two workspaces never share files.
   */
  private async adopt(entry: Entry, target: vscode.Uri): Promise<WorkspaceFile> {
    const { source, workspace } = entry;
    if (source.toString() === target.toString()) return workspace;
    const sameRoot = this.store.rootFor(source).toString() === this.store.rootFor(target).toString();
    const path = (p: string) => (sameRoot || isAbsoluteWorkspacePath(p) ? p : this.store.toWorkspacePath(target, this.store.resolveWorkspacePath(source, p)));
    const folderPath = (p: string) =>
      sameRoot || isAbsoluteWorkspacePath(p) ? p : this.store.toFolderPath(target, p ? this.store.resolveWorkspacePath(source, p) : this.store.rootFor(source));
    const ownDir = mediaFolderPath(labelFor(target)) + '/';
    const media = new Map<string, string>();
    for (const n of workspace.nodes) {
      if (n.type !== 'media' || isRemoteSrc(n.src) || media.has(n.src)) continue;
      if (isAbsoluteWorkspacePath(n.src) || !isWorkspaceOwnedPath(n.src) || (sameRoot && n.src.startsWith(ownDir))) {
        media.set(n.src, path(n.src));
        continue;
      }
      const file = this.store.resolveWorkspacePath(source, n.src);
      try {
        media.set(n.src, await this.store.saveMedia(target, file.path.split('/').pop() || 'media', await vscode.workspace.fs.readFile(file)));
      } catch {
        media.set(n.src, path(n.src)); // missing media: keep pointing where the original does
      }
    }
    return {
      ...workspace,
      nodes: workspace.nodes.map((n) => {
        if (n.type === 'file') return { ...n, file: path(n.file) };
        if (n.type === 'folder') return { ...n, folder: folderPath(n.folder) };
        if (n.type === 'media') return { ...n, src: media.get(n.src) ?? n.src };
        return n;
      }),
    };
  }

  dispose() {
    this.changed.dispose();
  }
}
