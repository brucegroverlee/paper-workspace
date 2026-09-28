// Links between nodes: a line, curve or elbow from a side of one node to a side of another, with optional arrow
// heads, dashes and a label. Selecting a link shows a toolbar to style it.
import { memo, useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BaseEdge, EdgeLabelRenderer, Position, getBezierPath, getSmoothStepPath, getStraightPath, useStore, type EdgeProps } from '@xyflow/react';
import {
  DEFAULT_EDGE_FONT_SIZE,
  DEFAULT_EDGE_PATH,
  DEFAULT_EDGE_WIDTH,
  DEFAULT_END_MARKER,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_START_MARKER,
  EDGE_WIDTHS,
  FONT_WEIGHTS,
  type EdgeDash,
  type EdgeMarker,
  type EdgePath,
  type XY,
} from '../shared/workspace';
import { Dropdown, FontSizeField, TextEditor, ToolbarButton, ToolbarPalette, stop, type Option } from './BoardNodes';
import { useWorkspace, type LinkData, type RFEdge } from './context';
import { HANDLE_SIZE } from './handles';

/** Line color when none is set: the canvas text color, so links read on any background. */
const AUTO_COLOR = 'var(--pw-canvas-fg)';
const ROUNDED_RADIUS = 16;

// ---- geometry -----------------------------------------------------------------------------------------

/**
 * Marker shapes in a 10×10 box pointing right (+x), centered on y = 5. `tip` is the x that touches the node,
 * `back` where the line stops (inside the shape, so no gap shows between line and marker).
 */
const MARKERS: Record<Exclude<EdgeMarker, 'none'>, { d: string; fill: boolean; tip: number; back: number }> = {
  arrow: { d: 'M0,1 L10,5 L0,9 Z', fill: true, tip: 10, back: 3 },
  'open-arrow': { d: 'M1,1 L9,5 L1,9', fill: false, tip: 9, back: 8 },
  circle: { d: 'M1,5 A4,4 0 1,0 9,5 A4,4 0 1,0 1,5 Z', fill: true, tip: 9, back: 1 },
  diamond: { d: 'M0,5 L5,1.5 L10,5 L5,8.5 Z', fill: true, tip: 10, back: 0.5 },
};

/** Markers grow with the line so thick links keep proportionate arrow heads. */
const markerSize = (width: number) => 6 + 3 * width;

/** How far a line stops short of its node so the marker's tip, not the line, touches the node. */
function markerInset(kind: EdgeMarker, width: number) {
  if (kind === 'none') return 0;
  const m = MARKERS[kind];
  return ((m.tip - m.back) * markerSize(width)) / 10;
}

/** Outward direction of each side. */
const NORMAL: Record<Position, XY> = {
  [Position.Top]: { x: 0, y: -1 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Bottom]: { x: 0, y: 1 },
  [Position.Left]: { x: -1, y: 0 },
};

const move = (p: XY, d: XY, k: number): XY => ({ x: p.x + d.x * k, y: p.y + d.y * k });

function dashArray(dash: EdgeDash | undefined, width: number) {
  if (dash === 'dashed') return `${width * 4} ${width * 3}`;
  if (dash === 'dotted') return `0 ${width * 2.5}`;
  return undefined;
}

