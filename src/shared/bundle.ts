// The `.paperbundle` export format: one JSON file holding a workspace layout plus the bytes of every local media
// file it shows, so a workspace can be moved between repositories or machines. Source files (the code papers
// point at) are not included: they are expected to live in the repository the bundle is imported into.
// Keep this module free of `vscode` and DOM imports so it can be unit tested.

import { WORKSPACE_DIR, type WorkspaceFile, parseWorkspace, serializeWorkspace } from './workspace';

export const BUNDLE_EXT = '.paperbundle';
export const BUNDLE_FORMAT = 'paper-workspace-bundle';
export const BUNDLE_VERSION = 1;
export const MEDIA_DIR = 'media';

export interface BundleMedia {
  /** File name to restore the media under. */
  name: string;
  /** Base64 of the file bytes. */
  data: string;
}

export interface WorkspaceBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  /** Name of the exported workspace (its file name without `.workspace`). */
  name: string;
  exportedAt: string;
  workspace: unknown;
  /** Keyed by the `src` the media nodes use in `workspace`. */
  media: Record<string, BundleMedia>;
}

/** Remote media (http:, data: …) is referenced as is; everything else is a file to embed. */
export function isRemoteSrc(src: string): boolean {
  return /^(https?|data|blob):/i.test(src);
}

/** Distinct local media paths the workspace shows. */
export function localMediaSources(workspace: WorkspaceFile): string[] {
  const srcs = new Set<string>();
  for (const n of workspace.nodes) if (n.type === 'media' && !isRemoteSrc(n.src)) srcs.add(n.src);
  return [...srcs];
}

/** Workspace path of the folder owning a workspace's media: `.paperworkspace/media/<name>`. */
export function mediaFolderPath(workspaceName: string): string {
  return `${WORKSPACE_DIR}/${MEDIA_DIR}/${workspaceName}`;
}

/** Is `src` inside the `.paperworkspace` folder (i.e. owned by some workspace rather than part of the repository)? */
export function isWorkspaceOwnedPath(src: string): boolean {
  return src.startsWith(WORKSPACE_DIR + '/');
}

/** Copy of `workspace` with media `src`s replaced through `map` (unmapped ones are kept). */
export function rewriteMediaSources(workspace: WorkspaceFile, map: (src: string) => string | undefined): WorkspaceFile {
  return {
    ...workspace,
    nodes: workspace.nodes.map((n) => {
      if (n.type !== 'media') return n;
      const src = map(n.src);
      return src === undefined || src === n.src ? n : { ...n, src };
    }),
  };
}

/** Move media under `from/` to `to/` (used when a workspace, and so its media folder, is renamed). */
export function rebaseMediaSources(workspace: WorkspaceFile, from: string, to: string): WorkspaceFile {
  const prefix = from.replace(/\/+$/, '') + '/';
  return rewriteMediaSources(workspace, (src) => (src.startsWith(prefix) ? to.replace(/\/+$/, '') + '/' + src.slice(prefix.length) : undefined));
}

export function createBundle(name: string, workspace: WorkspaceFile, media: Record<string, BundleMedia>, now = new Date()): WorkspaceBundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    name,
    exportedAt: now.toISOString(),
    workspace: JSON.parse(serializeWorkspace(workspace)),
    media,
  };
}

export function serializeBundle(bundle: WorkspaceBundle): string {
  return JSON.stringify(bundle) + '\n';
}

/** Parse a `.paperbundle`, validating its layout the same way a `.workspace` file is. Throws on anything unusable. */
export function parseBundle(text: string): { name: string; workspace: WorkspaceFile; media: Record<string, BundleMedia> } {
  let raw: Partial<WorkspaceBundle>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not a Paper Workspace bundle (invalid JSON).');
  }
  if (!raw || typeof raw !== 'object' || raw.format !== BUNDLE_FORMAT) throw new Error('Not a Paper Workspace bundle.');
  if (typeof raw.version !== 'number' || raw.version > BUNDLE_VERSION) {
    throw new Error('This bundle was made by a newer version of Paper Workspace.');
  }
  const { workspace, error } = parseWorkspace(JSON.stringify(raw.workspace ?? {}));
  if (error) throw new Error(`The bundle's layout is invalid: ${error}`);
  const media: Record<string, BundleMedia> = {};
  for (const [src, m] of Object.entries(raw.media ?? {})) {
    if (m && typeof m.name === 'string' && typeof m.data === 'string') media[src] = { name: m.name, data: m.data };
  }
  return { name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'imported', workspace, media };
}
