import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import {
  DEFAULT_EDITOR_HEIGHT,
  DEFAULT_EDITOR_WIDTH,
  DEFAULT_EDITOR_SHOW_TITLE,
  DEFAULT_FILE_SHOW_TITLE,
  DEFAULT_FOLDER_SHOW_TITLE,
  DEFAULT_GROUP_SIZE,
  DEFAULT_NOTE_SIZE,
  DEFAULT_TEXT_SIZE,
  GROUP_HEADER_HEIGHT,
  GROUP_PADDING,
  WORKSPACE_VERSION,
  isVideoPath,
  isMediaPath,
  mediaSizeFor,
  editorHeightFor,
  FILE_HEADER_HEIGHT,
  FILE_PADDING,
  ANNOTATION_SPACE,
  EDITOR_GAP,
  fileSizeFor,
  singleFileSize,
  newId,
  nextEditorSlot,
  restack,
  stackPosition,
  type StackOp,
  isLightColor,
  SIDES,
  type Side,
  type EditorNode as WorkspaceEditorNode,
  type LineRange,
  type WorkspaceEdge,
  type WorkspaceFile,
  type WorkspaceNode,
  type WorkspaceTag,
  DEFAULT_TAG_PLACEMENT,
  type TagPlacement,
  COLOR_GRID,
  CUSTOM_COLORS_MAX,
  isLockableType,
} from '../shared/workspace';
import { isAbsoluteWorkspacePath } from '../shared/paths';
import { DEFAULT_CANVAS_CONFIG, type CanvasConfig, type EditorSettings, type HostToWebview } from '../shared/protocol';
import { absolutePos, arrange, cloneTrees, copyTrees, dropNodes, dropTargetFor, fitGroups, isLockedIn, isWithin, reparent, sizeOf } from './boardLayout';
import { GroupNode, MediaNode, ShapeNode, TextNode, editWhenMounted } from './BoardNodes';
import { WorkspaceContext, type WorkspaceActions, type RFEdge, type RFEditorNode, type RFFileNode, type RFFolderNode, type RFGroupNode, type RFNode, type RFShapeNode } from './context';
import { facingSides, nearestSide, nodeHandles } from './handles';
import { LinkEdge } from './Links';
import { docStore } from './docStore';
import { EditorNode, editorHasFocus, focusLastEditor, lastFocusedEditorId, requestScrollToTarget, selectedLines } from './EditorNode';
import { FileNode } from './FileNode';
import { FolderNode } from './FolderNode';
import { MenuPopup, type HeaderMenuItem, type MenuEntries } from './HeaderMenu';
import { watchHostTheme } from './monaco';
import { resetThemeColors } from './tone';
import { folderStore } from './folderStore';
import { handleLanguageMessage, registerLanguageBridge } from './language';
import { handleGitMessage, registerGitGutter } from './git';
import { handleTextmateMessage, initTextmate } from './textmate';
import { ConfigPanel, HelpOverlay, Toolbar, clearOfToolbar, ZOOM_LIMITS, type CreateKind, type Tool } from './Toolbar';
import { ResizeBadge } from './ResizeBadge';
import { ShapesPanel } from './ShapesPanel';
import { SHAPE_DRAG_TYPE, shapeDef } from './shapes';
import { TagManagerDialog, TagPickerDialog, ZoomCssVar } from './Tags';
import { captureView, captureWorkspace, settle, type SnapshotScope } from './snapshot';
import { host, onHostMessage } from './vscodeApi';

const nodeTypes = { file: FileNode, editor: EditorNode, folder: FolderNode, group: GroupNode, text: TextNode, note: TextNode, media: MediaNode, shape: ShapeNode };
const edgeTypes = { link: LinkEdge };
const COMMIT_DELAY = 250;

interface PersistedState {
  viewport?: Viewport;
  minimap?: boolean;
}

const isEditor = (n: RFNode): n is RFEditorNode => n.type === 'editor';
const isFile = (n: RFNode): n is RFFileNode => n.type === 'file';
const isFolder = (n: RFNode): n is RFFolderNode => n.type === 'folder';
/** Papers with a title label, title bar color and tags. */
const isTitled = (n: RFNode): n is RFFileNode | RFEditorNode | RFFolderNode => isFile(n) || isEditor(n) || isFolder(n);

const isBox = (n: RFNode) => n.type !== 'editor';
const isGroup = (n: RFNode): n is RFGroupNode => n.type === 'group';

// Headers drag their paper; so does the code area while it is a static preview (zoomed far out), and the empty body
// of a file with several snippets (its editors are separate nodes, so only the gaps between them match).
const EDITOR_DRAG_HANDLE = '.pw-editor-header, .pw-editor-body.preview, .pw-node-title';
const FILE_DRAG_HANDLE = '.pw-file-header, .pw-file:not(.single), .pw-editor-body.preview, .pw-node-title';

/** React Flow props of a box node (anything but an editor) by kind. */
function boxProps(type: RFNode['type']): { dragHandle?: string } {
  if (type === 'file') return { dragHandle: FILE_DRAG_HANDLE };
  return {};
}

function toRFNodes(workspace: WorkspaceFile, prev: RFNode[]): RFNode[] {
  const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
  const fileById = new Map<string, string>();
  const out: RFNode[] = [];
  for (const n of workspace.nodes) {
    if (n.type === 'editor') continue;
    const base = {
      id: n.id,
      ...(n.parent !== undefined ? { parentId: n.parent } : {}),
      position: n.position,
      width: n.width,
      height: n.height,
      // Sizes are explicit, so mark nodes as measured: fitView (and reveal) wait for every node to be
      // measured, and offscreen nodes (onlyRenderVisibleElements) or rebuilt node objects never would be.
      measured: { width: n.width, height: n.height },
      selected: selected.has(n.id),
      ...boxProps(n.type),
    };
    if (n.type === 'file') {
      fileById.set(n.id, n.file);
      out.push({ ...base, type: 'file', data: { file: n.file, annotation: n.annotation, title: n.title, showTitle: n.showTitle, headerColor: n.headerColor, tags: n.tags, color: n.color, locked: n.locked } });
    } else if (n.type === 'folder')
      out.push({ ...base, type: 'folder', data: { folder: n.folder, annotation: n.annotation, title: n.title, showTitle: n.showTitle, headerColor: n.headerColor, tags: n.tags, color: n.color, locked: n.locked } });
    else if (n.type === 'group') out.push({ ...base, type: 'group', data: { title: n.title, color: n.color, textColor: n.textColor, fontSize: n.fontSize, fontWeight: n.fontWeight, titlePosition: n.titlePosition, strokeColor: n.strokeColor, strokeWidth: n.strokeWidth, strokeStyle: n.strokeStyle, annotation: n.annotation, locked: n.locked } });
    else if (n.type === 'media') out.push({ ...base, type: 'media', data: { src: n.src, annotation: n.annotation } });
    else if (n.type === 'shape')
      out.push({
        ...base,
        type: 'shape',
        data: { shape: n.shape, text: n.text, color: n.color, strokeColor: n.strokeColor, textColor: n.textColor, fontSize: n.fontSize, fontWeight: n.fontWeight, annotation: n.annotation },
      });
    else out.push({ ...base, type: n.type, data: { text: n.text, color: n.color, textColor: n.textColor, fontSize: n.fontSize, fontWeight: n.fontWeight } });
  }
  for (const n of workspace.nodes) {
    if (n.type !== 'editor') continue;
    out.push({
      id: n.id,
      type: 'editor',
      parentId: n.parent,
      expandParent: true,
      position: n.position,
      width: n.width,
      height: n.height,
      measured: { width: n.width, height: n.height },
      dragHandle: EDITOR_DRAG_HANDLE,
      selected: selected.has(n.id),
      data: { file: fileById.get(n.parent) ?? '', target: n.target, anchor: n.anchor, annotation: n.annotation, title: n.title, showTitle: n.showTitle, headerColor: n.headerColor, tags: n.tags, locked: n.locked },
    });
  }
  return normalizeLayout(out);
}

const sized = <T extends RFNode>(n: T, width: number, height: number): T => ({ ...n, width, height, measured: { width, height } });

/**
 * A file with ONE editor is a combined node: the editor's React Flow node is hidden and FileNode embeds it,
 * with the file's size authoritative. With several editors the file is a group of visible, padded editors.
 * Handles both transitions: collapse (file takes the remaining editor's size) and expand (the embedded
 * editor keeps its size and becomes a padded child).
 */
