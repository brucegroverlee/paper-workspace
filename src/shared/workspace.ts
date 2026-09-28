// The on-disk `.workspace` format, shared by the extension host and the webview.
// Keep this module free of `vscode` and DOM imports so it can be unit tested.
//
// v2 model: a *file node* is a group (React Flow parent) for one source file. It contains one or more
// *editor nodes*: scrollable Monaco editors over the whole file, each with an optional *target*: the
// line range that editor is "about". Editors open scrolled to their target and can jump back to it.

export const WORKSPACE_VERSION = 2;
export const WORKSPACE_DIR = '.paperworkspace';
export const WORKSPACE_EXT = '.workspace';

/** 1-based, inclusive line range (matches what users see in the gutter). */
export interface LineRange {
  start: number;
  end: number;
}

export interface XY {
  x: number;
  y: number;
}

export interface FileNode {
  id: string;
  type: 'file';
  /** Id of the group node this file sits in (position is then relative to it). */
  parent?: string;
  /** Path relative to the workspace folder that owns the `.workspace` file (POSIX separators), or absolute if outside it. */
  file: string;
  /** Caption shown centered below the box; undefined = no annotation (the default), `''` = shown but still empty. */
  annotation?: string;
  /** Label above the box's top-left corner (kept readable when zoomed out); undefined = the file's base name. */
  title?: string;
  /** Whether the title label is shown; undefined = `DEFAULT_FILE_SHOW_TITLE`. */
  showTitle?: boolean;
  /** Ids of the workspace tags on this paper, in the order they were added; undefined = none. */
  tags?: string[];
  position: XY;
  width: number;
  height: number;
}

export interface EditorNode {
  id: string;
  type: 'editor';
  /** Id of the owning file node. */
  parent: string;
  /** The snippet this editor is about. Undefined = a plain view of the whole file. */
  target?: LineRange;
  /** Trimmed text of the target's first line; used to re-find it if the file changed while the canvas was closed. */
  anchor?: string;
  /**
   * Caption below the snippet (see FileNode); undefined = none. Only shown while the file has several snippets:
   * a combined (single-snippet) node shows the file's annotation instead.
   */
  annotation?: string;
  /**
   * Label above the snippet (see FileNode); undefined = the text of the target's first line (the file's base name without a
   * target or when that line is blank). Not shown while embedded in a combined node.
   */
  title?: string;
  /** Whether the title label is shown; undefined = `DEFAULT_EDITOR_SHOW_TITLE`. */
  showTitle?: boolean;
  /** Tags on this snippet (see FileNode). A combined (single-snippet) node shows the file's tags: the snippet's join them. */
  tags?: string[];
  /** Relative to the parent file node. */
  position: XY;
  width: number;
  height: number;
}

/** A titled, colored area; any other box (file, text, note, shape, media, group) can sit inside it. */
export interface GroupNode {
  id: string;
  type: 'group';
  parent?: string;
  title: string;
  /** Background color (`#rrggbb`); undefined = the theme's paper color. */
  color?: string;
  /** Title color; undefined = dark or light, whichever reads best on the background. */
  textColor?: string;
  /** Title font size; undefined = `DEFAULT_GROUP_FONT_SIZE`. */
  fontSize?: number;
  /** Title font weight; undefined = `DEFAULT_GROUP_FONT_WEIGHT`. */
  fontWeight?: number;
  /** Where the title sits; undefined = `'top-left'`. */
  titlePosition?: GroupTitlePosition;
  /** Border color; undefined = a shade of the background color. */
  strokeColor?: string;
  /** Border thickness in px; undefined = `DEFAULT_GROUP_BORDER_WIDTH`. */
  strokeWidth?: number;
  /** Border line style; undefined = `'solid'`. */
  strokeStyle?: GroupBorderStyle;
  /** Caption shown centered below the box; undefined = no annotation (the default), `''` = shown but still empty. */
  annotation?: string;
  position: XY;
  width: number;
  height: number;
}

export type GroupTitlePosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export const GROUP_TITLE_POSITIONS: readonly GroupTitlePosition[] = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
export type GroupBorderStyle = 'solid' | 'dashed' | 'dotted' | 'none';
export const GROUP_BORDER_STYLES: readonly GroupBorderStyle[] = ['solid', 'dashed', 'dotted', 'none'];
export const GROUP_BORDER_WIDTHS = [1, 1.5, 2, 3, 4, 6] as const;
export const DEFAULT_GROUP_BORDER_WIDTH = 1.5;

/** Free text without a background (`text`) or a sticky note (`note`). */
export interface TextNode {
  id: string;
  type: 'text' | 'note';
  parent?: string;
  text: string;
  /** Text color for `text`, background color for `note`. */
  color?: string;
  /** Text color of a `note`; undefined = dark or light, whichever reads best on its background. */
  textColor?: string;
  fontSize?: number;
  /** CSS font weight (100–900); undefined = regular. */
  fontWeight?: number;
  position: XY;
  width: number;
  height: number;
}

/** An image or video file. */
export interface MediaNode {
  id: string;
  type: 'media';
  parent?: string;
  /** Workspace path (like `file`), usually `.paperworkspace/media/<workspace>/<name>`. */
  src: string;
  /** Caption shown centered below the box; undefined = no annotation (the default), `''` = shown but still empty. */
  annotation?: string;
  position: XY;
  width: number;
  height: number;
}

