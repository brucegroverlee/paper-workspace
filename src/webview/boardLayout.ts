// Tree helpers for React Flow nodes nested in groups (positions of children are relative to their parent).
// Pure functions over minimal node shapes so they can be unit tested without React Flow.
import { FILE_HEADER_HEIGHT, GROUP_PADDING, groupHeaderHeight, isContainerType, type XY } from '../shared/workspace';

export interface TreeNode {
  id: string;
  type?: string;
  parentId?: string;
  position: XY;
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
  hidden?: boolean;
  zIndex?: number;
  /** A group's data; its title font size and position decide where its title bar is. */
  data?: object;
}

/** Room a group's (or folder's) title bar takes at its top and bottom edges. */
export function titleBarOf(n: TreeNode) {
  if (n.type === 'folder') return { top: FILE_HEADER_HEIGHT, bottom: 0 };
  const d = (n.data ?? {}) as { fontSize?: number; titlePosition?: string };
  const h = groupHeaderHeight(d.fontSize);
  return d.titlePosition?.startsWith('bottom') ? { top: 0, bottom: h } : { top: h, bottom: 0 };
}

export const sizeOf = (n: TreeNode) => ({ width: n.width ?? n.measured?.width ?? 0, height: n.height ?? n.measured?.height ?? 0 });

/** Canvas position of a node. */
export function absolutePos(ns: TreeNode[], id: string): XY {
  const byId = new Map(ns.map((n) => [n.id, n]));
  let n = byId.get(id);
  let x = 0;
  let y = 0;
  for (let i = 0; n && i <= ns.length; i++) {
    x += n.position.x;
    y += n.position.y;
    n = n.parentId !== undefined ? byId.get(n.parentId) : undefined;
  }
  return { x, y };
}

/** Whether `id` is `ancestorId` or nested (at any depth) inside it. */
export function isWithin(ns: TreeNode[], id: string, ancestorId: string): boolean {
  const byId = new Map(ns.map((n) => [n.id, n]));
  let cur: string | undefined = id;
  for (let i = 0; cur !== undefined && i <= ns.length; i++) {
    if (cur === ancestorId) return true;
    cur = byId.get(cur)?.parentId;
  }
  return false;
}

/** Whether `id`, or a node it sits in (at any depth), is locked (see the workspace model). */
export function isLockedIn(ns: TreeNode[], id: string): boolean {
  const byId = new Map(ns.map((n) => [n.id, n]));
  let n = byId.get(id);
  for (let i = 0; n && i <= ns.length; i++) {
    if ((n.data as { locked?: boolean } | undefined)?.locked) return true;
    n = n.parentId !== undefined ? byId.get(n.parentId) : undefined;
  }
  return false;
}

/** Move `id` into group `parentId` (undefined = the canvas) without moving it on screen; it goes on top of its new siblings. */
export function reparent<T extends TreeNode>(ns: T[], id: string, parentId: string | undefined): T[] {
  const node = ns.find((n) => n.id === id);
  if (!node || node.parentId === parentId) return ns;
  const abs = absolutePos(ns, id);
  const base = parentId !== undefined ? absolutePos(ns, parentId) : { x: 0, y: 0 };
  const moved = { ...node, parentId, position: { x: abs.x - base.x, y: abs.y - base.y } };
  if (parentId === undefined) delete moved.parentId;
  return [...ns.filter((n) => n.id !== id), moved];
}

/**
 * The group a dragged node would drop into: the topmost group under the node's center, excluding the dragged
 * nodes and everything inside them, and locked groups (their content can't change).
 */
export function dropTargetFor(ns: TreeNode[], id: string, dragged: Set<string>): string | undefined {
  const node = ns.find((n) => n.id === id);
  if (!node) return undefined;
  const abs = absolutePos(ns, id);
  const size = sizeOf(node);
  const c = { x: abs.x + size.width / 2, y: abs.y + size.height / 2 };
  let best: TreeNode | undefined;
  for (const g of ns) {
    if (!isContainerType(g.type) || g.hidden || [...dragged].some((d) => isWithin(ns, g.id, d)) || isLockedIn(ns, g.id)) continue;
    const p = absolutePos(ns, g.id);
    const s = sizeOf(g);
    if (c.x < p.x || c.y < p.y || c.x > p.x + s.width || c.y > p.y + s.height) continue;
    if (!best || (g.zIndex ?? 0) >= (best.zIndex ?? 0)) best = g;
  }
  return best?.id;
}

/**
 * Move the dropped nodes `ids` into the group under each one (or out to the canvas), skipping nodes carried by a
 * dropped parent. Must run before `fitGroups`, or the old group grows around a node dragged out of it.
 */
