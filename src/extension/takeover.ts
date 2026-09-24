import * as vscode from 'vscode';
import { WORKSPACE_EXT, type LineRange } from '../shared/workspace';
import type { WorkspaceStore } from './workspaceStore';

/** Schemes we are willing to take over; everything else (git, output, untitled, diff...) opens normally. */
const TAKEOVER_SCHEMES = new Set(['file', 'vscode-remote', 'vscode-vfs']);
/** Lines shown when a file is opened at a specific line (e.g. go to definition). */
const JUMP_CONTEXT_BEFORE = 2;
const JUMP_RANGE_LINES = 30;

export type AddAndReveal = (workspace: vscode.Uri, file: vscode.Uri, range: LineRange | undefined) => Promise<void>;

/**
 * In "take over" mode, a text file opened in a normal tab is closed again and added as a paper
 * to the target workspace. There is no API to intercept opening, so we react to new tabs.
 */
export class TakeoverController implements vscode.Disposable {
  private readonly bypass = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];
  addAndReveal: AddAndReveal | undefined;

  constructor(private readonly store: WorkspaceStore) {
    this.disposables.push(vscode.window.tabGroups.onDidChangeTabs((e) => this.onTabs(e)));
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.bypass.forEach((t) => clearTimeout(t));
  }

  /** Let the next open of `uri` through (used by "Open in text editor" from the canvas). */
  bypassOnce(uri: vscode.Uri) {
    const key = uri.toString();
    clearTimeout(this.bypass.get(key));
    this.bypass.set(key, setTimeout(() => this.bypass.delete(key), 5000));
  }

  private consumeBypass(uri: vscode.Uri) {
    const key = uri.toString();
    const t = this.bypass.get(key);
    if (!t) return false;
    clearTimeout(t);
    this.bypass.delete(key);
    return true;
  }

  private async onTabs(e: vscode.TabChangeEvent) {
    if (this.store.mode !== 'takeover' || !this.addAndReveal) return;
    for (const tab of e.opened) {
      if (!(tab.input instanceof vscode.TabInputText)) continue;
      const uri = tab.input.uri;
      if (!TAKEOVER_SCHEMES.has(uri.scheme) || uri.path.endsWith(WORKSPACE_EXT)) continue;
      if (this.consumeBypass(uri)) continue;
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
      if (doc?.isDirty) continue; // closing it could prompt or lose track of unsaved work

      const target = await this.store.resolveTarget();
      if (!target) return;
      const range = await rangeFromEditor(uri);
      try {
        await vscode.window.tabGroups.close(tab, true);
      } catch {
        // Tab already gone.
      }
      await this.addAndReveal(target, uri, range);
    }
  }
}

/**
 * The tab event can arrive before the editor is visible and before navigation (go to definition,
 * search results) has set its selection, so poll briefly instead of guessing a delay.
 */
async function rangeFromEditor(uri: vscode.Uri): Promise<LineRange | undefined> {
  const find = () => vscode.window.visibleTextEditors.find((ed) => ed.document.uri.toString() === uri.toString());
  let editor = find();
  for (let waited = 0; !editor && waited < 600; waited += 20) {
    await new Promise((r) => setTimeout(r, 20));
    editor = find();
  }
  if (!editor) return undefined;
  await new Promise((r) => setTimeout(r, 30)); // let a reveal/selection set right after opening land
  return rangeFromSelection(editor.selection);
}

/** Selected lines, or a window around the cursor; undefined (whole file) when the cursor is at the top. */
export function rangeFromSelection(sel: vscode.Selection): LineRange | undefined {
  if (!sel.isEmpty) {
    const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line - 1 : sel.end.line;
    return { start: sel.start.line + 1, end: endLine + 1 };
  }
  if (sel.active.line === 0) return undefined;
  const start = Math.max(1, sel.active.line + 1 - JUMP_CONTEXT_BEFORE);
  return { start, end: start + JUMP_RANGE_LINES - 1 };
}
