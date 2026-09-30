// Copy & paste of canvas nodes, within a canvas and between workspaces. Pure functions over React Flow nodes, so
// they can be unit tested. Files and folders appear once per canvas: a pasted file that is already on the canvas adds
// its snippets to that file, and a pasted folder that is already there takes in its content.
import { EDITOR_GAP, FILE_HEADER_HEIGHT, FILE_PADDING, GROUP_PADDING, editorFootprint, fileSizeFor, newId, nextEditorSlot, type WorkspaceTag } from '../shared/workspace';
import { absolutePos, copyTrees, isLockedIn, isWithin, sizeOf } from './boardLayout';
import type { RFEdge, RFEditorNode, RFFileNode, RFFolderNode, RFNode } from './context';

const isEditor = (n: RFNode): n is RFEditorNode => n.type === 'editor';
const isFile = (n: RFNode): n is RFFileNode => n.type === 'file';
const isFolder = (n: RFNode): n is RFFolderNode => n.type === 'folder';

const editorSize = (e: RFNode) => ({ width: e.width ?? e.measured?.width ?? 0, height: e.height ?? e.measured?.height ?? 0 });

/**
 * What copying `picked` takes: every picked box with what is inside it (a `copyTrees` snapshot), and snippets picked
 * without their file, copied in a file node that holds only them (stacked like new snippets). `removable` is what a cut
 * removes from the canvas.
 */
export function snapshotNodes(ns: RFNode[], picked: RFNode[]): { nodes: RFNode[]; removable: string[] } {
  const boxes = picked.filter((n) => !isEditor(n) && !picked.some((o) => o.id !== n.id && !isEditor(o) && isWithin(ns, n.id, o.id)));
  const inBox = (id: string) => boxes.some((b) => isWithin(ns, id, b.id));
  const nodes = copyTrees(ns, boxes.map((b) => b.id));
  const removable = boxes.map((b) => b.id);
  const byFile = new Map<string, RFEditorNode[]>();
  for (const e of picked) if (isEditor(e) && !inBox(e.id)) byFile.set(e.parentId!, [...(byFile.get(e.parentId!) ?? []), e]);
  for (const [fileId, picks] of byFile) {
    const file = ns.find((n) => n.id === fileId);
    if (!file || !isFile(file)) continue;
    const all = ns.filter((n) => isEditor(n) && n.parentId === fileId);
    if (all.length === picks.length) {
      nodes.push(...copyTrees(ns, [fileId]));
      removable.push(fileId);
      continue;
    }
    let y = FILE_HEADER_HEIGHT;
    const kids = [...picks]
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((e) => {
        const kid: RFEditorNode = { ...e, hidden: false, expandParent: true, position: { x: FILE_PADDING, y } };
        y += editorFootprint({ ...editorSize(e), annotation: e.data.annotation }) + EDITOR_GAP;
        return kid;
      });
    // Sized to the picked snippets only; a single one becomes a combined node when the layout is normalized.
    const size = fileSizeFor(kids.map((k) => ({ position: k.position, ...editorSize(k), annotation: k.data.annotation })));
    const top: RFFileNode = { ...file, position: absolutePos(ns, fileId), width: size.width, height: size.height, measured: size };
    delete top.parentId;
    nodes.push(top, ...kids);
    removable.push(...picks.map((e) => e.id));
  }
  return { nodes, removable };
}

/**
 * Tags of pasted papers in the target workspace: a tag with the same label (any case) is reused, others are added
 * (with a new id if theirs is taken). Returns the target's tags and old id -> id in the target.
 */
export function mergeTags(existing: WorkspaceTag[], incoming: WorkspaceTag[]): { tags: WorkspaceTag[]; map: Map<string, string> } {
  const tags = [...existing];
  const map = new Map<string, string>();
  for (const t of incoming) {
    const same = tags.find((x) => x.label.trim().toLowerCase() === t.label.trim().toLowerCase());
    if (same) map.set(t.id, same.id);
    else {
      const id = tags.some((x) => x.id === t.id) ? newId('tag') : t.id;
      tags.push({ ...t, id });
      map.set(t.id, id);
    }
  }
  return { tags, map };
}

const sameTarget = (a: RFEditorNode, b: RFEditorNode) => a.data.target?.start === b.data.target?.start && a.data.target?.end === b.data.target?.end;