/** A diagram shape (rectangle, ellipse, diamond, flowchart symbols…) with an optional centered label. */
export interface ShapeNode {
  id: string;
  type: 'shape';
  parent?: string;
  /** Shape kind (see the webview's shape library); unknown kinds render as a rectangle. */
  shape: string;
  text: string;
  /** Fill color; `'none'` = no fill (outline only); undefined = white. */
  color?: string;
  /** Outline color; undefined = dark grey. */
  strokeColor?: string;
  /** Label color; undefined = dark or light, whichever reads best on the fill. */
  textColor?: string;
  fontSize?: number;
  fontWeight?: number;
  /** Caption shown centered below the box; undefined = no annotation (the default), `''` = shown but still empty. */
  annotation?: string;
  position: XY;
  width: number;
  height: number;
}

/** Nodes that live on the canvas or inside a group (everything except editors, which live in file nodes). */
export type BoxNode = FileNode | GroupNode | TextNode | MediaNode | ShapeNode;
// Readers must ignore unknown kinds, so later kinds can be added without breaking older files.
export type WorkspaceNode = BoxNode | EditorNode;

/** Side of a node a link attaches to. */
export type Side = 'top' | 'right' | 'bottom' | 'left';
export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
/** How a link is drawn between its ends: a curve, a straight line, or right angles (sharp or rounded corners). */
export type EdgePath = 'curve' | 'straight' | 'step' | 'rounded';
export const EDGE_PATHS: readonly EdgePath[] = ['curve', 'straight', 'step', 'rounded'];
export type EdgeDash = 'solid' | 'dashed' | 'dotted';
export const EDGE_DASHES: readonly EdgeDash[] = ['solid', 'dashed', 'dotted'];
/** What is drawn at an end of a link. */
export type EdgeMarker = 'none' | 'arrow' | 'open-arrow' | 'circle' | 'diamond';
export const EDGE_MARKERS: readonly EdgeMarker[] = ['none', 'arrow', 'open-arrow', 'circle', 'diamond'];

/** A link between two nodes (any kind), attached to a side of each; undefined sides are picked from the layout. */
export interface WorkspaceEdge {
  id: string;
  source: string;
  target: string;
  sourceSide?: Side;
  targetSide?: Side;
  /** Undefined = `DEFAULT_EDGE_PATH`. */
  path?: EdgePath;
  /** Line color; undefined = the canvas's text color. */
  color?: string;
  /** Line thickness in px; undefined = `DEFAULT_EDGE_WIDTH`. */
  width?: number;
  dash?: EdgeDash;
  /** Undefined = no marker at the start, an arrow at the end. */
  startMarker?: EdgeMarker;
  endMarker?: EdgeMarker;
  label?: string;
  /** Label color; undefined = the line color. */
  labelColor?: string;
  /** Box behind the label; `'none'` = transparent (the line shows through); undefined = the canvas background. */
  labelBackground?: string;
  fontSize?: number;
  fontWeight?: number;
}

/** A label that file and editor papers can carry; defined once per workspace (not per user or extension). */
export interface WorkspaceTag {
  id: string;
  label: string;
  /** Chip background (`#rrggbb`); the label is dark or light, whichever reads best on it. */
  color: string;
}

/** Where papers show their tags: on the title row (top-right), or beside the paper on the right, bottom or left. */
export type TagPlacement = 'top' | 'right' | 'bottom' | 'left';
export const TAG_PLACEMENTS: readonly TagPlacement[] = ['right', 'bottom', 'left', 'top'];
export const DEFAULT_TAG_PLACEMENT: TagPlacement = 'right';

export interface WorkspaceFile {
  version: number;
  /** Every tag of this workspace, including ones no paper uses; undefined = none. */
  tags?: WorkspaceTag[];
  /** Where papers show their tags; undefined = `DEFAULT_TAG_PLACEMENT`. */
  tagPlacement?: TagPlacement;
  /** `false` = tag chips are hidden on the canvas; papers keep their tags. Undefined = shown. */
  showTags?: boolean;
  /** Colors added in the color picker's "Custom" row (`#rrggbb`, oldest first); undefined = none. */
  customColors?: string[];
  nodes: WorkspaceNode[];
  edges: WorkspaceEdge[];
}

// ---- layout constants (shared so host-side placement matches what the webview renders) --------------

