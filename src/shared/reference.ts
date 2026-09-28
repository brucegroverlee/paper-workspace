// References to a workspace or to one of its items, copied from the canvas ("Copy reference") and pasted into an AI
// chat, a commit message or a doc. Pure string logic so it can be unit tested.
//
//   paperworkspace:.paperworkspace/How login works.workspace                 the whole workspace
//   paperworkspace:.paperworkspace/How login works.workspace#editor/e_route  one item: its kind, then its node id
//
// The part before `#` is the `.workspace` file's path relative to the folder that owns `.paperworkspace/` (the same
// root `file` paths use); the part after it names the node by its `type` and its `id`.

export const REFERENCE_SCHEME = 'paperworkspace';

export interface WorkspaceReference {
  /** Path of the `.workspace` file, relative to the project root (POSIX separators), or absolute outside it. */
  workspace: string;
  /** The referenced item; undefined = the whole workspace. */
  node?: { type: string; id: string };
}

export function formatReference(ref: WorkspaceReference): string {
  const base = `${REFERENCE_SCHEME}:${ref.workspace.replace(/\\/g, '/')}`;
  return ref.node ? `${base}#${ref.node.type}/${ref.node.id}` : base;
}

/** The reference in `text` (surrounding whitespace, quotes or backticks are ignored); undefined when it is not one. */
export function parseReference(text: string): WorkspaceReference | undefined {
  const s = text.trim().replace(/^[`'"<]+|[`'">]+$/g, '');
  if (!s.startsWith(`${REFERENCE_SCHEME}:`)) return undefined;
  const rest = s.slice(REFERENCE_SCHEME.length + 1);
  // Node ids never hold `#`; a workspace name could, so the last one splits.
  const hash = rest.lastIndexOf('#');
  const workspace = hash < 0 ? rest : rest.slice(0, hash);
  if (!workspace) return undefined;
  if (hash < 0) return { workspace };
  const item = rest.slice(hash + 1);
  const slash = item.indexOf('/');
  if (slash <= 0 || slash === item.length - 1) return undefined;
  return { workspace, node: { type: item.slice(0, slash), id: item.slice(slash + 1) } };
}