/**
 * Add pasted copies (fresh ids, already moved to where they go) to the canvas `ns`:
 * - a file already on the canvas gets the pasted snippets it doesn't show yet (same target = same snippet);
 * - a folder already on the canvas takes in the pasted content, below its own (or, locked, the content goes on the canvas);
 * - everything else is added as is.
 * Links follow merged nodes. `roots` are the added top-level nodes (to drop into groups), `reveal` is an existing
 * node that stands for the paste when nothing new was added.
 */
export function mergeCopies(ns: RFNode[], copies: RFNode[], links: RFEdge[]): { nodes: RFNode[]; links: RFEdge[]; roots: Set<string>; reveal?: string } {
  const out = [...ns];
  /** Copy id -> the node on the canvas it merged into. */
  const alias = new Map<string, string>();
  const intoFile = new Map<string, RFFileNode>();
  /** Merged folder copy -> where its content goes (undefined = the canvas) and the shift of its content there. */
  const intoFolder = new Map<string, { parent?: string; shift: { x: number; y: number } }>();
  const roots = new Set<string>();
  let addedEditors = 0;
  const locked = (id: string) => isLockedIn(ns, id);

  for (const c of copies) {
    if (isEditor(c)) continue;
    if (isFile(c)) {
      const existing = ns.find((n): n is RFFileNode => isFile(n) && n.data.file === c.data.file);
      if (existing) {
        alias.set(c.id, existing.id);
        intoFile.set(c.id, existing);
        continue;
      }
    }
    if (isFolder(c)) {
      const existing = ns.find((n): n is RFFolderNode => isFolder(n) && n.data.folder === c.data.folder);
      if (existing) {
        alias.set(c.id, existing.id);
        const kids = copies.filter((k) => k.parentId === c.id && !k.hidden);
        const own = out.filter((k) => k.parentId === existing.id && !k.hidden);
        const minX = Math.min(...kids.map((k) => k.position.x));
        const minY = Math.min(...kids.map((k) => k.position.y));
        const bottom = own.length ? Math.max(...own.map((k) => k.position.y + sizeOf(k).height)) : FILE_HEADER_HEIGHT;
        intoFolder.set(c.id, locked(existing.id) ? { shift: { x: 0, y: 0 } } : { parent: existing.id, shift: { x: GROUP_PADDING - minX, y: bottom + GROUP_PADDING - minY } });
        continue;
      }
    }
    const folder = c.parentId !== undefined ? intoFolder.get(c.parentId) : undefined;
    let node: RFNode = c;
    if (folder?.parent !== undefined) node = { ...c, parentId: folder.parent, position: { x: c.position.x + folder.shift.x, y: c.position.y + folder.shift.y } };
    else if (folder) {
      node = { ...c, position: absolutePos(copies, c.id) };
      delete node.parentId;
    }
    if (node.parentId === undefined) roots.add(node.id);
    out.push({ ...node, selected: node.parentId === undefined } as RFNode);
  }

  for (const e of copies) {
    if (!isEditor(e)) continue;
    const file = intoFile.get(e.parentId!);
    if (!file) {
      out.push({ ...e, selected: false });
      continue;
    }
    const current = out.filter((n): n is RFEditorNode => isEditor(n) && n.parentId === file.id);
    const same = current.find((x) => sameTarget(x, e));
    if (same || locked(file.id)) {
      alias.set(e.id, same?.id ?? file.id);
      continue;
    }
    // Like "Add a snippet editor": below the file's other snippets (a combined node turns into a group).
    const slot = nextEditorSlot(current.map((x) => ({ id: x.id, type: 'editor', parent: file.id, position: x.position, ...editorSize(x), annotation: x.data.annotation })));
    out.push({ ...e, parentId: file.id, hidden: false, expandParent: true, position: slot, selected: true, data: { ...e.data, file: file.data.file } });
    addedEditors++;
  }

  const ids = new Set(out.map((n) => n.id));
  const mapped = links
    .map((l) => ({ ...l, source: alias.get(l.source) ?? l.source, target: alias.get(l.target) ?? l.target }))
    .filter((l) => l.source !== l.target && ids.has(l.source) && ids.has(l.target));
  // A matched snippet over its file: revealing it scrolls to its target.
  const reveal = !roots.size && !addedEditors ? [...alias.values()].reverse()[0] : undefined;
  return { nodes: out, links: mapped, roots, reveal };
}