export const FILE_HEADER_HEIGHT = 40;
export const FILE_PADDING = 12;
/** Room kept below an annotated snippet for its caption (one line plus margin), inside the file and before the next snippet. */
export const ANNOTATION_SPACE = 30;
export const EDITOR_GAP = 16;
export const EDITOR_HEADER_HEIGHT = 30;
export const DEFAULT_EDITOR_WIDTH = 640;
export const DEFAULT_EDITOR_HEIGHT = 380;
/** Default minimum node size; users can change it in the canvas config panel. */
export const DEFAULT_MIN_NODE_SIZE = 50;
/** Hard lower bound for any node dimension, whatever the file or the config says. */
export const NODE_SIZE_FLOOR = 20;
export const NODE_SIZE_CEILING = 2000;
/** How much of the window "Focus on paper" makes a node fill, in percent; editable in the config panel. */
export const DEFAULT_FOCUS_PERCENT = 80;
export const FOCUS_PERCENT_FLOOR = 10;
export const FOCUS_PERCENT_CEILING = 100;
/** Title labels are on by default for files and snippet editors. */
export const DEFAULT_FILE_SHOW_TITLE = true;
export const DEFAULT_EDITOR_SHOW_TITLE = true;
export const GROUP_HEADER_HEIGHT = 36;
export const DEFAULT_GROUP_FONT_SIZE = 14;
export const DEFAULT_GROUP_FONT_WEIGHT = 600;
/** Height of a group's title bar: the default bar, taller when the title font needs it. */
export const groupHeaderHeight = (fontSize = DEFAULT_GROUP_FONT_SIZE) => Math.max(GROUP_HEADER_HEIGHT, Math.ceil(fontSize * 1.25) + 18);
export const GROUP_PADDING = 16;
export const DEFAULT_GROUP_SIZE = { width: 480, height: 320 };
export const DEFAULT_TEXT_SIZE = { width: 240, height: 40 };
export const DEFAULT_NOTE_SIZE = { width: 220, height: 220 };
export const MEDIA_MAX_SIZE = 480;
export const DEFAULT_NOTE_COLOR = '#ffec99';
export const DEFAULT_SHAPE_SIZE = { width: 160, height: 80 };
export const DEFAULT_SHAPE_FILL = '#ffffff';
export const DEFAULT_SHAPE_STROKE = '#2b2f36';
export const DEFAULT_SHAPE_FONT_SIZE = 14;
/** Font sizes suggested in the text/note toolbar; any size in the allowed range can be typed. */
export const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80] as const;
export const FONT_SIZE_FLOOR = 6;
export const FONT_SIZE_CEILING = 200;
/** Font weights offered in the text/note toolbar. */
export const FONT_WEIGHTS = [
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semibold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'Extra bold' },
] as const;
export const DEFAULT_FONT_WEIGHT = 400;
/** Default canvas background (editable in the config panel). */
export const DEFAULT_CANVAS_BACKGROUND = '#e4e5e8';
export const DEFAULT_TEXT_FONT_SIZE = 18;
export const DEFAULT_EDGE_PATH: EdgePath = 'curve';
export const DEFAULT_EDGE_WIDTH = 2;
export const DEFAULT_START_MARKER: EdgeMarker = 'none';
export const DEFAULT_END_MARKER: EdgeMarker = 'arrow';
export const DEFAULT_EDGE_FONT_SIZE = 14;
/** Line thicknesses offered in the link toolbar. */
export const EDGE_WIDTHS = [1, 2, 3, 4, 6, 8] as const;
export const EDGE_WIDTH_CEILING = 20;
export const DEFAULT_NOTE_FONT_SIZE = 14;
/** Swatches of the color picker: a muted dark row and a light pastel row. */
export const PALETTE = {
  dark: ['#2b2f36', '#3d4450', '#6b2f2f', '#6e4428', '#6b5a24', '#2d5236', '#27405f', '#46315f'],
  light: ['#ffffff', '#e5e5e5', '#ffc9c9', '#ffd6a5', '#ffec99', '#b2f2bb', '#c5e3ff', '#e5dbff'],
};
/**
 * The color picker's grid (see the webview's ColorPalette): greys, bright hues, then six rows of shades from light to
 * dark. Every row has one color per column.
 */
export const COLOR_GRID: readonly (readonly string[])[] = [
  ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
  ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
  ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
  ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
  ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
  ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
  ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
  ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'],
];
/** Most custom colors a workspace remembers (the oldest are dropped). */
export const CUSTOM_COLORS_MAX = 20;
/** Colors new tags take in turn: a soft row of the grid, readable with dark text. */
export const TAG_COLORS = COLOR_GRID[3];
export const TAG_LABEL_MAX = 40;
/** Color of the `index`-th tag created, so consecutive new tags are easy to tell apart. */
export const tagColorFor = (index: number) => TAG_COLORS[((index % TAG_COLORS.length) + TAG_COLORS.length) % TAG_COLORS.length];
const IMAGE_EXTS =['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
const VIDEO_EXTS = ['mp4', 'webm', 'ogg', 'mov'];
export const MEDIA_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS];
const MIN_INITIAL_EDITOR_HEIGHT = 150;
const MAX_INITIAL_EDITOR_HEIGHT = 560;

export function emptyWorkspace(): WorkspaceFile {
  return { version: WORKSPACE_VERSION, nodes: [], edges: [] };
}

export const isFileNode = (n: WorkspaceNode): n is FileNode => n.type === 'file';
export const isEditorNode = (n: WorkspaceNode): n is EditorNode => n.type === 'editor';
export const isGroupNode = (n: WorkspaceNode): n is GroupNode => n.type === 'group';
export const isBoxNode = (n: WorkspaceNode): n is BoxNode => n.type !== 'editor';

function extOf(p: string) {
  return p.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
}
export const isMediaPath = (p: string) => MEDIA_EXTS.includes(extOf(p));
export const isVideoPath = (p: string) => VIDEO_EXTS.includes(extOf(p));