/** SVG path, label point and marker ids of a link. */
function linkGeometry(p: EdgeProps<RFEdge>, data: LinkData) {
  const width = data.width ?? DEFAULT_EDGE_WIDTH;
  const kind = data.path ?? DEFAULT_EDGE_PATH;
  // React Flow reports the outer edge of the handle; the node's border is half a handle further in.
  let s = move({ x: p.sourceX, y: p.sourceY }, NORMAL[p.sourcePosition], -HANDLE_SIZE / 2);
  let t = move({ x: p.targetX, y: p.targetY }, NORMAL[p.targetPosition], -HANDLE_SIZE / 2);
  const startInset = markerInset(data.startMarker ?? DEFAULT_START_MARKER, width);
  const endInset = markerInset(data.endMarker ?? DEFAULT_END_MARKER, width);
  if (kind === 'straight') {
    // A straight line meets the node along its own direction.
    const len = Math.hypot(t.x - s.x, t.y - s.y) || 1;
    const u = { x: (t.x - s.x) / len, y: (t.y - s.y) / len };
    [s, t] = [move(s, u, startInset), move(t, u, -endInset)];
  } else {
    // Curves and elbows leave and enter perpendicular to the side.
    [s, t] = [move(s, NORMAL[p.sourcePosition], startInset), move(t, NORMAL[p.targetPosition], endInset)];
  }
  const params = { sourceX: s.x, sourceY: s.y, sourcePosition: p.sourcePosition, targetX: t.x, targetY: t.y, targetPosition: p.targetPosition };
  const [path, labelX, labelY] =
    kind === 'straight'
      ? getStraightPath(params)
      : kind === 'curve'
        ? getBezierPath(params)
        : getSmoothStepPath({ ...params, borderRadius: kind === 'rounded' ? ROUNDED_RADIUS : 0 });
  return { path, labelX, labelY, width };
}

// ---- edge ---------------------------------------------------------------------------------------------

type LinkStore = {
  edgeLookup: Map<string, { source: string; target: string; zIndex?: number }>;
  nodeLookup: Map<string, { parentId?: string; internals: { z: number } }>;
};

/**
 * The z-index React Flow paints a link's line at: its own z-index plus, for an end inside a parent (a snippet in a
 * file, a node in a group), that end's z-index (`getElevatedEdgeZIndex` in basic mode; not exported by the package).
 */
function linkZIndex(s: LinkStore, edge: { source: string; target: string; zIndex?: number }) {
  const nested = (nodeId: string) => {
    const n = s.nodeLookup.get(nodeId);
    return n?.parentId ? n.internals.z : 0;
  };
  return (edge.zIndex ?? 0) + Math.max(nested(edge.source), nested(edge.target));
}

/** The level of the topmost line: labels paint there so no line ever crosses over a label's text. */
function topLinkZIndex(s: LinkStore) {
  let top = 0;
  for (const e of s.edgeLookup.values()) top = Math.max(top, linkZIndex(s, e));
  return top;
}

function Marker(props: { id: string; kind: Exclude<EdgeMarker, 'none'>; color: string; width: number }) {
  const m = MARKERS[props.kind];
  const size = markerSize(props.width);
  const style: CSSProperties = m.fill
    ? { fill: props.color }
    : { fill: 'none', stroke: props.color, strokeWidth: (props.width * 10) / size, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    // `auto-start-reverse` turns the same shape around at the start, so it points away from the line there too.
    <marker id={props.id} viewBox="0 0 10 10" markerWidth={size} markerHeight={size} refX={m.back} refY={5} orient="auto-start-reverse" markerUnits="userSpaceOnUse">
      <path d={m.d} style={style} />
    </marker>
  );
}

