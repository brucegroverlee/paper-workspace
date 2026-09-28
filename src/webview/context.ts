import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { GroupBorderStyle, GroupTitlePosition, LineRange, WorkspaceEdge } from '../shared/workspace';
import type { CanvasConfig, EditorSettings } from '../shared/protocol';
import { docStore } from './docStore';
import type { MenuEntries } from './HeaderMenu';

/** A file or editor's title label; see the workspace model. */
export type TitleData = { title?: string; showTitle?: boolean };
export type FileNodeData = { file: string; annotation?: string } & TitleData;
export type EditorNodeData = {
  /** Copied from the parent file node for convenience. */
  file: string;
  target?: LineRange;
  anchor?: string;
  annotation?: string;
} & TitleData;

export type GroupNodeData = {
  title: string;
  color?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: number;
  titlePosition?: GroupTitlePosition;
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: GroupBorderStyle;
  annotation?: string;
};
export type TextNodeData = { text: string; color?: string; textColor?: string; fontSize?: number; fontWeight?: number };
export type MediaNodeData = { src: string; annotation?: string };
export type ShapeNodeData = {
  shape: string;
  text: string;
  /** Fill; `'none'` = no fill. */
  color?: string;
  strokeColor?: string;
  textColor?: string;
  fontSize?: number;
  fontWeight?: number;
  annotation?: string;
};

export type RFFileNode = Node<FileNodeData, 'file'>;
export type RFEditorNode = Node<EditorNodeData, 'editor'>;
export type RFGroupNode = Node<GroupNodeData, 'group'>;
export type RFTextNode = Node<TextNodeData, 'text' | 'note'>;
export type RFMediaNode = Node<MediaNodeData, 'media'>;
export type RFShapeNode = Node<ShapeNodeData, 'shape'>;
export type RFNode = RFFileNode | RFEditorNode | RFGroupNode | RFTextNode | RFMediaNode | RFShapeNode;
/** Board node data that can be edited from its toolbar. */
export type BoardDataPatch = Partial<GroupNodeData & TextNodeData & ShapeNodeData>;

/** A link's look and label; its ends are the edge's `source`/`target`, its sides `sourceHandle`/`targetHandle` (null = automatic). */
export type LinkData = Omit<WorkspaceEdge, 'id' | 'source' | 'target' | 'sourceSide' | 'targetSide'>;
export type RFEdge = Edge<LinkData, 'link'>;

export interface WorkspaceActions {
  settings: EditorSettings;
  config: CanvasConfig;
  /** An editor got keyboard focus: select it and reveal its file in the Explorer. */
  focusEditor(id: string): void;
  setTarget(id: string, target: LineRange | undefined): void;
  /** Add another editor (snippet) inside a file node. */
  addEditor(fileNodeId: string): void;
  remove(id: string): void;
  /** Change a group/text/note/shape's title, text, colors or font. */
  updateData(id: string, patch: BoardDataPatch): void;
  /** Show (`''` or text) or remove (undefined) the caption below a file, snippet, group, shape or media node. */
  setAnnotation(id: string, annotation: string | undefined): void;
  /** Rename (undefined = back to the base name) or show/hide a file or editor's title label. */
  updateTitle(id: string, patch: TitleData): void;
  /** Change a link's look or label. */
  updateLink(id: string, patch: Partial<LinkData>): void;
  /** Swap a link's ends, so its arrow points the other way. */
  reverseLink(id: string): void;
  removeLink(id: string): void;
  /** Set a node's height (text nodes grow with their content). */
  setHeight(id: string, height: number): void;
  /** Move a group's children to its parent and remove the group. */
  ungroup(id: string): void;
  /** Webview URL of a media `src` (workspace path). */
  mediaUrl(src: string): string;
  /** Open a node's menu at a screen position (right-click); `items` are the node's own entries, before nodeMenuItems. */
  openNodeMenu(id: string, x: number, y: number, items?: MenuEntries): void;
  /** Entries every node menu ends with: focus, stacking order, duplicate, ungroup, delete. */
  nodeMenuItems(id: string): MenuEntries;
  /** Zoom the viewport so the node fills 80% of the window. */
  focusNode(id: string): void;
  openInEditor(file: string, line: number): void;
  /** Ctrl/Cmd+click at a 1-based position: open the definition or imported file as a paper. */
  goToDefinition(file: string, line: number, column: number): void;
  /** Pick a file to show instead of a missing one (deleted or moved). */
  relinkFile(file: string): void;
}

export const WorkspaceContext = createContext<WorkspaceActions | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('WorkspaceContext missing');
  return ctx;
}

/** Re-render when a document's content or state changes. */
export function useDoc(file: string) {
  useSyncExternalStore(docStore.subscribe, () => docStore.get(file)?.version ?? -1);
  return docStore.get(file);
}