/** Whether a `#rrggbb` color is light (needs dark text on top of it). */
export function isLightColor(color: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

/** Scale natural media dimensions down to fit `MEDIA_MAX_SIZE`. */
export function mediaSizeFor(natural: { width: number; height: number }) {
  const w = natural.width > 0 ? natural.width : MEDIA_MAX_SIZE;
  const h = natural.height > 0 ? natural.height : (MEDIA_MAX_SIZE * 3) / 4;
  const k = Math.min(1, MEDIA_MAX_SIZE / Math.max(w, h));
  return { width: Math.max(NODE_SIZE_FLOOR, Math.round(w * k)), height: Math.max(NODE_SIZE_FLOOR, Math.round(h * k)) };
}

/**
 * Stable reorder so every parent comes before its children (React Flow requirement): nodes are ordered by
 * depth, keeping array (= stacking) order within a depth.
 */
export function parentsFirst<T extends { id: string }>(items: T[], parentOf: (t: T) => string | undefined): T[] {
  const byId = new Map(items.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const depthOf = (t: T, hops = 0): number => {
    const known = depth.get(t.id);
    if (known !== undefined) return known;
    const p = parentOf(t);
    const parent = p !== undefined ? byId.get(p) : undefined;
    const d = parent && hops < items.length ? depthOf(parent, hops + 1) + 1 : 0;
    depth.set(t.id, d);
    return d;
  };
  return items
    .map((t, i) => ({ t, i, d: depthOf(t) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((x) => x.t);
}

/** Canvas position of a node (positions of nodes inside groups/files are relative to their parent). */
export function absolutePosition(workspace: WorkspaceFile, id: string): XY {
  const byId = new Map(workspace.nodes.map((n) => [n.id, n]));
  let n = byId.get(id);
  let x = 0;
  let y = 0;
  for (let i = 0; n && i <= workspace.nodes.length; i++) {
    x += n.position.x;
    y += n.position.y;
    n = n.parent !== undefined ? byId.get(n.parent) : undefined;
  }
  return { x, y };
}

export function editorsOf(workspace: WorkspaceFile, fileNodeId: string): EditorNode[] {
  return workspace.nodes.filter((n): n is EditorNode => isEditorNode(n) && n.parent === fileNodeId);
}

/** Initial editor height: fits the target (plus a little context), otherwise a comfortable default. */
export function editorHeightFor(target: LineRange | undefined, lineHeight: number): number {
  if (!target) return DEFAULT_EDITOR_HEIGHT;
  const lines = target.end - target.start + 1;
  const h = EDITOR_HEADER_HEIGHT + (lines + 2) * lineHeight + 8;
  return Math.round(Math.min(MAX_INITIAL_EDITOR_HEIGHT, Math.max(MIN_INITIAL_EDITOR_HEIGHT, h)));
}

// A file with a single editor renders as ONE combined node (file header + editor filling the rest).
// Only files with several editors become groups with padded, individually movable editors inside.

/** Single-editor file: the editor fills the file below its header (the file size is authoritative). */
export function fitSingleEditor(file: { width: number; height: number }, editor: EditorNode) {
  editor.position = { x: 0, y: FILE_HEADER_HEIGHT };
  editor.width = file.width;
  editor.height = Math.max(NODE_SIZE_FLOOR, file.height - FILE_HEADER_HEIGHT);
}

/** Size of a single-editor file that shows `editor` at its current size. */
export function singleFileSize(editor: { width: number; height: number }) {
  return { width: editor.width, height: FILE_HEADER_HEIGHT + editor.height };
}

/** Before a second editor is added: the existing editor keeps its size and moves into a padded group. */
export function expandToGroup(file: { width: number; height: number }, editor: EditorNode) {
  editor.position = { x: FILE_PADDING, y: FILE_HEADER_HEIGHT };
  file.width = editor.width + FILE_PADDING * 2;
  file.height = FILE_HEADER_HEIGHT + editor.height + FILE_PADDING;
}

/** Height a snippet takes up in its file: the editor plus the room for its caption, if it has one. */
export function editorFootprint(e: { height: number; annotation?: string }) {
  return e.height + (e.annotation !== undefined ? ANNOTATION_SPACE : 0);
}

/** Smallest file-node size that contains all its editors (group layout). */
export function fileSizeFor(editors: { position: XY; width: number; height: number; annotation?: string }[]) {
  let width = DEFAULT_EDITOR_WIDTH + FILE_PADDING * 2;
  let height = FILE_HEADER_HEIGHT + FILE_PADDING;
  for (const e of editors) {
    width = Math.max(width, e.position.x + e.width + FILE_PADDING);
    height = Math.max(height, e.position.y + editorFootprint(e) + FILE_PADDING);
  }
  return { width, height };
}

/** A typed font size, rounded and clamped to the allowed range; undefined when not a number. */
export function clampFontSize(v: unknown): number | undefined {
  if (typeof v === 'string' && !v.trim()) return undefined;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(FONT_SIZE_CEILING, Math.max(FONT_SIZE_FLOOR, n)) : undefined;
}

/** A `#rrggbb` config color (lowercase), or the default canvas background when invalid. */
export function canvasBackgroundOf(v: unknown): string {
  return color(v) ?? DEFAULT_CANVAS_BACKGROUND;
}

/** A config size value clamped to the allowed range (falls back to the default when not a number). */
export function clampNodeSize(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_MIN_NODE_SIZE;
  return Math.min(NODE_SIZE_CEILING, Math.max(NODE_SIZE_FLOOR, n));
}

/** A focus fill percentage clamped to the allowed range (falls back to the default when not a number). */
export function clampFocusPercent(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_FOCUS_PERCENT;
  return Math.min(FOCUS_PERCENT_CEILING, Math.max(FOCUS_PERCENT_FLOOR, n));
}

// ---- parse / serialize ---------------------------------------------------------------------------

/** Parse leniently: an empty or broken file yields an empty workspace plus an error message instead of throwing. */
export function parseWorkspace(text: string): { workspace: WorkspaceFile; error?: string } {
  if (!text.trim()) return { workspace: emptyWorkspace() };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { workspace: emptyWorkspace(), error: `Invalid JSON: ${(e as Error).message}` };
  }
  if (!raw || typeof raw !== 'object') return { workspace: emptyWorkspace(), error: 'Workspace file must be a JSON object' };
  const obj = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const tags = parseTags(obj.tags);
  const tagIds = new Set(tags.map((t) => t.id));
  // Known tag ids only, each once; undefined when none are left.
  const nodeTags = (v: unknown) => {
    const ids = Array.isArray(v) ? [...new Set(v.filter((t): t is string => typeof t === 'string' && tagIds.has(t)))] : [];
    return ids.length ? ids : undefined;
  };

  const files: FileNode[] = [];
  const editors: EditorNode[] = [];
  const boxes: BoxNode[] = []; // every non-editor node, in file (= stacking) order
  for (const r of rawNodes) {
    if (!r || typeof r !== 'object') continue;
    const n = r as Record<string, any>;
    if (typeof n.id !== 'string') continue;
    const box = { id: n.id, parent: typeof n.parent === 'string' ? n.parent : undefined, position: xy(n.position) };
    const annotation = typeof n.annotation === 'string' ? n.annotation : undefined; // text and notes have none
    // Title labels (files and editors): an empty title means the base name; showTitle is kept only when not the default.
    const title = typeof n.title === 'string' && n.title ? n.title : undefined;
    const showTitle = (fallback: boolean) => (typeof n.showTitle === 'boolean' && n.showTitle !== fallback ? n.showTitle : undefined);
    const size = (d: { width: number; height: number }) => ({
      width: Math.max(NODE_SIZE_FLOOR, num(n.width, d.width)),
      height: Math.max(NODE_SIZE_FLOOR, num(n.height, d.height)),
    });
    if (n.type === 'file' && typeof n.file === 'string') {
      const f: FileNode = { ...box, type: 'file', file: n.file, annotation, title, showTitle: showTitle(DEFAULT_FILE_SHOW_TITLE), tags: nodeTags(n.tags), width: num(n.width, 0), height: num(n.height, 0) };
      files.push(f);
      boxes.push(f);
    } else if (n.type === 'group') {
      const fontSize = Math.round(Number(n.fontSize));
      const fontWeight = Math.round(Number(n.fontWeight) / 100) * 100;
      const strokeWidth = Math.min(20, Math.round(Number(n.strokeWidth) * 2) / 2);
      boxes.push({
        ...box,
        type: 'group',
        title: typeof n.title === 'string' ? n.title : '',
        color: color(n.color),
        textColor: color(n.textColor),
        fontSize: fontSize > 0 ? fontSize : undefined,
        fontWeight: fontWeight >= 100 && fontWeight <= 900 ? fontWeight : undefined,
        titlePosition: n.titlePosition === 'top-left' ? undefined : oneOf(GROUP_TITLE_POSITIONS, n.titlePosition),
        strokeColor: color(n.strokeColor),
        strokeWidth: strokeWidth > 0 && strokeWidth !== DEFAULT_GROUP_BORDER_WIDTH ? strokeWidth : undefined,
        strokeStyle: n.strokeStyle === 'solid' ? undefined : oneOf(GROUP_BORDER_STYLES, n.strokeStyle),
        annotation,
        ...size(DEFAULT_GROUP_SIZE),
      });
    } else if (n.type === 'text' || n.type === 'note') {
      const fontSize = Math.round(Number(n.fontSize));
      const fontWeight = Math.round(Number(n.fontWeight) / 100) * 100;
      boxes.push({
        ...box,
        type: n.type,
        text: typeof n.text === 'string' ? n.text : '',
        color: color(n.color),
        textColor: n.type === 'note' ? color(n.textColor) : undefined,
        fontSize: fontSize > 0 ? fontSize : undefined,
        fontWeight: fontWeight >= 100 && fontWeight <= 900 ? fontWeight : undefined,
        ...size(n.type === 'text' ? DEFAULT_TEXT_SIZE : DEFAULT_NOTE_SIZE),
      });
    } else if (n.type === 'shape') {
      const fontSize = Math.round(Number(n.fontSize));
      const fontWeight = Math.round(Number(n.fontWeight) / 100) * 100;
      boxes.push({
        ...box,
        type: 'shape',
        shape: typeof n.shape === 'string' && /^[a-z][a-z0-9-]*$/.test(n.shape) ? n.shape : 'rectangle',
        text: typeof n.text === 'string' ? n.text : '',
        color: n.color === 'none' ? 'none' : color(n.color),
        strokeColor: color(n.strokeColor),
        textColor: color(n.textColor),
        fontSize: fontSize > 0 ? fontSize : undefined,
        fontWeight: fontWeight >= 100 && fontWeight <= 900 ? fontWeight : undefined,
        annotation,
        ...size(DEFAULT_SHAPE_SIZE),
      });
    } else if (n.type === 'media' && typeof n.src === 'string') {
      boxes.push({ ...box, type: 'media', src: n.src, annotation, ...size({ width: MEDIA_MAX_SIZE, height: MEDIA_MAX_SIZE }) });
    } else if (n.type === 'editor' && typeof n.parent === 'string') {
      editors.push({
        id: n.id,
        type: 'editor',
        parent: n.parent,
        target: range(n.target),
        anchor: typeof n.anchor === 'string' ? n.anchor : undefined,
        annotation,
        title,
        showTitle: showTitle(DEFAULT_EDITOR_SHOW_TITLE),
        tags: nodeTags(n.tags),
        position: xy(n.position, { x: FILE_PADDING, y: FILE_HEADER_HEIGHT }),
        width: Math.max(NODE_SIZE_FLOOR, num(n.width, DEFAULT_EDITOR_WIDTH)),
        height: Math.max(NODE_SIZE_FLOOR, num(n.height, DEFAULT_EDITOR_HEIGHT)),
      });
    } else if (n.type === 'code' && typeof n.file === 'string') {
      migrateV1CodeNode(n, files, editors);
      boxes.push(files[files.length - 1]);
    }
  }
  // A box can only sit in an existing group, without cycles; otherwise it goes back to the canvas.
  const groups = new Map(boxes.filter((b) => b.type === 'group').map((g) => [g.id, g]));
  for (const b of boxes) {
    if (b.parent === undefined) continue;
    const seen = new Set([b.id]);
    let p: string | undefined = b.parent;
    while (p !== undefined && groups.has(p) && !seen.has(p)) {
      seen.add(p);
      p = groups.get(p)!.parent;
    }
    if (p !== undefined) delete b.parent; // missing group or a cycle
  }

  const fileIds = new Set(files.map((f) => f.id));
  const liveEditors = editors.filter((e) => fileIds.has(e.parent));
  for (const f of files) {
    const own = liveEditors.filter((e) => e.parent === f.id);
    if (own.length === 1) {
      // Combined node: missing sizes come from the editor (v1 migration), then the editor fills the file.
      if (!f.width || !f.height) Object.assign(f, singleFileSize(own[0]));
      f.width = Math.max(f.width, NODE_SIZE_FLOOR);
      f.height = Math.max(f.height, NODE_SIZE_FLOOR);
      fitSingleEditor(f, own[0]);
    } else {
      // A group must at least contain its editors (also fixes missing sizes).
      const min = fileSizeFor(own);
      f.width = Math.max(f.width, min.width);
      f.height = Math.max(f.height, min.height);
    }
  }
  const nodes = parentsFirst<WorkspaceNode>([...boxes, ...liveEditors], (n) => n.parent); // React Flow requirement
  const ids = new Set(nodes.map((n) => n.id));
  const edges: WorkspaceEdge[] = [];
  for (const e of Array.isArray(obj.edges) ? obj.edges : []) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !ids.has(e.source) || !ids.has(e.target)) continue;
    edges.push(parseEdge(e));
  }
  const customColors = [...new Set((Array.isArray(obj.customColors) ? obj.customColors : []).map(color).filter((c): c is string => !!c))].slice(-CUSTOM_COLORS_MAX);
  const tagPlacement = obj.tagPlacement === DEFAULT_TAG_PLACEMENT ? undefined : oneOf(TAG_PLACEMENTS, obj.tagPlacement);
  return { workspace: { version: WORKSPACE_VERSION, ...(tags.length ? { tags } : {}), ...(tagPlacement ? { tagPlacement } : {}), ...(obj.showTags === false ? { showTags: false } : {}), ...(customColors.length ? { customColors } : {}), nodes, edges } };
}

/** Tag definitions with an id and a label; ids and labels (ignoring case) are unique, the first one wins. */
function parseTags(v: unknown): WorkspaceTag[] {
  const out: WorkspaceTag[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const t of Array.isArray(v) ? v : []) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id || typeof t.label !== 'string') continue;
    const label = t.label.trim().slice(0, TAG_LABEL_MAX);
    if (!label || ids.has(t.id) || labels.has(label.toLowerCase())) continue;
    ids.add(t.id);
    labels.add(label.toLowerCase());
    out.push({ id: t.id, label, color: color(t.color) ?? tagColorFor(out.length) });
  }
  return out;
}