function normalizeLayout(ns: RFNode[]): RFNode[] {
  const children = new Map<string, RFEditorNode[]>();
  for (const n of ns) if (isEditor(n)) children.set(n.parentId!, [...(children.get(n.parentId!) ?? []), n]);
  const updates = new Map<string, RFNode>();
  for (const f of ns.filter(isFile)) {
    const kids = children.get(f.id) ?? [];
    let file = f;
    if (kids.length === 1) {
      const k = kids[0];
      let data = k.data;
      if (!k.hidden) {
        const size = singleFileSize({ width: k.width ?? DEFAULT_EDITOR_WIDTH, height: k.height ?? DEFAULT_EDITOR_HEIGHT });
        file = sized(file, size.width, size.height);
      }
      if (data.annotation !== undefined) {
        // A combined node shows only the file's caption: the last snippet's caption joins it.
        const joined = [file.data.annotation, data.annotation].filter((a) => a).join('\n');
        file = { ...file, data: { ...file.data, annotation: joined } };
        data = { ...data, annotation: undefined };
      }
      if (data.tags?.length) {
        // Likewise its tags: the combined node shows the file's.
        file = { ...file, data: { ...file.data, tags: [...new Set([...(file.data.tags ?? []), ...data.tags])] } };
        data = { ...data, tags: undefined };
      }
      if (data.locked) {
        // And its lock: locking the combined node locks the file.
        file = { ...file, data: { ...file.data, locked: true } };
        data = { ...data, locked: undefined };
      }
      const w = file.width ?? DEFAULT_EDITOR_WIDTH;
      const h = file.height ?? DEFAULT_EDITOR_HEIGHT;
      // No expandParent while embedded: React Flow's resizer never shrinks a parent below such children,
      // even hidden ones, so the combined node could otherwise only grow.
      const embedded = { ...k, data, hidden: true, expandParent: false, selected: false, position: { x: 0, y: FILE_HEADER_HEIGHT } };
      updates.set(k.id, sized(embedded, w, h - FILE_HEADER_HEIGHT));
    } else if (kids.length > 1) {
      const laid = kids.map((k) => {
        if (!k.hidden) return k;
        const e = { ...k, hidden: false, expandParent: true, position: { x: FILE_PADDING, y: FILE_HEADER_HEIGHT } };
        updates.set(k.id, e);
        return e;
      });
      const size = fileSizeFor(
        laid.map((k) => ({ position: k.position, width: k.width ?? DEFAULT_EDITOR_WIDTH, height: k.height ?? DEFAULT_EDITOR_HEIGHT, annotation: k.data.annotation })),
      );
      const w = Math.max(file.width ?? 0, size.width);
      const h = Math.max(file.height ?? 0, size.height);
      if (w !== file.width || h !== file.height) file = sized(file, w, h);
    }
    if (file !== f) updates.set(f.id, file);
  }
  return updates.size ? ns.map((n) => updates.get(n.id) ?? n) : ns;
}

/**
 * React Flow flags from the locks: a locked node (or one inside a locked group, folder or file) can't be dragged, and
 * neither it nor what contains it can be deleted. Returns the same array when nothing changes.
 */
function applyLocks(ns: RFNode[]): RFNode[] {
  const byId = new Map(ns.map((n) => [n.id, n]));
  const locked = new Set(ns.filter((n) => isLockedIn(ns, n.id)).map((n) => n.id));
  // Containers of a locked node: deleting them would delete it.
  const holdsLocked = new Set<string>();
  for (const id of locked) for (let p = byId.get(id)?.parentId, i = 0; p !== undefined && i <= ns.length; p = byId.get(p)?.parentId, i++) holdsLocked.add(p);
  let changed = false;
  const out = ns.map((n) => {
    const draggable = locked.has(n.id) ? false : undefined;
    const deletable = locked.has(n.id) || holdsLocked.has(n.id) ? false : undefined;
    // React Flow marks only draggable nodes `nopan`; without it the pane's own double-click zoom would fight
    // "double-click to focus" (and a drag would pan), so locked nodes keep it and navigate like the others.
    const className = locked.has(n.id) ? 'nopan' : undefined;
    if (n.draggable === draggable && n.deletable === deletable && n.className === className) return n;
    changed = true;
    const next = { ...n, draggable, deletable, className };
    if (draggable === undefined) delete next.draggable;
    if (deletable === undefined) delete next.deletable;
    if (className === undefined) delete next.className;
    return next;
  });
  return changed ? out : ns;
}

/** A snippet just got a caption: push the snippets below it (in its file) down, so the caption does not sit under them. */
function makeRoomBelow(ns: RFNode[], editor: RFEditorNode): RFNode[] {
  const left = editor.position.x;
  const right = left + (editor.width ?? DEFAULT_EDITOR_WIDTH);
  const bottom = editor.position.y + (editor.height ?? DEFAULT_EDITOR_HEIGHT);
  const below = ns.filter(
    (n): n is RFEditorNode =>
      isEditor(n) && n.parentId === editor.parentId && n.id !== editor.id && n.position.y >= bottom && n.position.x < right && n.position.x + (n.width ?? 0) > left,
  );
  if (!below.length) return ns;
  const shift = bottom + ANNOTATION_SPACE + EDITOR_GAP - Math.min(...below.map((n) => n.position.y));
  if (shift <= 0) return ns;
  const moved = new Set(below.map((n) => n.id));
  return ns.map((n) => (moved.has(n.id) ? { ...n, position: { x: n.position.x, y: n.position.y + shift } } : n));
}

/** Boxes stack among the boxes of their group (or the canvas), editors among the editors of their file. */
const stackGroup = (n: RFNode) => n.parentId;

const sideOf = (handle: string | null | undefined): Side | undefined => SIDES.find((s) => s === handle);

/** Kind of the nearest locked node containing `id` ("group", "folder" or "file"), for menu labels. */
function lockOwnerKind(ns: RFNode[], id: string): string {
  const byId = new Map(ns.map((n) => [n.id, n]));
  let n = byId.get(byId.get(id)?.parentId ?? '');
  for (let i = 0; n && i <= ns.length; i++) {
    if ((n.data as { locked?: boolean }).locked) return n.type;
    n = n.parentId !== undefined ? byId.get(n.parentId) : undefined;
  }
  return 'container';
}

function toRFEdges(workspace: WorkspaceFile, prev: RFEdge[]): RFEdge[] {
  const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
  return workspace.edges.map(({ id, source, target, sourceSide, targetSide, ...data }) => ({
    id,
    type: 'link',
    source,
    target,
    sourceHandle: sourceSide ?? null,
    targetHandle: targetSide ?? null,
    selected: selected.has(id),
    data,
  }));
}

/** Links whose ends both still exist (removing a node drops its links). */
function toWorkspaceEdges(nodes: RFNode[], edges: RFEdge[]): WorkspaceEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  return edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ ...e.data, id: e.id, source: e.source, target: e.target, sourceSide: sideOf(e.sourceHandle), targetSide: sideOf(e.targetHandle) }));
}

/** Each node with its four handles as data, so links draw even to nodes that are not mounted (cached per node object). */
const handleCache = new WeakMap<RFNode, RFNode>();
function withHandles(n: RFNode): RFNode {
  let out = handleCache.get(n);
  if (!out) {
    const { width, height } = sizeOf(n);
    out = { ...n, handles: nodeHandles(width, height) } as RFNode;
    handleCache.set(n, out);
  }
  return out;
}

/**
 * The links React Flow draws: an end on an embedded (hidden) editor is drawn on its file node; ends without a chosen
 * side use the sides facing each other. A link paints above both of its ends.
 */
function shownLinks(nodes: RFNode[], edges: RFEdge[]): RFEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const shown = (id: string) => {
    const n = byId.get(id);
    return n?.hidden && n.parentId ? byId.get(n.parentId) : n;
  };
  const rect = (n: RFNode) => ({ ...absolutePos(nodes, n.id), ...sizeOf(n) });
  const out: RFEdge[] = [];
  for (const e of edges) {
    const s = shown(e.source);
    const t = shown(e.target);
    if (!s || !t || s.id === t.id) continue;
    const auto = e.sourceHandle && e.targetHandle ? undefined : facingSides(rect(s), rect(t));
    // React Flow adds a child node's own z-index on top of this; top-level ends need it here.
    const z = Math.max(s.parentId === undefined ? s.zIndex ?? 0 : 0, t.parentId === undefined ? t.zIndex ?? 0 : 0) + 1;
    out.push({
      ...e,
      source: s.id,
      target: t.id,
      sourceHandle: e.sourceHandle ?? auto!.source,
      targetHandle: e.targetHandle ?? auto!.target,
      zIndex: z,
    });
  }
  return out;
}

/** The node under a pointer (the topmost one; none if it is `except`) and its side facing the pointer. */
function nodeSideAt(rf: ReturnType<typeof useReactFlow<RFNode>>, event: MouseEvent | TouchEvent, except: string) {
  const point = 'changedTouches' in event ? event.changedTouches[0] : event;
  if (!point) return undefined;
  const el = document.elementsFromPoint(point.clientX, point.clientY).find((e) => e.closest('.react-flow__node'));
  const id = el?.closest('.react-flow__node')?.getAttribute('data-id');
  const node = id && id !== except ? rf.getInternalNode(id) : undefined;
  if (!node) return undefined;
  const p = rf.screenToFlowPosition({ x: point.clientX, y: point.clientY });
  const { width = 0, height = 0 } = node.measured;
  return { id: node.id, side: nearestSide({ ...node.internals.positionAbsolute, width, height }, p) };
}

function toWorkspace(nodes: RFNode[], edges: RFEdge[], { tags, tagPlacement, showTags, customColors }: WorkspaceOptions): WorkspaceFile {
  nodes = normalizeLayout(nodes); // sync embedded editors with their (possibly resized) file
  const out: WorkspaceNode[] = nodes.map((n) => {
    const rect = {
      id: n.id,
      position: n.position,
      width: n.width ?? n.measured?.width ?? DEFAULT_EDITOR_WIDTH,
      height: n.height ?? n.measured?.height ?? DEFAULT_EDITOR_HEIGHT,
    };
    const parent = n.parentId !== undefined ? { parent: n.parentId } : {};
    switch (n.type) {
      case 'editor':
        return { ...rect, type: 'editor', parent: n.parentId!, target: n.data.target, anchor: n.data.anchor, annotation: n.data.annotation, title: n.data.title, showTitle: n.data.showTitle, headerColor: n.data.headerColor, tags: n.data.tags, locked: n.data.locked };
      case 'file':
        return { ...rect, ...parent, type: 'file', file: n.data.file, annotation: n.data.annotation, title: n.data.title, showTitle: n.data.showTitle, headerColor: n.data.headerColor, tags: n.data.tags, color: n.data.color, locked: n.data.locked };
      case 'folder':
        return { ...rect, ...parent, type: 'folder', ...n.data };
      case 'group':
        return { ...rect, ...parent, type: 'group', ...n.data };
      case 'shape':
        return { ...rect, ...parent, type: 'shape', ...n.data };
      case 'media':
        return { ...rect, ...parent, type: 'media', src: n.data.src, annotation: n.data.annotation };
      default:
        return { ...rect, ...parent, type: n.type, text: n.data.text, color: n.data.color, textColor: n.data.textColor, fontSize: n.data.fontSize, fontWeight: n.data.fontWeight };
    }
  });
  return {
    version: WORKSPACE_VERSION,
    ...(tags.length ? { tags } : {}),
    ...(tagPlacement !== DEFAULT_TAG_PLACEMENT ? { tagPlacement } : {}),
    ...(!showTags ? { showTags: false } : {}),
    ...(customColors.length ? { customColors } : {}),
    nodes: out,
    edges: toWorkspaceEdges(nodes, edges),
  };
}