export const LinkEdge = memo(function LinkEdge(props: EdgeProps<RFEdge>) {
  const { id, selected } = props;
  const data = props.data ?? {};
  const ctx = useWorkspace();
  const [editing, setEditing] = useState(false);
  const { path, labelX, labelY, width } = linkGeometry(props, data);
  const color = data.color ?? AUTO_COLOR;
  const start = data.startMarker ?? DEFAULT_START_MARKER;
  const end = data.endMarker ?? DEFAULT_END_MARKER;
  const markerId = `pw-link-${id.replace(/[^\w-]/g, '_')}`;
  const fontSize = data.fontSize ?? DEFAULT_EDGE_FONT_SIZE;
  const fontWeight = data.fontWeight ?? DEFAULT_FONT_WEIGHT;
  // Labels live in a layer below every link and node; lifting them to the topmost line's z-index paints them over
  // every line, while nodes stacked above all links still cover them.
  const zIndex = useStore(topLinkZIndex);
  const background = data.labelBackground === 'none' ? 'transparent' : data.labelBackground;
  // The toolbar sits above the label, which can wrap to several lines.
  const labelRef = useRef<HTMLDivElement>(null);
  const [labelHeight, setLabelHeight] = useState(0);
  useLayoutEffect(() => setLabelHeight(labelRef.current?.offsetHeight ?? 0), [data.label, data.labelBackground, fontSize, fontWeight, selected]);

  const finish = (text: string) => {
    setEditing(false);
    const label = text.trim() ? text : undefined;
    if (label !== data.label) ctx.updateLink(id, { label });
  };

  return (
    // Double-clicking the line or its label (label events bubble here through the portal) edits the label.
    <g className="pw-link" onDoubleClick={() => setEditing(true)}>
      <defs>
        {start !== 'none' && <Marker id={`${markerId}-start`} kind={start} color={color} width={width} />}
        {end !== 'none' && <Marker id={`${markerId}-end`} kind={end} color={color} width={width} />}
      </defs>
      <path className="pw-link-halo" d={path} style={{ strokeWidth: width + 8 }} />
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={Math.max(16, width + 12)}
        markerStart={start !== 'none' ? `url(#${markerId}-start)` : undefined}
        markerEnd={end !== 'none' ? `url(#${markerId}-end)` : undefined}
        style={{
          stroke: color,
          strokeWidth: width,
          strokeDasharray: dashArray(data.dash, width),
          strokeLinecap: data.dash === 'dashed' ? 'butt' : 'round',
          strokeLinejoin: 'round',
        }}
      />
      {(data.label || editing) && (
        <EdgeLabelRenderer>
          <div
            ref={labelRef}
            className={`pw-link-label nodrag nopan${editing ? ' editing' : ''}${data.labelBackground && data.labelBackground !== 'none' ? ' boxed' : ''}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              zIndex,
              color: data.labelColor ?? color,
              background,
              fontSize,
              fontWeight,
            }}
          >
            {editing ? <TextEditor value={data.label ?? ''} onDone={finish} /> : data.label}
          </div>
        </EdgeLabelRenderer>
      )}
      {selected && !editing && <LinkToolbar id={id} data={data} x={labelX} y={labelY} lift={data.label ? labelHeight / 2 : 0} onEditLabel={() => setEditing(true)} />}
    </g>
  );
});

// ---- toolbar ------------------------------------------------------------------------------------------

const PATH_OPTIONS: Option<EdgePath>[] = [
  { value: 'curve', label: 'Curved', icon: <PathIcon d="M3,12 C15,12 13,2 25,2" /> },
  { value: 'straight', label: 'Straight', icon: <PathIcon d="M3,12 L25,2" /> },
  { value: 'step', label: 'Elbow', icon: <PathIcon d="M3,12 H14 V2 H25" /> },
  { value: 'rounded', label: 'Rounded elbow', icon: <PathIcon d="M3,12 H10 Q14,12 14,8 V6 Q14,2 18,2 H25" /> },
];

const DASH_OPTIONS: Option<EdgeDash>[] = [
  { value: 'solid', label: 'Solid', icon: <LineIcon /> },
  { value: 'dashed', label: 'Dashed', icon: <LineIcon dash="dashed" /> },
  { value: 'dotted', label: 'Dotted', icon: <LineIcon dash="dotted" /> },
];

const WIDTH_OPTIONS: Option<number>[] = EDGE_WIDTHS.map((w) => ({ value: w, label: `${w} px`, icon: <LineIcon width={w} /> }));

const MARKER_LABELS: Record<EdgeMarker, string> = { none: 'None', arrow: 'Arrow', 'open-arrow': 'Open arrow', circle: 'Circle', diamond: 'Diamond' };
const markerOptions = (atStart: boolean): Option<EdgeMarker>[] =>
  (Object.keys(MARKER_LABELS) as EdgeMarker[]).map((kind) => ({ value: kind, label: MARKER_LABELS[kind], icon: <MarkerIcon kind={kind} atStart={atStart} /> }));
const START_OPTIONS = markerOptions(true);
const END_OPTIONS = markerOptions(false);

function PathIcon(props: { d: string }) {
  return (
    <svg className="pw-link-icon" width="28" height="14" viewBox="0 0 28 14" aria-hidden>
      <path d={props.d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LineIcon(props: { width?: number; dash?: EdgeDash }) {
  const w = props.width ?? 2;
  return (
    <svg className="pw-link-icon" width="28" height="14" viewBox="0 0 28 14" aria-hidden>
      <line x1="3" y1="7" x2="25" y2="7" stroke="currentColor" strokeWidth={Math.min(w, 8)} strokeDasharray={dashArray(props.dash, w)} strokeLinecap={props.dash === 'dashed' ? 'butt' : 'round'} />
    </svg>
  );
}

function MarkerIcon(props: { kind: EdgeMarker; atStart: boolean }) {
  const m = props.kind === 'none' ? undefined : MARKERS[props.kind];
  const tipX = 25;
  return (
    <svg className="pw-link-icon" width="28" height="14" viewBox="0 0 28 14" aria-hidden style={props.atStart ? { transform: 'scaleX(-1)' } : undefined}>
      <line x1="3" y1="7" x2={m ? tipX - (m.tip - m.back) : tipX} y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      {m && (
        <path
          d={m.d}
          transform={`translate(${tipX - m.tip} 2)`}
          fill={m.fill ? 'currentColor' : 'none'}
          stroke={m.fill ? 'none' : 'currentColor'}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

type Popup = 'color' | 'labelColor' | 'labelBackground' | 'width' | 'dash' | 'path' | 'start' | 'end' | 'size' | 'weight';

/** Only while this link is the whole selection, so a box selection doesn't pop toolbars up everywhere. */
const onlyOneLinkSelected = (s: { nodes: { selected?: boolean }[]; edges: { selected?: boolean }[] }) => {
  if (s.nodes.some((n) => n.selected)) return false;
  let count = 0;
  for (const e of s.edges) if (e.selected && ++count > 1) return false;
  return count === 1;
};

/**
 * Style controls above a selected link's middle. Rendered on the React Flow container in screen coordinates (not
 * inside the zoomed viewport), so it keeps its size at any zoom and stays above the nodes.
 */
function LinkToolbar(props: { id: string; data: LinkData; x: number; y: number; lift: number; onEditLabel(): void }) {
  const { id, data } = props;
  const ctx = useWorkspace();
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const alone = useStore(onlyOneLinkSelected);
  const container = useStore((s) => s.domNode);
  const [open, setOpen] = useState<Popup | null>(null);
  const toggle = (p: Popup) => setOpen((o) => (o === p ? null : p));
  const close = useCallback(() => setOpen(null), []);
  if (!alone || !container) return null;

  const update = (patch: Partial<LinkData>) => ctx.updateLink(id, patch);
  const color = data.color ?? AUTO_COLOR;
  const fontSize = data.fontSize ?? DEFAULT_EDGE_FONT_SIZE;
  const fontWeight = data.fontWeight ?? DEFAULT_FONT_WEIGHT;
  const colorSlot =
    open === 'color'
      ? { key: 'color' as const, value: data.color }
      : open === 'labelColor'
        ? { key: 'labelColor' as const, value: data.labelColor }
        : open === 'labelBackground'
          ? { key: 'labelBackground' as const, value: data.labelBackground }
          : undefined;
  const dropdown = <T extends string | number>(popup: Popup, label: string, value: T, options: Option<T>[], onPick: (v: T) => void) => (
    <Dropdown compact label={label} value={value} options={options} open={open === popup} onToggle={() => toggle(popup)} onClose={close} onPick={onPick} />
  );

  const left = props.x * zoom + tx;
  const top = props.y * zoom + ty - 14 - props.lift * zoom;
  return createPortal(
    <div
      className="pw-link-toolbar"
      style={{ transform: `translate(${left}px, ${top}px) translate(-50%, -100%)` }}
      // Keep clicks here from reaching the link (it is this element's React parent) or the canvas.
      onPointerDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
    >
      {colorSlot && (
        <ToolbarPalette
          key={colorSlot.key}
          value={colorSlot.value}
          allowDefault
          allowNone={colorSlot.key === 'labelBackground'}
          defaultLabel="Automatic"
          onPick={(c) => update({ [colorSlot.key]: c })}
          onClose={close}
        />
      )}
      <div className="pw-node-toolbar-bar">
        <ToolbarButton label="Line color" active={open === 'color'} onClick={() => toggle('color')}>
          <span className="pw-stroke-icon" style={{ borderColor: color }} />
        </ToolbarButton>
        {dropdown('width', 'Thickness', data.width ?? DEFAULT_EDGE_WIDTH, WIDTH_OPTIONS, (w) => update({ width: w === DEFAULT_EDGE_WIDTH ? undefined : w }))}
        {dropdown('dash', 'Line style', data.dash ?? 'solid', DASH_OPTIONS, (dash) => update({ dash: dash === 'solid' ? undefined : dash }))}
        {dropdown('path', 'Path', data.path ?? DEFAULT_EDGE_PATH, PATH_OPTIONS, (path) => update({ path: path === DEFAULT_EDGE_PATH ? undefined : path }))}
        <span className="pw-node-toolbar-sep" />
        {dropdown('start', 'Start', data.startMarker ?? DEFAULT_START_MARKER, START_OPTIONS, (m) => update({ startMarker: m === DEFAULT_START_MARKER ? undefined : m }))}
        <ToolbarButton label="Reverse direction" onClick={() => ctx.reverseLink(id)}>
          <span className="codicon codicon-arrow-swap" />
        </ToolbarButton>
        {dropdown('end', 'End', data.endMarker ?? DEFAULT_END_MARKER, END_OPTIONS, (m) => update({ endMarker: m === DEFAULT_END_MARKER ? undefined : m }))}
        <span className="pw-node-toolbar-sep" />
        <ToolbarButton label={data.label ? 'Edit label (or double-click the link)' : 'Add a label (or double-click the link)'} onClick={props.onEditLabel}>
          <span className="codicon codicon-whole-word" />
        </ToolbarButton>
        <ToolbarButton label="Label color" active={open === 'labelColor'} onClick={() => toggle('labelColor')}>
          <span className="pw-text-color-icon">
            A
            <span className="pw-text-color-bar" style={{ background: data.labelColor ?? color }} />
          </span>
        </ToolbarButton>
        <ToolbarButton label="Label background" active={open === 'labelBackground'} onClick={() => toggle('labelBackground')}>
          {data.labelBackground && data.labelBackground !== 'none' ? (
            <span className="pw-swatch-dot" style={{ background: data.labelBackground }} />
          ) : (
            <span className="pw-swatch-dot default" />
          )}
        </ToolbarButton>
        <FontSizeField value={fontSize} open={open === 'size'} onToggle={() => toggle('size')} onClose={close} onPick={(size) => update({ fontSize: size })} />
        <Dropdown
          label="Font weight"
          value={fontWeight}
          options={FONT_WEIGHTS.map((w) => ({ value: w.value, label: w.label, style: { fontWeight: w.value } }))}
          open={open === 'weight'}
          onToggle={() => toggle('weight')}
          onClose={close}
          onPick={(w) => update({ fontWeight: w === DEFAULT_FONT_WEIGHT ? undefined : w })}
        />
        <span className="pw-node-toolbar-sep" />
        <ToolbarButton label="Delete link" onClick={() => ctx.removeLink(id)}>
          <span className="codicon codicon-trash" />
        </ToolbarButton>
      </div>
    </div>,
    container,
  );
}