function oneOf<T extends string>(values: readonly T[], v: unknown): T | undefined {
  return values.includes(v as T) ? (v as T) : undefined;
}

function parseEdge(e: Record<string, any>): WorkspaceEdge {
  const width = Number(e.width);
  const fontSize = Math.round(Number(e.fontSize));
  const fontWeight = Math.round(Number(e.fontWeight) / 100) * 100;
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceSide: oneOf(SIDES, e.sourceSide),
    targetSide: oneOf(SIDES, e.targetSide),
    path: oneOf(EDGE_PATHS, e.path),
    color: color(e.color),
    width: Number.isFinite(width) && width > 0 ? Math.min(EDGE_WIDTH_CEILING, width) : undefined,
    dash: oneOf(EDGE_DASHES, e.dash),
    startMarker: oneOf(EDGE_MARKERS, e.startMarker),
    endMarker: oneOf(EDGE_MARKERS, e.endMarker),
    label: typeof e.label === 'string' && e.label ? e.label : undefined,
    labelColor: color(e.labelColor),
    labelBackground: e.labelBackground === 'none' ? 'none' : color(e.labelBackground),
    fontSize: fontSize > 0 ? fontSize : undefined,
    fontWeight: fontWeight >= 100 && fontWeight <= 900 ? fontWeight : undefined,
  };
}

