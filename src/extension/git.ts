// Reads the git version of files through VS Code's built-in Git extension, for the gutter marks in papers.
import * as vscode from 'vscode';

// The subset of the `vscode.git` extension API (extensions/git/src/api/git.d.ts) used here.
interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
}
interface GitAPI {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: vscode.Event<Repository>;
  getRepository(uri: vscode.Uri): Repository | null;
}
interface Repository {
  readonly state: RepositoryState;
  show(ref: string, path: string): Promise<string>;
}
interface RepositoryState {
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly untrackedChanges?: Change[];
  readonly onDidChange: vscode.Event<void>;
}
interface Change {
  readonly uri: vscode.Uri;
  readonly status: number;
}

// git.d.ts `Status` values of files git has no base version for.
const INDEX_ADDED = 1;
const UNTRACKED = 7;
const INTENT_TO_ADD = 9;

let apiPromise: Promise<GitAPI | undefined> | undefined;

/** The Git extension's API, or undefined when it is missing or disabled (`git.enabled: false`). */
function gitApi() {
  return (apiPromise ??= (async () => {
    try {
      const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
      if (!ext) return undefined;
      const exports = ext.isActive ? ext.exports : await ext.activate();
      return exports.enabled ? exports.getAPI(1) : undefined;
    } catch (e) {
      console.warn('[paper-workspace] git extension unavailable', e);
      return undefined;
    }
  })());
}

/** The index (`git show :path`): unstaged changes are the ones against it, as in VS Code's gutter. */
export const INDEX_REF = '';

/**
 * `paperWorkspace.gitDiffBase`: the older version whose extra changes (staged ones for `HEAD`) are shown faded, or
 * undefined for `index` (unstaged changes only).
 */
export function gitDiffRef(): string | undefined {
  const base = vscode.workspace.getConfiguration('paperWorkspace').get<string>('gitDiffBase', 'HEAD').trim();
  return !base || base === 'index' ? undefined : base;
}

/**
 * The text of `uri` at `ref`: '' for a file git does not have there yet (everything is added), null when there is
 * nothing to compare with (not in a repository, ignored, git unavailable).
 */
export async function readGitBase(uri: vscode.Uri, ref: string): Promise<string | null> {
  if (uri.scheme !== 'file') return null;
  const repo = (await gitApi())?.getRepository(uri);
  if (!repo) return null;
  try {
    return await repo.show(ref, uri.fsPath);
  } catch {
    const key = uri.toString();
    const { indexChanges, workingTreeChanges, untrackedChanges = [] } = repo.state;
    const isNew = [...indexChanges, ...workingTreeChanges, ...untrackedChanges].some(
      (c) => c.uri.toString() === key && (c.status === INDEX_ADDED || c.status === UNTRACKED || c.status === INTENT_TO_ADD),
    );
    return isNew ? '' : null;
  }
}

/** Calls `listener` whenever any repository's status changes (commit, stage, checkout, save...). */
export function onGitChange(listener: () => void): vscode.Disposable {
  const subs: vscode.Disposable[] = [];
  let disposed = false;
  void gitApi().then((api) => {
    if (!api || disposed) return;
    const watch = (repo: Repository) => subs.push(repo.state.onDidChange(listener));
    api.repositories.forEach(watch);
    subs.push(
      api.onDidOpenRepository((repo) => {
        watch(repo);
        listener();
      }),
    );
    // Repositories found after the canvas asked for its files' bases.
    if (api.repositories.length) listener();
  });
  return new vscode.Disposable(() => {
    disposed = true;
    subs.forEach((s) => s.dispose());
  });
}