/** Workspace-wide state besides nodes and links: tags (definitions, placement, visibility) and the picker's custom colors. */
type WorkspaceOptions = { tags: WorkspaceTag[]; tagPlacement: TagPlacement; showTags: boolean; customColors: string[] };

/** Keep the docStore's range trackers in sync with the editors that have a target. */
function syncTrackers(nodes: RFNode[], previous: RFNode[]) {
  const ids = new Set(nodes.filter(isEditor).filter((n) => n.data.target).map((n) => n.id));
  for (const n of previous) if (isEditor(n) && !ids.has(n.id)) docStore.untrack(n.id);
  for (const n of nodes) {
    if (isFile(n)) docStore.ensure(n.data.file);
    else if (isEditor(n) && n.data.target) docStore.track(n.id, n.data.file, n.data.target, n.data.anchor);
  }
}

/** Removing a node removes what is inside it; removing a file's last editor removes the file. */
function pruneNodes(ns: RFNode[]): RFNode[] {
  for (;;) {
    const ids = new Set(ns.map((n) => n.id));
    const next = ns.filter((n) => n.parentId === undefined || ids.has(n.parentId));
    if (next.length === ns.length) break;
    ns = next;
  }
  const filesWithEditors = new Set(ns.filter(isEditor).map((n) => n.parentId));
  return ns.filter((n) => !isFile(n) || filesWithEditors.has(n.id));
}

/** The boxes a selection stands for: an editor stands for its file; nodes inside another selected node are dropped. */
function selectionRoots(ns: RFNode[]): RFNode[] {
  const byId = new Map(ns.map((n) => [n.id, n]));
  const ids = new Set<string>();
  for (const n of ns) if (n.selected) ids.add(isEditor(n) ? n.parentId! : n.id);
  return ns.filter((n) => ids.has(n.id) && ![...ids].some((other) => other !== n.id && isWithin(ns, n.id, other)) && byId.has(n.id));
}

/** Natural size of an image or video, for sizing a new media node (falls back to a default after a while). */
function loadMediaSize(url: string, video: boolean): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const fallback = setTimeout(() => resolve({ width: 0, height: 0 }), 4000);
    const done = (width: number, height: number) => {
      clearTimeout(fallback);
      resolve({ width, height });
    };
    if (video) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => done(v.videoWidth, v.videoHeight);
      v.onerror = () => done(0, 0);
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => done(img.naturalWidth, img.naturalHeight);
      img.onerror = () => done(0, 0);
      img.src = url;
    }
  });
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

const MEDIA_MIME = /^(image|video)\//;
const EXT_BY_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'video/quicktime': 'mov' };

function mediaFileName(file: Blob & { name?: string }) {
  if (file.name && file.name !== 'image.png') return file.name;
  const ext = EXT_BY_MIME[file.type] ?? file.type.split('/')[1]?.replace(/[^\w]/g, '') ?? 'png';
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `pasted-${stamp}.${ext}`;
}

/** The node that represents `id` on screen: an embedded (hidden) editor is shown by its file node. */
function visibleNodeId(nodes: RFNode[], id: string) {
  const n = nodes.find((x) => x.id === id);
  return n?.hidden && n.parentId ? n.parentId : id;
}

/** Typing goes there, not to canvas shortcuts (dialogs count as a whole: their buttons take keys too). */
function isEditableTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el?.closest?.('input, textarea, [contenteditable="true"], .monaco-editor, .pw-dialog, .pw-color-popup');
}