/** Fixed key order; unset and default values are left out so files stay small and diffs readable. */
function serializeEdge(e: WorkspaceEdge) {
  const unlessDefault = <T>(v: T | undefined, fallback: T) => (v !== fallback ? v : undefined);
  const out: Record<string, unknown> = {
    id: e.id,
    source: e.source,
    sourceSide: e.sourceSide,
    target: e.target,
    targetSide: e.targetSide,
    path: unlessDefault(e.path, DEFAULT_EDGE_PATH),
    color: e.color,
    width: unlessDefault(e.width, DEFAULT_EDGE_WIDTH),
    dash: unlessDefault(e.dash, 'solid'),
    startMarker: unlessDefault(e.startMarker, DEFAULT_START_MARKER),
    endMarker: unlessDefault(e.endMarker, DEFAULT_END_MARKER),
    label: e.label || undefined,
    labelColor: e.labelColor,
    labelBackground: e.labelBackground,
    fontSize: e.fontSize,
    fontWeight: e.fontWeight,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** v1 stored one flat `code` node per range; it becomes a file node with a single targeted editor. */
function migrateV1CodeNode(n: Record<string, any>, files: FileNode[], editors: EditorNode[]) {
  const target = range(n.range) ?? { start: 1, end: 1 };
  const width = Math.max(NODE_SIZE_FLOOR, num(n.width, DEFAULT_EDITOR_WIDTH));
  const editor: EditorNode = {
    id: n.id,
    type: 'editor',
    parent: `${n.id}_file`,
    target,
    anchor: typeof n.anchor === 'string' ? n.anchor : undefined,
    position: { x: FILE_PADDING, y: FILE_HEADER_HEIGHT },
    width,
    height: editorHeightFor(target, 19),
  };
  editors.push(editor);
  files.push({ id: editor.parent, type: 'file', file: n.file, position: xy(n.position), width: 0, height: 0 });
}

function num(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function xy(v: any, fallback: XY = { x: 0, y: 0 }): XY {
  return { x: Number.isFinite(Number(v?.x)) ? Number(v.x) : fallback.x, y: Number.isFinite(Number(v?.y)) ? Number(v.y) : fallback.y };
}

function color(v: unknown): string | undefined {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
}

function range(v: any): LineRange | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const start = Math.max(1, Math.floor(Number(v.start) || 1));
  const end = Math.max(start, Math.floor(Number(v.end) || start));
  return { start, end };
}

/** Stable, diff-friendly serialization (rounded coordinates, fixed key order, parents first). */
export function serializeWorkspace(workspace: WorkspaceFile): string {
  const round = (p: XY) => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const rect = (n: WorkspaceNode) => ({ position: round(n.position), width: Math.round(n.width), height: Math.round(n.height) });
  const head = (n: BoxNode) => ({ id: n.id, type: n.type, ...(n.parent !== undefined ? { parent: n.parent } : {}) });
  const annotation = (n: { annotation?: string }) => (n.annotation !== undefined ? { annotation: n.annotation } : {});
  const title = (n: { title?: string; showTitle?: boolean }, fallback: boolean) => ({
    ...(n.title ? { title: n.title } : {}),
    ...(n.showTitle !== undefined && n.showTitle !== fallback ? { showTitle: n.showTitle } : {}),
  });
  const tags = (n: { tags?: string[] }) => (n.tags?.length ? { tags: [...n.tags] } : {});
  const out = {
    version: WORKSPACE_VERSION,
    ...(workspace.tags?.length ? { tags: workspace.tags.map((t) => ({ id: t.id, label: t.label, color: t.color })) } : {}),
    ...(workspace.tagPlacement && workspace.tagPlacement !== DEFAULT_TAG_PLACEMENT ? { tagPlacement: workspace.tagPlacement } : {}),
    ...(workspace.showTags === false ? { showTags: false } : {}),
    ...(workspace.customColors?.length ? { customColors: [...workspace.customColors] } : {}),
    nodes: parentsFirst(workspace.nodes, (n) => n.parent).map((n) => {
      switch (n.type) {
        case 'file':
          return { ...head(n), file: n.file, ...annotation(n), ...title(n, DEFAULT_FILE_SHOW_TITLE), ...tags(n), ...rect(n) };
        case 'group':
          return {
            ...head(n),
            title: n.title,
            ...(n.color ? { color: n.color } : {}),
            ...(n.textColor ? { textColor: n.textColor } : {}),
            ...(n.fontSize ? { fontSize: n.fontSize } : {}),
            ...(n.fontWeight ? { fontWeight: n.fontWeight } : {}),
            ...(n.titlePosition && n.titlePosition !== 'top-left' ? { titlePosition: n.titlePosition } : {}),
            ...(n.strokeColor ? { strokeColor: n.strokeColor } : {}),
            ...(n.strokeWidth && n.strokeWidth !== DEFAULT_GROUP_BORDER_WIDTH ? { strokeWidth: n.strokeWidth } : {}),
            ...(n.strokeStyle && n.strokeStyle !== 'solid' ? { strokeStyle: n.strokeStyle } : {}),
            ...annotation(n),
            ...rect(n),
          };
        case 'text':
        case 'note':
          return {
            ...head(n),
            text: n.text,
            ...(n.color ? { color: n.color } : {}),
            ...(n.textColor ? { textColor: n.textColor } : {}),
            ...(n.fontSize ? { fontSize: n.fontSize } : {}),
            ...(n.fontWeight ? { fontWeight: n.fontWeight } : {}),
            ...rect(n),
          };
        case 'shape':
          return {
            ...head(n),
            shape: n.shape,
            text: n.text,
            ...(n.color ? { color: n.color } : {}),
            ...(n.strokeColor ? { strokeColor: n.strokeColor } : {}),
            ...(n.textColor ? { textColor: n.textColor } : {}),
            ...(n.fontSize ? { fontSize: n.fontSize } : {}),
            ...(n.fontWeight ? { fontWeight: n.fontWeight } : {}),
            ...annotation(n),
            ...rect(n),
          };
        case 'media':
          return { ...head(n), src: n.src, ...annotation(n), ...rect(n) };
        case 'editor':
          return {
            id: n.id,
            type: n.type,
            parent: n.parent,
            ...(n.target ? { target: { start: n.target.start, end: n.target.end } } : {}),
            ...(n.target && n.anchor !== undefined ? { anchor: n.anchor } : {}),
            ...annotation(n),
            ...title(n, DEFAULT_EDITOR_SHOW_TITLE),
            ...tags(n),
            ...rect(n),
          };
      }
    }),
    edges: workspace.edges.map(serializeEdge),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

// ---- stacking order ------------------------------------------------------------------------------
// Array order is stacking order (later = on top). Boxes stack among the boxes of their group (or of the canvas),
// editors among the editors of their file; `group` returns what an item stacks against (its parent id, or undefined for top-level).

export type StackOp = 'front' | 'back' | 'forward' | 'backward';

/** Move `id` within its stacking group. Returns the same array when nothing changes. */
export function restack<T extends { id: string }>(items: T[], group: (t: T) => string | undefined, id: string, op: StackOp): T[] {
  const item = items.find((t) => t.id === id);
  if (!item) return items;
  const g = group(item);
  // Slots (array indexes) the group occupies; the group is reordered within those slots only.
  const slots: number[] = [];
  items.forEach((t, i) => group(t) === g && slots.push(i));
  const peers = slots.map((i) => items[i]);
  const from = peers.indexOf(item);
  const to = op === 'front' ? peers.length - 1 : op === 'back' ? 0 : op === 'forward' ? Math.min(peers.length - 1, from + 1) : Math.max(0, from - 1);
  if (to === from) return items;
  peers.splice(from, 1);
  peers.splice(to, 0, item);
  const out = [...items];
  slots.forEach((slot, k) => (out[slot] = peers[k]));
  return out;
}

/** Position of `id` in its stacking group, for enabling menu items. */
export function stackPosition<T extends { id: string }>(items: T[], group: (t: T) => string | undefined, id: string) {
  const item = items.find((t) => t.id === id);
  if (!item) return { isFront: true, isBack: true };
  const peers = items.filter((t) => group(t) === group(item));
  return { isFront: peers[peers.length - 1] === item, isBack: peers[0] === item };
}

export function newId(prefix = 'n'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// ---- ranges ----------------------------------------------------------------------------------------

export function clampRange(range: LineRange, lineCount: number): LineRange {
  const max = Math.max(1, lineCount);
  const start = Math.min(Math.max(1, range.start), max);
  const end = Math.min(Math.max(start, range.end), max);
  return { start, end };
}

/**
 * Re-locate a range whose anchor line no longer matches (file edited while the canvas was closed).
 * Searches for the anchor text nearest to the old start and shifts the range, keeping its length.
 */
export function relocateRange(lines: string[], range: LineRange, anchor: string | undefined): LineRange {
  const clamped = clampRange(range, lines.length);
  if (!anchor) return clamped;
  if ((lines[range.start - 1] ?? '').trim() === anchor) return clamped;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== anchor) continue;
    const dist = Math.abs(i + 1 - range.start);
    if (dist < bestDist) {
      best = i + 1;
      bestDist = dist;
    }
  }
  if (best < 0) return clamped;
  const len = range.end - range.start;
  return clampRange({ start: best, end: best + len }, lines.length);
}

// ---- placement ---------------------------------------------------------------------------------------

/** Place a new node of the given size without overlapping existing ones, starting from `origin`. */
export function findFreePosition(
  existing: { position: XY; width: number; height: number }[],
  origin: XY,
  size: { width: number; height: number },
  gap = 40,
): XY {
  const overlaps = (p: XY) =>
    existing.some(
      (e) =>
        p.x < e.position.x + e.width + gap &&
        p.x + size.width + gap > e.position.x &&
        p.y < e.position.y + e.height + gap &&
        p.y + size.height + gap > e.position.y,
    );
  let p = { ...origin };
  for (let i = 0; i < 200 && overlaps(p); i++) p = { x: p.x + 48, y: p.y + 48 };
  return p;
}

/** Where the next editor inside a file node goes: below the existing ones. */
export function nextEditorSlot(editors: EditorNode[]): XY {
  if (!editors.length) return { x: FILE_PADDING, y: FILE_HEADER_HEIGHT };
  const bottom = Math.max(...editors.map((e) => e.position.y + editorFootprint(e)));
  return { x: FILE_PADDING, y: bottom + EDITOR_GAP };
}

export interface AddSnippetResult {
  workspace: WorkspaceFile;
  /** The editor node to reveal (new or existing). */
  editorId: string;
  created: boolean;
}

/**
 * Add a snippet for `file` to a workspace: into the existing file node for that file if there is one
 * (reusing an editor whose target already covers the lines), otherwise as a new file node.
 * Pure: returns a new workspace.
 */
export function addSnippet(
  input: WorkspaceFile,
  opts: {
    file: string;
    target?: LineRange;
    anchor?: string;
    lineHeight: number;
    /** Canvas position for a new file node (top-left); collisions are avoided. */
    origin: XY;
    /** Title visibility for the nodes this creates (config panel defaults); undefined = the format defaults. */
    showTitles?: { file: boolean; editor: boolean };
    /** Explicit position (drops): used as-is. */
    position?: XY;
    id?: () => string;
  },
): AddSnippetResult {
  const makeId = opts.id ?? newId;
  const workspace: WorkspaceFile = { ...input, nodes: input.nodes.map((n) => ({ ...n })) };
  const fileNode = workspace.nodes.find((n): n is FileNode => isFileNode(n) && n.file === opts.file);
  const target = opts.target;

  if (fileNode) {
    const editors = editorsOf(workspace, fileNode.id);
    const reuse = target
      ? editors.find((e) => e.target && e.target.start <= target.start && e.target.end >= target.end)
      : editors.find((e) => !e.target) ?? editors[0];
    if (reuse) return { workspace, editorId: reuse.id, created: false };
    if (editors.length === 1) expandToGroup(fileNode, editors[0]);
    const editor: EditorNode = {
      id: makeId('e'),
      type: 'editor',
      parent: fileNode.id,
      target,
      anchor: target ? opts.anchor : undefined,
      showTitle: opts.showTitles?.editor,
      position: nextEditorSlot(editors),
      width: editors.length ? Math.max(...editors.map((e) => e.width)) : DEFAULT_EDITOR_WIDTH,
      height: editorHeightFor(target, opts.lineHeight),
    };
    workspace.nodes.push(editor);
    const size = fileSizeFor([...editors, editor]);
    fileNode.width = Math.max(fileNode.width, size.width);
    fileNode.height = Math.max(fileNode.height, size.height);
    return { workspace, editorId: editor.id, created: true };
  }

  const editor: EditorNode = {
    id: makeId('e'),
    type: 'editor',
    parent: makeId('f'),
    target,
    anchor: target ? opts.anchor : undefined,
    showTitle: opts.showTitles?.editor,
    position: { x: 0, y: FILE_HEADER_HEIGHT },
    width: DEFAULT_EDITOR_WIDTH,
    height: editorHeightFor(target, opts.lineHeight),
  };
  const size = singleFileSize(editor);
  const occupied = workspace.nodes.filter((n) => isBoxNode(n) && n.parent === undefined);
  const file: FileNode = {
    id: editor.parent,
    type: 'file',
    file: opts.file,
    showTitle: opts.showTitles?.file,
    position: opts.position ?? findFreePosition(occupied, opts.origin, size),
    ...size,
  };
  workspace.nodes = parentsFirst([...workspace.nodes, file, editor], (n) => n.parent);
  return { workspace, editorId: editor.id, created: true };
}