export function dropNodes<T extends TreeNode>(ns: T[], ids: Set<string>): T[] {
  const roots = ns.filter((n) => ids.has(n.id) && !(n.parentId !== undefined && ids.has(n.parentId))).map((n) => n.id);
  const moving = new Set(roots);
  let out = ns;
  for (const id of roots) out = reparent(out, id, dropTargetFor(out, id, moving));
  return out;
}

/**
 * Grow groups so their children fit: a child sticking out on the left or over a top title bar moves the group
 * (children keep their place on screen); sticking out right or below (or over a bottom title bar) grows it. Deepest groups first, so a
 * grown group can grow its own parent.
 */
export function fitGroups<T extends TreeNode>(ns: T[]): T[] {
  const depth = (id: string) => {
    let d = 0;
    for (let n = ns.find((x) => x.id === id); n?.parentId !== undefined && d <= ns.length; d++) {
      const pid: string = n.parentId;
      n = ns.find((x) => x.id === pid);
    }
    return d;
  };
  const groups = ns.filter((n) => isContainerType(n.type)).sort((a, b) => depth(b.id) - depth(a.id));
  let out = ns;
  for (const { id } of groups) {
    const g = out.find((n) => n.id === id)!;
    const kids = out.filter((n) => n.parentId === id && !n.hidden);
    if (!kids.length) continue;
    const { width, height } = sizeOf(g);
    const minX = Math.min(...kids.map((k) => k.position.x));
    const minY = Math.min(...kids.map((k) => k.position.y));
    const maxX = Math.max(...kids.map((k) => k.position.x + sizeOf(k).width));
    const maxY = Math.max(...kids.map((k) => k.position.y + sizeOf(k).height));
    const dx = minX < 0 ? GROUP_PADDING - minX : 0;
    const bar = titleBarOf(g);
    const dy = minY < bar.top ? bar.top + GROUP_PADDING / 2 - minY : 0;
    const w = (maxX > width ? maxX + GROUP_PADDING : width) + dx;
    const h = (maxY > height - bar.bottom ? maxY + (bar.bottom ? bar.bottom + GROUP_PADDING / 2 : GROUP_PADDING) : height) + dy;
    if (!dx && !dy && w === width && h === height) continue;
    out = out.map((n) => {
      if (n.id === id) return { ...n, position: { x: n.position.x - dx, y: n.position.y - dy }, width: w, height: h, measured: { width: w, height: h } };
      if (n.parentId === id && (dx || dy)) return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
      return n;
    });
  }
  return out;
}

/**
 * Tree order (each node followed by its descendants, siblings in array order) with explicit z-indexes from that
 * order: parents before children (React Flow requirement), a group paints below its content, and nothing inside
 * an older node paints over a newer one. Returns the same array when nothing changes.
 */
export function arrange<T extends TreeNode>(ns: T[]): T[] {
  const ids = new Set(ns.map((n) => n.id));
  const kids = new Map<string | undefined, T[]>();
  for (const n of ns) {
    const key = n.parentId !== undefined && ids.has(n.parentId) ? n.parentId : undefined;
    kids.set(key, [...(kids.get(key) ?? []), n]);
  }
  const ordered: T[] = [];
  const seen = new Set<string>();
  const visit = (n: T) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    ordered.push(n);
    for (const k of kids.get(n.id) ?? []) visit(k);
  };
  for (const root of kids.get(undefined) ?? []) visit(root);
  for (const n of ns) visit(n); // unreachable (cyclic) parents: keep the nodes rather than drop them
  let changed = false;
  const out = ordered.map((n, zIndex) => {
    if (ns[zIndex] !== n) changed = true;
    if (n.zIndex === zIndex) return n;
    changed = true;
    return { ...n, zIndex };
  });
  return changed ? out : ns;
}

/**
 * Snapshot of `rootIds` and everything inside them that `keep` accepts, for copy & paste: the roots come out
 * top-level at their canvas position, children stay relative to their parent, stacking order is kept.
 */
export function copyTrees<T extends TreeNode>(ns: T[], rootIds: string[], keep: (n: T) => boolean = () => true): T[] {
  const roots = new Set(rootIds);
  return ns
    .filter((n) => keep(n) && rootIds.some((r) => isWithin(ns, n.id, r)))
    .map((n) => {
      if (!roots.has(n.id)) return { ...n };
      const top = { ...n, position: absolutePos(ns, n.id) };
      delete top.parentId;
      return top;
    });
}

/** Fresh copies of a `copyTrees` snapshot with new ids (parents remapped), the roots moved by `offset`. */
export function cloneTrees<T extends TreeNode>(snapshot: T[], offset: XY, makeId: (n: T) => string): T[] {
  const ids = new Map(snapshot.map((n) => [n.id, makeId(n)]));
  return snapshot.map((n) => {
    const copy = { ...n, id: ids.get(n.id)! };
    if (n.parentId === undefined) copy.position = { x: n.position.x + offset.x, y: n.position.y + offset.y };
    else copy.parentId = ids.get(n.parentId);
    return copy;
  });
}