export function App() {
  const rf = useReactFlow<RFNode>();
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<RFNode>([]);
  const [settings, setSettings] = useState<EditorSettings | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [tool, setTool] = useState<Tool>('select');
  const [help, setHelp] = useState(false);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [config, setConfig] = useState<CanvasConfig>(DEFAULT_CANVAS_CONFIG);
  /** Side panel beside the toolbar (one at a time). */
  const [panel, setPanel] = useState<'config' | 'shapes' | null>(null);
  const togglePanel = useCallback((p: 'config' | 'shapes') => setPanel((o) => (o === p ? null : p)), []);
  /** Config edits not yet sent to the host (see changeConfig). */
  const pendingConfig = useRef<{ patch: Partial<CanvasConfig>; timer: number } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<{ id: string; at: { x: number; y: number }; items?: MenuEntries } | null>(null);
  /** Right-click on the empty canvas. */
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  /** Where the right button went down, to tell a right-click from a right-drag pan. */
  const rightDown = useRef<{ x: number; y: number } | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  /** The workspace's tag definitions (papers hold their ids). */
  const [workspaceOptions, setWorkspaceOptionsState] = useState<WorkspaceOptions>({ tags: [], tagPlacement: DEFAULT_TAG_PLACEMENT, showTags: true, customColors: [] });
  const { tags, tagPlacement, showTags, customColors } = workspaceOptions;
  const optionsRef = useRef(workspaceOptions);
  const setWorkspaceOptions = useCallback((patch: Partial<WorkspaceOptions>) => {
    optionsRef.current = { ...optionsRef.current, ...patch }; // before the commit that saves them
    setWorkspaceOptionsState(optionsRef.current);
  }, []);
  const setTags = useCallback((next: WorkspaceTag[]) => setWorkspaceOptions({ tags: next }), [setWorkspaceOptions]);
  /** Tag dialogs: the picker of one paper, or the workspace's tag manager. */
  const [tagDialog, setTagDialog] = useState<{ kind: 'picker'; id: string } | { kind: 'manager' } | null>(null);

  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<RFEdge>([]);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const configRef = useRef(config);
  configRef.current = config;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const readOnlyRef = useRef(false);
  const mediaRootRef = useRef('');
  const commitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingReveal = useRef<string | null>(null);
  const initialViewport = useMemo(() => host.getState<PersistedState>()?.viewport, []);
  const [minimap, setMinimap] = useState(() => host.getState<PersistedState>()?.minimap ?? true);
  /** A snapshot is being taken. */
  const [snapshot, setSnapshot] = useState<SnapshotScope | null>(null);
  /** Offscreen papers are rendered too, until a workspace snapshot has copied them. */
  const [renderAll, setRenderAll] = useState(false);
  /** Outcome note under the canvas: the image went to VS Code's save dialog, or why it could not be made. */
  const [snapshotNote, setSnapshotNote] = useState<{ text: string; error?: boolean } | null>(null);
  if (__HARNESS__) (window as any).__rf = rf;

  // ---- persistence -------------------------------------------------------------------------------

  const commit = useCallback(() => {
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      // Never overwrite a .workspace file we could not parse; the user may be fixing it by hand.
      if (readOnlyRef.current) return;
      host.postMessage({ type: 'update', workspace: toWorkspace(nodesRef.current, edgesRef.current, optionsRef.current) });
    }, COMMIT_DELAY);
  }, []);

  /** Apply a node update and keep trackers in sync (all structural changes go through here). */
  const updateNodes = useCallback(
    (fn: (ns: RFNode[]) => RFNode[], persist = true) => {
      setNodes((prev) => {
        const next = applyLocks(arrange(fitGroups(normalizeLayout(fn(prev)))));
        syncTrackers(next, prev);
        return next;
      });
      if (persist) commit();
    },
    [commit, setNodes],
  );

  const applyWorkspace = useCallback(
    (workspace: WorkspaceFile, error?: string) => {
      readOnlyRef.current = !!error;
      setWorkspaceError(error);
      setWorkspaceOptions({ tags: workspace.tags ?? [], tagPlacement: workspace.tagPlacement ?? DEFAULT_TAG_PLACEMENT, showTags: workspace.showTags !== false, customColors: workspace.customColors ?? [] });
      setEdges((prev) => toRFEdges(workspace, prev));
      updateNodes((prev) => toRFNodes(workspace, prev), false);
    },
    [setEdges, setWorkspaceOptions, updateNodes],
  );

  // ---- host messages -----------------------------------------------------------------------------

  // Keep the latest closures in a ref so the host subscription (and 'ready') happens exactly once.
  const hostHandler = useRef<(m: HostToWebview) => void>(() => {});
  useEffect(() => {
    hostHandler.current = (m: HostToWebview) => {
      switch (m.type) {
        case 'init':
          initTextmate(m.textmate); // before any doc model is created
          mediaRootRef.current = m.mediaRoot ?? '';
          setSettings(m.settings);
          if (m.config) setConfig({ ...DEFAULT_CANVAS_CONFIG, ...m.config });
          applyWorkspace(m.workspace, m.error);
          if (!initialViewport && m.workspace.nodes.length) {
            requestAnimationFrame(() => rf.fitView({ padding: clearOfToolbar(0.15), maxZoom: 1 }));
          }
          break;
        case 'workspace':
          applyWorkspace(m.workspace, m.error);
          break;
        case 'settings':
          setSettings(m.settings);
          break;
        case 'config':
          setConfig({ ...DEFAULT_CANVAS_CONFIG, ...m.config, ...pendingConfig.current?.patch }); // unsent edits win over the echo
          break;
        case 'mediaAdded':
          void addMedia(m.srcs, m.position);
          break;
        case 'fileRelinked':
          // Snippet targets are re-found in the new file by their anchor line once it loads.
          updateNodes((ns) =>
            ns.map((n) => ((isFile(n) || isEditor(n)) && n.data.file === m.file ? ({ ...n, data: { ...n.data, file: m.newFile } } as RFNode) : n)),
          );
          break;
        case 'folderState':
          folderStore.set(m.folder, m.missing);
          break;
        case 'folderRelinked':
          // The host checks the new folder once the layout it is saved in reaches it.
          updateNodes((ns) => ns.map((n) => (isFolder(n) && n.data.folder === m.folder ? { ...n, data: { ...n.data, folder: m.newFolder } } : n)));
          break;
        case 'restoreFocus':
          // Only give the caret back if it was in an editor; selecting a node alone must not focus code.
          if (refocusEditor.current) focusLastEditor();
          break;
        case 'revealNode':
          pendingReveal.current = m.id;
          requestScrollToTarget(m.id);
          setNodes((ns) => [...ns]); // re-run the reveal effect even if nothing else changes
          break;
        default:
          if (!handleLanguageMessage(m) && !handleGitMessage(m) && !handleTextmateMessage(m)) docStore.handleHost(m);
      }
    };
  });

  useEffect(() => {
    docStore.onRangesChanged = (updates) => {
      const byId = new Map(updates.map((u) => [u.id, u]));
      setNodes((ns) =>
        ns.map((n) => {
          const u = byId.get(n.id);
          return u && isEditor(n) ? { ...n, data: { ...n.data, target: u.range, anchor: u.anchor } } : n;
        }),
      );
      commit();
    };
    registerLanguageBridge();
    registerGitGutter();
    const off = onHostMessage((m) => hostHandler.current(m));
    host.postMessage({ type: 'ready' });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reveal a node once it exists and has been measured.
  useEffect(() => {
    const id = pendingReveal.current;
    if (!id) return;
    const node = nodes.find((n) => n.id === id);
    if (!node?.measured) return;
    pendingReveal.current = null;
    const shown = visibleNodeId(nodes, id);
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === shown) ? n : { ...n, selected: n.id === shown })));
    rf.fitView({ nodes: [{ id: shown }], padding: clearOfToolbar(0.3), maxZoom: Math.max(rf.getZoom(), 0.8), duration: 300 });
  }, [nodes, rf, setNodes]);

  // Theme colors feed the title bar text tone (tone.ts); a new `actions` re-renders every paper with them.
  useEffect(
    () =>
      watchHostTheme(() => {
        resetThemeColors();
        setThemeTick((t) => t + 1);
      }),
    [],
  );

  // The canvas background is a user setting; dots and floating text switch tone so they stay readable on it.
  useEffect(() => {
    const light = isLightColor(config.canvasBackground);
    const root = document.documentElement.style;
    root.setProperty('--pw-canvas-bg', config.canvasBackground);
    root.setProperty('--pw-dot', light ? 'rgba(0, 0, 0, 0.28)' : 'rgba(255, 255, 255, 0.22)');
    root.setProperty('--pw-canvas-fg', light ? '#1f2328' : '#f0f0f0');
  }, [config.canvasBackground]);

  // ---- keyboard ----------------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
        // Capture before VS Code's webview handler so one save covers the layout and every file shown.
        e.preventDefault();
        e.stopPropagation();
        host.postMessage({ type: 'save' });
        return;
      }
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'h' || e.key === 'H') setTool('hand');
      else if (e.key === 'v' || e.key === 'V') setTool('select');
      else if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) rf.fitView({ padding: clearOfToolbar(0.15), duration: 250, maxZoom: 1 });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [rf]);

  // ---- node changes ------------------------------------------------------------------------------

  const onNodesChange = useCallback(
    (changes: NodeChange<RFNode>[]) => {
      let persist = false;
      let removed = false;
      const dropped = new Set<string>();
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false) {
          persist = true;
          dropped.add(c.id);
        }
        if (c.type === 'dimensions' && c.resizing === false) persist = true;
        if (c.type === 'dimensions' && c.resizing !== undefined) setResizingId(c.resizing ? c.id : null);
        if (c.type === 'remove') removed = true;
      }
      if (removed) {
        for (const c of changes) if (c.type === 'remove') docStore.untrack(c.id);
        onNodesChangeBase(changes);
        updateNodes(pruneNodes);
        return;
      }
      onNodesChangeBase(changes);
      // Dropped boxes join the group under them (or leave theirs) before groups are re-fit; editors stay in their file.
      // Re-fit embedded editors: resizing a combined node from the top/left also shifts its hidden child.
      if (persist) updateNodes((ns) => dropNodes(ns, new Set(ns.filter((n) => dropped.has(n.id) && isBox(n)).map((n) => n.id))));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, onNodesChangeBase, updateNodes],
  );

  // ---- links -------------------------------------------------------------------------------------

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RFEdge>[]) => {
      onEdgesChangeBase(changes);
      if (changes.some((c) => c.type === 'remove')) commit();
    },
    [commit, onEdgesChangeBase],
  );

  /** Add a link as the new selection (so its toolbar shows right away). */
  const addLink = useCallback(
    (c: { source: string; target: string; sourceHandle: string | null; targetHandle: string | null }) => {
      if (readOnlyRef.current || c.source === c.target) return;
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
      setEdges((es) => [
        ...es.map((e) => (e.selected ? { ...e, selected: false } : e)),
        { id: newId('l'), type: 'link', ...c, selected: true, data: {} },
      ]);
      commit();
    },
    [commit, setEdges, setNodes],
  );

  const onConnect = useCallback((c: Connection) => addLink(c), [addLink]);
  /** Set while an existing link's end is dragged: React Flow then reports the drop to onConnectEnd too. */
  const reconnecting = useRef(false);

  // Dropping a new link on a node's body (not on a handle) attaches it to the side facing the pointer.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (reconnecting.current || state.isValid || !state.fromNode || !state.fromHandle) return;
      const hit = nodeSideAt(rf, event, state.fromNode.id);
      if (hit) addLink({ source: state.fromNode.id, sourceHandle: state.fromHandle.id ?? null, target: hit.id, targetHandle: hit.side });
    },
    [addLink, rf],
  );

  const moveLinkEnd = useCallback(
    (id: string, end: 'source' | 'target', node: string, side: string | null) => {
      setEdges((es) =>
        es.map((e) => {
          if (e.id !== id) return e;
          const moved = end === 'source' ? { ...e, source: node, sourceHandle: side } : { ...e, target: node, targetHandle: side };
          return moved.source === moved.target ? e : moved;
        }),
      );
      commit();
    },
    [commit, setEdges],
  );

  const onReconnect = useCallback(
    (old: RFEdge, c: Connection) => {
      moveLinkEnd(old.id, 'source', c.source, c.sourceHandle ?? null);
      moveLinkEnd(old.id, 'target', c.target, c.targetHandle ?? null);
    },
    [moveLinkEnd],
  );

  // A dragged link end dropped on a node's body; `fixed` is the type of the end that stayed put.
  const onReconnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, edge: RFEdge, fixed: 'source' | 'target', state: FinalConnectionState) => {
      setTimeout(() => (reconnecting.current = false)); // after onConnectEnd, whichever order they come in
      if (state.isValid) return;
      const moved = fixed === 'source' ? 'target' : 'source';
      const hit = nodeSideAt(rf, event, fixed === 'source' ? edge.source : edge.target);
      if (hit) moveLinkEnd(edge.id, moved, hit.id, hit.side);
    },
    [moveLinkEnd, rf],
  );

  const connecting = useStore((s) => s.connection.inProgress);

  // Mirror VS Code's explorer.autoReveal: the focused node's file gets selected in the Explorer.
  // Selection-change events repeat for the same node, so only report changes (focus always reports).
  const lastFocused = useRef<string | null>(null);
  /** Whether the Explorer reveal interrupted typing in an editor, so `restoreFocus` should put the caret back. */
  const refocusEditor = useRef(false);
  const revealInExplorer = useCallback((id: string, force = false) => {
    if (!force && lastFocused.current === id) return;
    lastFocused.current = id;
    refocusEditor.current = editorHasFocus();
    const node = nodesRef.current.find((n) => n.id === id);
    if (node && (isFile(node) || isEditor(node))) host.postMessage({ type: 'nodeFocused', file: node.data.file });
    else if (node && isFolder(node)) host.postMessage({ type: 'nodeFocused', file: node.data.folder });
  }, []);

  const actions = useMemo<WorkspaceActions | null>(() => {
    if (!settings) return null;
    /** Whether node `id` may change (it is not locked, nor inside something locked); every edit checks it. */
    const editable = (id: string) => !isLockedIn(nodesRef.current, id);
    return {
      settings,
      config,
      focusEditor: (id) => {
        // Clicking into code (a nodrag area) doesn't select the node by itself; make it the selection.
        const shown = visibleNodeId(nodesRef.current, id);
        setNodes((ns) => ns.map((n) => (n.selected === (n.id === shown) ? n : { ...n, selected: n.id === shown })));
        revealInExplorer(id, true);
      },
      setTarget: (id: string, target: LineRange | undefined) => {
        if (!editable(id)) return;
        const model = (() => {
          const node = nodesRef.current.find((n) => n.id === id);
          return node && isEditor(node) ? docStore.get(node.data.file)?.model : undefined;
        })();
        const anchor = target && model ? model.getLineContent(target.start).trim() : undefined;
        updateNodes((ns) => ns.map((n) => (n.id === id && isEditor(n) ? { ...n, data: { ...n.data, target, anchor } } : n)));
      },
      addEditor: (fileNodeId: string) => {
        if (!editable(fileNodeId)) return;
        const lineHeight = settingsRef.current?.lineHeight ?? 19;
        updateNodes((ns) => {
          const file = ns.find((n) => n.id === fileNodeId);
          if (!file || !isFile(file)) return ns;
          const children = ns.filter((n): n is RFEditorNode => isEditor(n) && n.parentId === fileNodeId);
          // Seed the new snippet with the selection of the file's focused editor, if any.
          const focused = lastFocusedEditorId();
          const target = focused && children.some((c) => c.id === focused) ? selectedLines(focused) : undefined;
          const asWorkspace = children.map<WorkspaceEditorNode>((c) => ({
            id: c.id,
            type: 'editor',
            parent: fileNodeId,
            position: c.position,
            width: c.width ?? DEFAULT_EDITOR_WIDTH,
            height: c.height ?? DEFAULT_EDITOR_HEIGHT,
            annotation: c.data.annotation,
          }));
          const width = asWorkspace.length ? Math.max(...asWorkspace.map((e) => e.width)) : DEFAULT_EDITOR_WIDTH;
          const height = editorHeightFor(target, lineHeight);
          const editor: RFEditorNode = {
            id: newId('e'),
            type: 'editor',
            parentId: fileNodeId,
            expandParent: true,
            position: nextEditorSlot(asWorkspace),
            width,
            height,
            measured: { width, height },
            dragHandle: EDITOR_DRAG_HANDLE,
            selected: true,
            data: {
              file: file.data.file,
              target,
              anchor: target ? docStore.get(file.data.file)?.model?.getLineContent(target.start).trim() : undefined,
              showTitle: configRef.current.showEditorTitleByDefault,
            },
          };
          pendingReveal.current = editor.id;
          // normalizeLayout turns a combined node into a group (the embedded editor keeps its size) and grows the file.
          return [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), editor];
        });
      },
      remove: (id) => {
        if (nodesRef.current.find((n) => n.id === id)?.deletable === false) return;
        docStore.untrack(id);
        updateNodes((ns) => pruneNodes(ns.filter((n) => n.id !== id)));
      },
      updateData: (id, patch) =>
        editable(id) &&
        updateNodes((ns) => ns.map((n) => (n.id === id && !isFile(n) && !isEditor(n) ? ({ ...n, data: { ...n.data, ...patch } } as RFNode) : n))),
      setAnnotation: (id, annotation) =>
        editable(id) &&
        updateNodes((ns) => {
          const node = ns.find((n) => n.id === id);
          if (!node || node.type === 'text' || node.type === 'note') return ns;
          const next = ns.map((n) => (n === node ? ({ ...n, data: { ...n.data, annotation } } as RFNode) : n));
          return isEditor(node) && node.data.annotation === undefined && annotation !== undefined ? makeRoomBelow(next, node) : next;
        }),
      setBodyColor: (id, color) =>
        editable(id) &&
        updateNodes((ns) => ns.map((n) => (n.id === id && (isFile(n) || isFolder(n)) ? ({ ...n, data: { ...n.data, color } } as RFNode) : n))),
      updateTitle: (id, patch) =>
        editable(id) &&
        updateNodes((ns) => ns.map((n) => (n.id === id && isTitled(n) ?({ ...n, data: { ...n.data, ...patch } } as RFNode) : n))),
      tags,
      tagPlacement,
      showTags,
      customColors,
      addCustomColor: (color) => {
        const saved = optionsRef.current.customColors;
        if (!/^#[0-9a-f]{6}$/.test(color) || saved.includes(color) || COLOR_GRID.some((row) => row.includes(color))) return;
        setWorkspaceOptions({ customColors: [...saved, color].slice(-CUSTOM_COLORS_MAX) });
        commit();
      },
      setNodeTags: (id, tagIds, created) => {
        if (!editable(id)) return;
        if (created?.length) setTags([...optionsRef.current.tags, ...created]);
        const next = tagIds.length ? [...new Set(tagIds)] : undefined;
        updateNodes((ns) => ns.map((n) => (n.id === id && isTitled(n) ? ({ ...n, data: { ...n.data, tags: next } } as RFNode) : n)));
      },
      openTagPicker: (id) => setTagDialog({ kind: 'picker', id }),
      updateLink: (id, patch) => {
        setEdges((es) => es.map((e) => (e.id === id ? { ...e, data: { ...e.data, ...patch } } : e)));
        commit();
      },
      reverseLink: (id) => {
        setEdges((es) =>
          es.map((e) => (e.id === id ? { ...e, source: e.target, target: e.source, sourceHandle: e.targetHandle, targetHandle: e.sourceHandle } : e)),
        );
        commit();
      },
      removeLink: (id) => {
        setEdges((es) => es.filter((e) => e.id !== id));
        commit();
      },
      setHeight: (id, height) =>
        updateNodes((ns) => {
          const n = ns.find((x) => x.id === id);
          if (!n || n.height === height) return ns;
          return ns.map((x) => (x === n ? { ...x, height, measured: { width: x.width ?? x.measured?.width, height } } : x));
        }),
      setLocked: (id, locked) =>
        updateNodes((ns) => ns.map((n) => (n.id === id && isLockableType(n.type) ? ({ ...n, data: { ...n.data, locked: locked || undefined } } as RFNode) : n))),
      ungroup: (id) =>
        editable(id) &&
        updateNodes((ns) => {
          const group = ns.find((n) => n.id === id);
          if (!group || !isGroup(group)) return ns;
          // The content stays where it is on screen and becomes the selection.
          const kids = ns.filter((n) => n.parentId === id).map((n) => n.id);
          let out = ns.map((n) => (kids.includes(n.id) !== !!n.selected ? { ...n, selected: kids.includes(n.id) } : n));
          for (const kid of kids) out = reparent(out, kid, group.parentId);
          return out.filter((n) => n.id !== id);
        }),
      mediaUrl: (src) => {
        if (/^(data|blob|https?):/i.test(src)) return src;
        if (isAbsoluteWorkspacePath(src) || !mediaRootRef.current) return '';
        return `${mediaRootRef.current.replace(/\/$/, '')}/${src.split('/').map(encodeURIComponent).join('/')}`;
      },
      openNodeMenu: (id, x, y, items) => {
        setPaneMenu(null);
        setNodeMenu({ id, at: { x, y }, items });
      },
      nodeMenuItems: (id) => nodeMenuItemsRef.current(id),
      // fitView's numeric padding shrinks the fitted size to 1 / (1 + padding), so 100 / percent - 1 fills `percent`.
      focusNode: (id) =>
        rf.fitView({ nodes: [{ id: visibleNodeId(nodesRef.current, id) }], padding: clearOfToolbar(100 / config.focusPercent - 1), duration: 300 }),
      openInEditor: (file, line) => host.postMessage({ type: 'openInEditor', file, line }),
      goToDefinition: (file, line, column) => host.postMessage({ type: 'goToDefinition', file, line, column }),
      relinkFile: (file) => host.postMessage({ type: 'relinkFile', file }),
      relinkFolder: (folder) => host.postMessage({ type: 'relinkFolder', folder }),
      revealInExplorer: (path) => host.postMessage({ type: 'revealInExplorer', path }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, config, tags, tagPlacement, showTags, customColors, themeTick, rf, setNodes, setEdges, setTags, commit, updateNodes, revealInExplorer]);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const restackNode = useCallback(
    (id: string, op: StackOp) => {
      setNodeMenu(null);
      if (!isLockedIn(nodesRef.current, id)) updateNodes((ns) => restack(ns, stackGroup, id, op));
    },
    [updateNodes],
  );
  const closeNodeMenu = useCallback(() => setNodeMenu(null), []);
  const closePaneMenu = useCallback(() => setPaneMenu(null), []);

  // ---- board nodes (groups, text, notes, media) ----------------------------------------------------

  /** Last pointer position over the canvas (client coordinates), where pasted media goes. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const dropPoint = () => {
    const p = pointer.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return rf.screenToFlowPosition(p);
  };
  const viewCenter = () => rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  /** Add a top-level node centered on `center`, selected (and alone in the selection). */
  const addBox = useCallback(
    (node: RFNode, center: { x: number; y: number }) => {
      const { width, height } = sizeOf(node);
      const placed = { ...node, position: { x: center.x - width / 2, y: center.y - height / 2 }, measured: { width, height }, selected: true } as RFNode;
      updateNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), placed]);
    },
    [updateNodes],
  );

  /** Wrap the selection in a new group (in the selection's common group, if any), or add an empty group. */
  const groupSelection = useCallback(() => {
    const id = newId('g');
    editWhenMounted(id);
    const roots = selectionRoots(nodesRef.current);
    if (!roots.length) {
      addBox({ id, type: 'group', ...DEFAULT_GROUP_SIZE, position: { x: 0, y: 0 }, data: { title: '' }, ...boxProps('group') } as RFGroupNode, viewCenter());
      return;
    }
    // Wrapping would take the selection out of (or put a new group into) a locked group, folder or file.
    if (roots.some((r) => r.parentId !== undefined && isLockedIn(nodesRef.current, r.parentId))) return;
    updateNodes((ns) => {
      const boxes = roots.map((r) => ns.find((n) => n.id === r.id)!).filter(Boolean);
      const parents = new Set(boxes.map((b) => b.parentId));
      const parentId = parents.size === 1 ? boxes[0].parentId : undefined;
      const rects = boxes.map((b) => ({ ...absolutePos(ns, b.id), ...sizeOf(b) }));
      const minX = Math.min(...rects.map((r) => r.x));
      const minY = Math.min(...rects.map((r) => r.y));
      const maxX = Math.max(...rects.map((r) => r.x + r.width));
      const maxY = Math.max(...rects.map((r) => r.y + r.height));
      const base = parentId !== undefined ? absolutePos(ns, parentId) : { x: 0, y: 0 };
      const width = maxX - minX + GROUP_PADDING * 2;
      const height = maxY - minY + GROUP_HEADER_HEIGHT + GROUP_PADDING;
      const group: RFGroupNode = {
        id,
        type: 'group',
        ...(parentId !== undefined ? { parentId } : {}),
        position: { x: minX - GROUP_PADDING - base.x, y: minY - GROUP_HEADER_HEIGHT - base.y },
        width,
        height,
        measured: { width, height },
        selected: true,
        data: { title: '' },
        ...boxProps('group'),
      };
      // The group takes the stacking slot of the lowest selected box; the boxes keep their relative order.
      const first = Math.min(...boxes.map((b) => ns.indexOf(b)));
      let out: RFNode[] = [...ns.slice(0, first), group, ...ns.slice(first)].map((n) => (n.selected && n.id !== id ? { ...n, selected: false } : n));
      for (const b of boxes.sort((a, c) => ns.indexOf(a) - ns.indexOf(c))) out = reparent(out, b.id, id);
      return out;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addBox, updateNodes]);

  /** Add media nodes for stored media (workspace paths), side by side around `position`. */
  const addMedia = useCallback(
    async (srcs: string[], position: { x: number; y: number }) => {
      const nodes = await Promise.all(
        srcs.map(async (src) => {
          const url = actionsRef.current?.mediaUrl(src) ?? '';
          const video = isVideoPath(src) || src.startsWith('data:video/');
          return { src, ...mediaSizeFor(url ? await loadMediaSize(url, video) : { width: 0, height: 0 }) };
        }),
      );
      const total = nodes.reduce((w, n) => w + n.width, 0) + 24 * (nodes.length - 1);
      let x = position.x - total / 2;
      const created: RFNode[] = nodes.map((n) => {
        const node: RFNode = {
          id: newId('m'),
          type: 'media',
          position: { x, y: position.y - n.height / 2 },
          width: n.width,
          height: n.height,
          measured: { width: n.width, height: n.height },
          selected: true,
          data: { src: n.src },
        };
        x += n.width + 24;
        return node;
      });
      updateNodes((ns) => [...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), ...created]);
    },
    [updateNodes],
  );

  const createNode = useCallback(
    (kind: CreateKind) => {
      if (kind === 'group') return groupSelection();
      if (kind === 'media') return host.postMessage({ type: 'pickMedia', position: viewCenter() });
      const id = newId(kind === 'text' ? 't' : 'n');
      editWhenMounted(id);
      const size = kind === 'text' ? DEFAULT_TEXT_SIZE : DEFAULT_NOTE_SIZE;
      addBox({ id, type: kind, ...size, position: { x: 0, y: 0 }, data: { text: '' } } as RFNode, viewCenter());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addBox, groupSelection],
  );

  /**
   * Add a shape from the shapes panel, centered on `at` (a drop) or on the view (a click; repeated clicks cascade
   * instead of stacking exactly). Like a dropped node, a shape whose center lands on a group goes into it.
   */
  const addShape = useCallback(
    (shape: string, at?: { x: number; y: number }) => {
      if (readOnlyRef.current) return;
      const def = shapeDef(shape);
      const { width, height } = def.size;
      const center = at ?? viewCenter();
      const id = newId('s');
      updateNodes((ns) => {
        let position = { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) };
        // Another shape centered (nearly) where this one would be.
        const taken = (p: { x: number; y: number }) =>
          ns.some((n) => {
            if (n.type !== 'shape') return false;
            const a = absolutePos(ns, n.id);
            const s = sizeOf(n);
            return Math.abs(a.x + s.width / 2 - (p.x + width / 2)) < 12 && Math.abs(a.y + s.height / 2 - (p.y + height / 2)) < 12;
          });
        for (let i = 0; !at && i < 50 && taken(position); i++) position = { x: position.x + 24, y: position.y + 24 };
        const node: RFShapeNode = { id, type: 'shape', position, width, height, measured: { width, height }, selected: true, data: { shape: def.id, text: '' } };
        return dropNodes([...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), node], new Set([id]));
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateNodes],
  );

  // ---- copy & paste of board nodes (files, snippets and folders are not copied: each appears once per canvas) ----

  /**
   * Copied nodes (a `copyTrees` snapshot) and the links between them. `marker` is what we put on the system
   * clipboard, so a paste only uses these nodes while nothing else has been copied since (unset if the clipboard
   * was not writable).
   */
  const clip = useRef<{ nodes: RFNode[]; links: RFEdge[]; marker?: string; pastes: number; at?: { x: number; y: number } } | null>(null);
  // Folders neither: a copy would show the same folder (and its files) twice.
  const copyable = (n: RFNode) => !isTitled(n);

  /** Snapshot of the selected board nodes (or of `id`), with what is inside them and their links; null if there are none. */
  const snapshotSelection = (id?: string) => {
    const ns = nodesRef.current;
    const roots = (id ? ns.filter((n) => n.id === id) : selectionRoots(ns)).filter(copyable);
    if (!roots.length) return null;
    const nodes = copyTrees(ns, roots.map((r) => r.id), copyable);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, links: edgesRef.current.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  };

  /** Add copies of a snapshot moved by `offset` as the new selection; a copy landing on a group goes into it. */
  const insertCopies = useCallback(
    (snapshot: { nodes: RFNode[]; links: RFEdge[] }, offset: { x: number; y: number }) => {
      // Copies start unlocked (a locked group's copy can be arranged right away).
      const copies = cloneTrees(snapshot.nodes, offset, (n) => newId(n.id.split('_')[0] || 'n')).map((n) => {
        const copy = { ...n, selected: n.parentId === undefined } as RFNode;
        delete copy.draggable;
        delete copy.deletable;
        delete copy.className;
        return (copy.data as { locked?: boolean }).locked ? ({ ...copy, data: { ...copy.data, locked: undefined } } as RFNode) : copy;
      });
      const roots = new Set(copies.filter((n) => n.parentId === undefined).map((n) => n.id));
      const copyOf = new Map(snapshot.nodes.map((n, i) => [n.id, copies[i].id])); // cloneTrees keeps the order
      const links = snapshot.links.map((e) => ({ ...e, id: newId('l'), source: copyOf.get(e.source)!, target: copyOf.get(e.target)!, selected: false }));
      updateNodes((ns) => dropNodes([...ns.map((n) => (n.selected ? { ...n, selected: false } : n)), ...copies], roots));
      if (links.length) setEdges((es) => [...es.map((e) => (e.selected ? { ...e, selected: false } : e)), ...links]);
    },
    [setEdges, updateNodes],
  );

  /** Copy (or cut) the selected board nodes; false if there were none, so the key keeps its usual meaning. */
  const copySelection = useCallback(
    (cut: boolean) => {
      const snapshot = snapshotSelection();
      if (!snapshot) return false;
      const entry: NonNullable<typeof clip.current> = { ...snapshot, pastes: 0 };
      clip.current = entry;
      const marker = `paper-workspace-nodes:${newId('c')}`;
      navigator.clipboard?.writeText(marker).then(
        () => (entry.marker = marker),
        () => {},
      );
      if (cut && !readOnlyRef.current) {
        const ids = new Set(snapshot.nodes.filter((n) => n.parentId === undefined && nodesRef.current.find((x) => x.id === n.id)?.deletable !== false).map((n) => n.id));
        updateNodes((ns) => pruneNodes(ns.filter((n) => !ids.has(n.id))));
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [updateNodes],
  );

  /**
   * Paste the copied nodes centered on the pointer (or, without one, next to the originals). Pasting again at
   * the same spot cascades instead of stacking exactly.
   */
  const pasteNodes = useCallback(() => {
    const c = clip.current;
    if (!c || readOnlyRef.current) return;
    const roots = c.nodes.filter((n) => n.parentId === undefined);
    const minX = Math.min(...roots.map((n) => n.position.x));
    const minY = Math.min(...roots.map((n) => n.position.y));
    const maxX = Math.max(...roots.map((n) => n.position.x + sizeOf(n).width));
    const maxY = Math.max(...roots.map((n) => n.position.y + sizeOf(n).height));
    const at = pointer.current ? dropPoint() : undefined;
    const same = !!at && !!c.at && Math.abs(at.x - c.at.x) < 1 && Math.abs(at.y - c.at.y) < 1;
    c.pastes = !at || same ? c.pastes + 1 : 0;
    c.at = at;
    const step = 24 * c.pastes;
    const offset = at
      ? { x: Math.round(at.x - (minX + maxX) / 2) + step, y: Math.round(at.y - (minY + maxY) / 2) + step }
      : { x: step, y: step };
    insertCopies(c, offset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertCopies]);

  /** Duplicate the selection (or node `id`) next to itself; the clipboard is left alone. */
  const duplicateSelection = useCallback(
    (id?: string) => {
      const snapshot = snapshotSelection(id);
      if (snapshot && !readOnlyRef.current) insertCopies(snapshot, { x: 24, y: 24 });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insertCopies],
  );

  /** See WorkspaceActions.nodeMenuItems; read at open time so the stacking entries match the canvas. */
  const nodeMenuItems = (id: string): MenuEntries => {
    const ns = nodesRef.current;
    const node = ns.find((n) => n.id === id);
    const { isFront, isBack } = stackPosition(ns, stackGroup, id);
    const locked = isLockedIn(ns, id);
    const own = !!(node?.data as { locked?: boolean } | undefined)?.locked;
    // Unlock where the lock is; a node locked with its container says so instead.
    const lockItem: HeaderMenuItem | false = own
      ? { icon: 'unlock', label: 'Unlock', onClick: () => actionsRef.current?.setLocked(id, false) }
      : locked
        ? { icon: 'lock', label: `Locked with its ${lockOwnerKind(ns, id)}`, disabled: true, onClick: () => {} }
        : !!node && isLockableType(node.type) && { icon: 'lock', label: 'Lock (protect from changes)', onClick: () => actionsRef.current?.setLocked(id, true) };
    return [
      lockItem,
      'separator',
      { icon: 'screen-full', label: 'Focus on this paper', onClick: () => actionsRef.current?.focusNode(id) },
      // For pasting into an AI chat: the host copies `paperworkspace:<workspace>#<type>/<id>` (see shared/reference).
      node?.type && { icon: 'references', label: 'Copy reference', onClick: () => host.postMessage({ type: 'copyReference', node: { type: node.type, id } }) },
      'separator',
      ...MENU_ITEMS.map(({ op, label, icon }) => ({
        icon,
        label,
        disabled: locked || (op === 'front' || op === 'forward' ? isFront : isBack),
        onClick: () => restackNode(id, op),
      })),
      'separator',
      node && copyable(node) && { icon: 'copy', label: 'Duplicate', onClick: () => duplicateSelection(id) },
      node && isGroup(node) && { icon: 'ungroup-by-ref-type', label: 'Ungroup', disabled: locked, onClick: () => actionsRef.current?.ungroup(id) },
      { icon: 'trash', label: 'Delete', danger: true, disabled: node?.deletable === false, onClick: () => actionsRef.current?.remove(id) },
    ];
  };
  const nodeMenuItemsRef = useRef(nodeMenuItems);
  nodeMenuItemsRef.current = nodeMenuItems;

  /**
   * Right-click on the empty canvas: show or hide the title of every file or every editor at once. It sets each paper's
   * own visibility (not a view filter), so single papers can be changed afterwards. Entries that change nothing are disabled.
   */
  const paneMenuItems = (): MenuEntries => {
    const entry = (kind: 'file' | 'editor' | 'folder', show: boolean): HeaderMenuItem => {
      const fallback = kind === 'file' ? DEFAULT_FILE_SHOW_TITLE : kind === 'folder' ? DEFAULT_FOLDER_SHOW_TITLE : DEFAULT_EDITOR_SHOW_TITLE;
      // Locked papers keep their title as it is.
      const changes = (n: RFNode): n is RFFileNode | RFEditorNode | RFFolderNode =>
        isTitled(n) && n.type === kind && (n.data.showTitle ?? fallback) !== show && !isLockedIn(nodesRef.current, n.id);
      return {
        icon: show ? 'eye' : 'eye-closed',
        label: `${show ? 'Show' : 'Hide'} ${kind} titles`,
        disabled: !nodesRef.current.some(changes),
        onClick: () => updateNodes((ns) => ns.map((n) => (changes(n) ? ({ ...n, data: { ...n.data, showTitle: show } } as RFNode) : n))),
      };
    };
    const { showTags } = optionsRef.current;
    // Only a view switch: papers keep their tags while they are hidden.
    const tagsEntry: HeaderMenuItem = {
      icon: showTags ? 'eye-closed' : 'eye',
      label: showTags ? 'Hide tags' : 'Show tags',
      disabled: !nodesRef.current.some((n) => isTitled(n) && n.data.tags?.length),
      onClick: () => {
        setWorkspaceOptions({ showTags: !showTags });
        commit();
      },
    };
    // Folder entries only once there are folders, so the menu stays short without them.
    const folders = nodesRef.current.some(isFolder);
    return [
      entry('file', true),
      entry('editor', true),
      folders && entry('folder', true),
      'separator',
      entry('file', false),
      entry('editor', false),
      folders && entry('folder', false),
      'separator',
      tagsEntry,
      'separator',
      { icon: 'references', label: 'Copy workspace reference', onClick: () => host.postMessage({ type: 'copyReference' }) },
    ];
  };

  /** Send pasted or dropped image/video files to the host, which stores them and answers with `mediaAdded`. */
  const saveMediaFiles = useCallback(async (files: File[], position: { x: number; y: number }) => {
    for (const f of files) {
      try {
        host.postMessage({ type: 'saveMedia', name: mediaFileName(f), mime: f.type, data: await readAsBase64(f), position });
      } catch (e) {
        console.warn('[workspace-workspace] could not read media', e);
      }
    }
  }, []);

  // Paste images/videos from the clipboard onto the canvas (not while typing in an editor or a text node).
  useEffect(() => {
    let pasteSeen = false;
    const onPaste = (e: ClipboardEvent) => {
      pasteSeen = true;
      if (isEditableTarget(e.target) || readOnlyRef.current) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => MEDIA_MIME.test(f.type));
      if (files.length) {
        e.preventDefault();
        void saveMediaFiles(files, dropPoint());
      } else if (clip.current && (!clip.current.marker || e.clipboardData?.getData('text/plain') === clip.current.marker)) {
        e.preventDefault();
        pasteNodes();
      }
    };
    // Some hosts never deliver a paste event to a webview without a focused text field; read the clipboard then.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v' || e.altKey || isEditableTarget(e.target)) return;
      pasteSeen = false;
      setTimeout(async () => {
        if (pasteSeen || readOnlyRef.current) return;
        if (!navigator.clipboard?.read) return pasteNodes();
        try {
          const files: File[] = [];
          for (const item of await navigator.clipboard.read()) {
            const type = item.types.find((t) => MEDIA_MIME.test(t));
            if (type) files.push(new File([await item.getType(type)], '', { type }));
          }
          if (files.length) return void saveMediaFiles(files, dropPoint());
          const marker = clip.current?.marker;
          if (marker && (await navigator.clipboard.readText().catch(() => marker)) !== marker) return;
          pasteNodes();
        } catch {
          pasteNodes(); // clipboard not readable here: copied nodes, if any
        }
      }, 200);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveMediaFiles, pasteNodes]);

  // ---- dragging into and out of groups -------------------------------------------------------------

  const [dropTarget, setDropTarget] = useState<string | undefined>();
  /** Dragged boxes that move on their own (not carried by a dragged parent); editors stay in their file. */
  const draggedRoots = (dragged: RFNode[]) => {
    const ids = new Set(dragged.map((n) => n.id));
    return dragged.filter((n) => isBox(n) && !(n.parentId !== undefined && ids.has(n.parentId)));
  };
  const onNodeDrag = useCallback((_: unknown, node: RFNode, dragged: RFNode[]) => {
    const roots = draggedRoots(dragged);
    const lead = roots.find((n) => n.id === node.id) ?? roots[0];
    const target = lead ? dropTargetFor(nodesRef.current, lead.id, new Set(roots.map((n) => n.id))) : undefined;
    setDropTarget((t) => (t === target ? t : target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The drop itself (reparenting) happens with the drag's final position change in onNodesChange.
  const onNodeDragStop = useCallback(() => setDropTarget(undefined), []);
  // T = text, N = note, S = shapes panel, Ctrl/Cmd+G = group the selection, Ctrl/Cmd+Shift+G = ungroup the selected groups,
  // Ctrl/Cmd+C / X copy / cut the selected board nodes, Ctrl/Cmd+D duplicates them (Ctrl/Cmd+V is handled with media paste).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target) || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && (key === 'c' || key === 'x')) {
        if (copySelection(key === 'x')) e.preventDefault();
        return;
      }
      if (readOnlyRef.current) return;
      if (mod && !e.shiftKey && key === 'd') {
        // Capture it before VS Code's webview handler runs its own Ctrl+D binding.
        e.preventDefault();
        e.stopPropagation();
        duplicateSelection();
      } else if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) nodesRef.current.filter((n) => n.selected && isGroup(n)).forEach((g) => actionsRef.current?.ungroup(g.id));
        else createNode('group');
      } else if (!mod && !e.shiftKey && (key === 't' || key === 'n')) {
        e.preventDefault();
        createNode(key === 't' ? 'text' : 'note');
      } else if (!mod && !e.shiftKey && key === 's') {
        e.preventDefault();
        togglePanel('shapes');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [createNode, togglePanel, copySelection, duplicateSelection]);

  const shownNodes = useMemo(
    () => nodes.map((n) => withHandles(n.id === dropTarget ? { ...n, className: `${n.className ?? ''} pw-drop-target` } : n)),
    [nodes, dropTarget],
  );
  const shownEdges = useMemo(() => shownLinks(nodes, edges), [nodes, edges]);

  // Optimistic; the host echoes the stored settings back. Batched, so dragging in a color picker doesn't write
  // the settings file on every mouse move.
  const changeConfig = useCallback((patch: Partial<CanvasConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    const pending = pendingConfig.current;
    if (pending) window.clearTimeout(pending.timer);
    const merged = { ...pending?.patch, ...patch };
    pendingConfig.current = {
      patch: merged,
      timer: window.setTimeout(() => {
        pendingConfig.current = null;
        host.postMessage({ type: 'setConfig', config: merged });
      }, 200),
    };
  }, []);

  // ---- tags --------------------------------------------------------------------------------------

  /** Replace the workspace's tags and their placement (tag manager); deleted tags come off every paper. */
  const replaceTags = useCallback(
    (next: WorkspaceTag[], placement: TagPlacement) => {
      const kept = new Set(next.map((t) => t.id));
      setWorkspaceOptions({ tags: next, tagPlacement: placement });
      updateNodes((ns) =>
        ns.map((n) => {
          if (!isTitled(n) || !n.data.tags?.some((t) => !kept.has(t))) return n;
          const left = n.data.tags.filter((t) => kept.has(t));
          return { ...n, data: { ...n.data, tags: left.length ? left : undefined } } as RFNode;
        }),
      );
    },
    [setWorkspaceOptions, updateNodes],
  );

  /** How many papers carry each tag. */
  const tagUsage = () => {
    const usage = new Map<string, number>();
    for (const n of nodesRef.current) if (isTitled(n)) for (const t of n.data.tags ?? []) usage.set(t, (usage.get(t) ?? 0) + 1);
    return usage;
  };
  const taggedNode = tagDialog?.kind === 'picker' ? nodes.find((n): n is RFFileNode | RFEditorNode | RFFolderNode => n.id === tagDialog.id && isTitled(n)) : undefined;

  // ---- viewport ----------------------------------------------------------------------------------

  const toggleMinimap = useCallback(() => {
    const next = !minimap;
    setMinimap(next);
    host.setState<PersistedState>({ ...host.getState<PersistedState>(), minimap: next });
  }, [minimap]);

  const reportViewport = useCallback(
    (vp: Viewport) => {
      host.setState<PersistedState>({ ...host.getState<PersistedState>(), viewport: vp });
      const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      host.postMessage({ type: 'viewport', center, zoom: vp.zoom });
    },
    [rf],
  );

  // ---- snapshots ---------------------------------------------------------------------------------

  const takeSnapshot = useCallback(
    async (scope: SnapshotScope) => {
      setSnapshotNote(null);
      setSnapshot(scope);
      if (scope === 'workspace') setRenderAll(true);
      try {
        // Let the menu close and, for the whole workspace, offscreen papers mount and lay out their editors.
        await settle(scope === 'workspace' ? 800 : 50);
        const background = configRef.current.canvasBackground;
        let data: string;
        if (scope === 'view') data = await captureView(background);
        else {
          const shown = rf.getNodes().filter((n) => !n.hidden);
          if (!shown.length) throw new Error('the workspace is empty');
          data = await captureWorkspace(rf.getNodesBounds(shown), rf.getViewport(), background, () => setRenderAll(false));
        }
        host.postMessage({ type: 'saveSnapshot', scope, data });
        setSnapshotNote({ text: 'Snapshot ready: choose where to save it in the dialog.' });
      } catch (e) {
        setSnapshotNote({ text: `Could not take the snapshot: ${e instanceof Error ? e.message : String(e)}`, error: true });
      } finally {
        setSnapshot(null);
        setRenderAll(false);
      }
    },
    [rf],
  );

  useEffect(() => {
    if (!snapshotNote) return;
    const t = setTimeout(() => setSnapshotNote(null), snapshotNote.error ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [snapshotNote]);

  // ---- drag & drop from the Explorer (VS Code requires holding Shift) ------------------------------

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const uris = new Set<string>();
    const add = (s: string) =>
      s
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .forEach((l) => uris.add(l));
    add(e.dataTransfer.getData('application/vnd.code.uri-list'));
    add(e.dataTransfer.getData('text/uri-list'));
    try {
      const resources = JSON.parse(e.dataTransfer.getData('resourceurls') || '[]') as string[];
      resources.forEach((r) => uris.add(r));
    } catch {
      /* not a VS Code resource drag */
    }
    const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const shape = e.dataTransfer.getData(SHAPE_DRAG_TYPE);
    if (shape) return addShape(shape, position);
    if (!uris.size) {
      // Files without a path (e.g. from another app): only media can be stored.
      const files = [...e.dataTransfer.files].filter((f) => MEDIA_MIME.test(f.type) || isMediaPath(f.name));
      if (files.length) void saveMediaFiles(files, position);
      return;
    }
    host.postMessage({ type: 'dropUris', uris: [...uris], position });
  };

  if (!actions) return <div className="pw-boot">Loading Paper Workspace…</div>;

  const hand = tool === 'hand';
  return (
    <WorkspaceContext.Provider value={actions}>
      <div
        className={`pw-canvas${hand ? ' tool-hand' : ''}${connecting ? ' connecting' : ''}`}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
        onPointerLeave={() => (pointer.current = null)}
        // Right-drag pans (panOnDrag), so React Flow swallows the pane's contextmenu: a right-click that did not move
        // opens the canvas menu here instead.
        onPointerDownCapture={(e) => e.button === 2 && (rightDown.current = { x: e.clientX, y: e.clientY })}
        onContextMenu={(e) => {
          const down = rightDown.current;
          rightDown.current = null;
          if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return;
          e.preventDefault();
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
          setNodeMenu(null);
          setPaneMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <ReactFlow<RFNode, RFEdge>
          nodes={shownNodes}
          edges={shownEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          // Loose: every handle is a source and any side connects to any side of another node.
          connectionMode={ConnectionMode.Loose}
          nodesConnectable={!hand && !workspaceError}
          edgesReconnectable={!hand && !workspaceError}
          isValidConnection={(c) => c.source !== c.target}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onReconnect={onReconnect}
          onReconnectStart={() => (reconnecting.current = true)}
          onReconnectEnd={onReconnectEnd}
          connectionRadius={24}
          connectionLineStyle={{ stroke: 'var(--pw-accent)', strokeWidth: 2 }}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          defaultViewport={initialViewport}
          onMoveEnd={(_, vp) => reportViewport(vp)}
          onInit={(inst) => reportViewport(inst.getViewport())}
          onSelectionChange={({ nodes: selected }) => {
            if (selected.length === 1) revealInExplorer(selected[0].id);
            else lastFocused.current = null;
          }}
          // Offscreen editors unmount (their Monaco instance is disposed) and restore their scroll on return.
          // A workspace snapshot needs every paper in the DOM while it is drawn.
          onlyRenderVisibleElements={!renderAll}
          minZoom={ZOOM_LIMITS.min}
          maxZoom={ZOOM_LIMITS.max}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          panOnDrag={hand ? true : [1, 2]}
          selectionOnDrag={!hand}
          nodesDraggable={!hand}
          elementsSelectable={!hand}
          deleteKeyCode={tagDialog ? null : ['Delete', 'Backspace']}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          proOptions={{ hideAttribution: true }}
          colorMode={document.body.classList.contains('vscode-light') ? 'light' : 'dark'}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
          {minimap && <MiniMap pannable zoomable position="bottom-right" nodeBorderRadius={8} />}
          {resizingId && <ResizeBadge id={resizingId} />}
          <ZoomCssVar />
        </ReactFlow>
        <Toolbar
          tool={tool}
          onTool={setTool}
          onCreate={createNode}
          onHelp={() => setHelp(true)}
          shapesOpen={panel === 'shapes'}
          onShapes={() => togglePanel('shapes')}
          configOpen={panel === 'config'}
          onConfig={() => togglePanel('config')}
          onViewSource={() => host.postMessage({ type: 'viewSource' })}
          minimapOpen={minimap}
          onMinimap={toggleMinimap}
          tagsOpen={tagDialog?.kind === 'manager'}
          onTags={() => setTagDialog((d) => (d?.kind === 'manager' ? null : { kind: 'manager' }))}
          snapshotBusy={!!snapshot}
          onSnapshot={(scope) => void takeSnapshot(scope)}
        />
        {panel === 'config' && <ConfigPanel config={config} onChange={changeConfig} onClose={() => setPanel(null)} />}
        {panel === 'shapes' && <ShapesPanel onAdd={(shape) => addShape(shape)} onClose={() => setPanel(null)} />}
        {snapshot && <div className="pw-toast">Taking a snapshot…</div>}
        {!snapshot && snapshotNote && <div className={snapshotNote.error ? 'pw-banner' : 'pw-toast'}>{snapshotNote.text}</div>}
        {workspaceError && (
          <div className="pw-banner">
            This .workspace file could not be parsed, so the canvas is read-only until it is fixed: {workspaceError}
          </div>
        )}
        {!nodes.length && !workspaceError && (
          <div className="pw-empty">
            <div className="pw-empty-title">This workspace is empty</div>
            <div>
              Select code in an editor and press <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd>, right-click a file in the
              Explorer → <em>Add to Paper Workspace</em>, or hold <kbd>Shift</kbd> and drag files or folders here.
            </div>
            <div>
              Add groups, text, notes, shapes and images from the toolbar, or paste an image with <kbd>Ctrl</kbd>+<kbd>V</kbd>.
            </div>
          </div>
        )}
        {nodeMenu && (
          <MenuPopup anchor={nodeMenu.at} items={[...(nodeMenu.items ?? []), 'separator', ...nodeMenuItems(nodeMenu.id)]} onClose={closeNodeMenu} />
        )}
        {paneMenu && <MenuPopup anchor={paneMenu} items={paneMenuItems()} onClose={closePaneMenu} />}
        {help && <HelpOverlay onClose={() => setHelp(false)} />}
        {taggedNode && (
          <TagPickerDialog
            key={taggedNode.id}
            tags={tags}
            selected={taggedNode.data.tags ?? []}
            onSave={(ids, created) => {
              setTagDialog(null);
              actions.setNodeTags(taggedNode.id, ids, created);
            }}
            onClose={() => setTagDialog(null)}
          />
        )}
        {tagDialog?.kind === 'manager' && (
          <TagManagerDialog
            tags={tags}
            placement={tagPlacement}
            usage={tagUsage()}
            onSave={(next, placement) => {
              setTagDialog(null);
              replaceTags(next, placement);
            }}
            onClose={() => setTagDialog(null)}
          />
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}

const MENU_ITEMS: { op: StackOp; label: string; icon: string }[] = [
  { op: 'front', label: 'To front', icon: 'arrow-circle-up' },
  { op: 'back', label: 'To back', icon: 'arrow-circle-down' },
  { op: 'forward', label: 'In front', icon: 'arrow-up' },
  { op: 'backward', label: 'Back', icon: 'arrow-down' },
];
