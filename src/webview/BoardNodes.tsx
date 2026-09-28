// Board nodes: groups (titled, colored areas holding other nodes), floating text, sticky notes, diagram shapes and media.
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { NodeResizer, NodeResizeControl, NodeToolbar, Position, ResizeControlVariant, useStore, type NodeProps } from '@xyflow/react';
import {
  DEFAULT_NOTE_COLOR,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_NOTE_FONT_SIZE,
  DEFAULT_SHAPE_FILL,
  DEFAULT_SHAPE_FONT_SIZE,
  DEFAULT_SHAPE_STROKE,
  DEFAULT_TEXT_FONT_SIZE,
  DEFAULT_GROUP_FONT_SIZE,
  DEFAULT_GROUP_FONT_WEIGHT,
  FONT_SIZES,
  FONT_WEIGHTS,
  GROUP_PADDING,
  GROUP_TITLE_POSITIONS,
  GROUP_BORDER_STYLES,
  GROUP_BORDER_WIDTHS,
  DEFAULT_GROUP_BORDER_WIDTH,
  type GroupBorderStyle,
  groupHeaderHeight,
  type GroupTitlePosition,
  NODE_SIZE_FLOOR,
  PALETTE,
  clampFontSize,
  isLightColor,
  isVideoPath,
} from '../shared/workspace';
import { baseName } from '../shared/paths';
import { useWorkspace, type RFGroupNode, type RFMediaNode, type RFShapeNode, type RFTextNode } from './context';
import { shapeDef, textBoxOf, type ShapeDef } from './shapes';
import { NodeHandles } from './handles';

/** Nodes that start in edit mode when they mount (just created). */
const editOnMount = new Set<string>();
export function editWhenMounted(id: string) {
  editOnMount.add(id);
}

function useEditing(id: string) {
  const [editing, setEditing] = useState(() => editOnMount.delete(id));
  return [editing, setEditing] as const;
}

export const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

// ---- group ----------------------------------------------------------------------------------------

/** Smallest size that still contains every child, as "WxH" (a string keeps the selector stable). */
function useChildrenExtent(id: string) {
  const extent = useStore((s) => {
    let w = 0;
    let h = 0;
    for (const n of s.nodes) {
      if (n.parentId !== id || n.hidden) continue;
      w = Math.max(w, n.position.x + (n.width ?? n.measured?.width ?? 0) + GROUP_PADDING);
      h = Math.max(h, n.position.y + (n.height ?? n.measured?.height ?? 0) + GROUP_PADDING);
    }
    return `${Math.round(w)}x${Math.round(h)}`;
  });
  const [w, h] = extent.split('x').map(Number);
  return { w, h };
}

export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<RFGroupNode>) {
  const ctx = useWorkspace();
  const [editing, setEditing] = useEditing(id);
  const extent = useChildrenExtent(id);
  const borderStyle = data.strokeStyle ?? 'solid';
  const borderWidth = data.strokeWidth ?? DEFAULT_GROUP_BORDER_WIDTH;
  const style = {
    ...(data.color ? { '--pw-group-color': data.color } : {}),
    ...(data.strokeColor ? { '--pw-group-line': data.strokeColor } : {}),
    borderStyle,
    borderWidth: borderStyle === 'none' ? 0 : borderWidth,
  } as CSSProperties;
  const tone = data.color ? (isLightColor(data.color) ? ' on-light' : ' on-dark') : '';
  const fontSize = data.fontSize ?? DEFAULT_GROUP_FONT_SIZE;
  const fontWeight = data.fontWeight ?? DEFAULT_GROUP_FONT_WEIGHT;
  const position = data.titlePosition ?? 'top-left';
  const [vertical, horizontal] = position.split('-');
  const bar = groupHeaderHeight(fontSize);
  const titleFont: CSSProperties = { fontSize, fontWeight, color: data.textColor };

  return (
    <>
      <div
        className={`pw-group title-${vertical} title-${horizontal}${selected ? ' selected' : ''}${data.color ? ' colored' : ''}${tone}`}
        style={style}
        // Double-click on the empty body (not the title or a child) focuses the group.
        onDoubleClick={(e) => e.target === e.currentTarget && ctx.focusNode(id)}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          e.stopPropagation();
          ctx.openNodeMenu(id, e.clientX, e.clientY);
        }}
      >
        <NodeResizer
          isVisible={selected}
          minWidth={Math.max(ctx.config.minNodeWidth, extent.w)}
          minHeight={Math.max(ctx.config.minNodeHeight, extent.h + (vertical === 'bottom' ? bar - GROUP_PADDING / 2 : 0))}
          lineClassName="pw-resize-line"
          handleClassName="pw-resize-handle"
        />
        <BoardToolbar
          id={id}
          colors={[
            { key: 'color', kind: 'background', value: data.color, allowDefault: true },
            { key: 'strokeColor', kind: 'stroke', label: 'Border color', value: data.strokeColor, allowDefault: true },
            { key: 'textColor', kind: 'text', label: 'Title color', value: data.textColor, allowDefault: true },
          ]}
          border={{ width: borderWidth, style: borderStyle }}
          font={{ size: fontSize, weight: fontWeight, defaultWeight: DEFAULT_GROUP_FONT_WEIGHT }}
          titlePosition={position}
          annotation={data.annotation}
          group
        />
        <NodeHandles />
        <header
          className="pw-group-header"
          style={{ height: bar }}
          onDoubleClick={() => setEditing(true)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            ctx.openNodeMenu(id, e.clientX, e.clientY);
          }}
        >
          {editing ? (
            <TitleInput
              value={data.title}
              style={titleFont}
              onDone={(title) => {
                setEditing(false);
                if (title !== data.title) ctx.updateData(id, { title });
              }}
            />
          ) : (
            <span className={`pw-group-title${data.title ? '' : ' empty'}`} style={data.title ? titleFont : { fontSize }} title="Double-click to rename">
              {data.title || 'Untitled group'}
            </span>
          )}
        </header>
      </div>
      <Annotation id={id} value={data.annotation} />
    </>
  );
});

function TitleInput(props: { value: string; style?: CSSProperties; onDone(v: string): void }) {
  const [v, setV] = useState(props.value);
  const done = useRef(false);
  const finish = (value: string) => {
    if (done.current) return;
    done.current = true;
    props.onDone(value.trim());
  };
  return (
    <input
      className="pw-group-title-input nodrag"
      style={props.style}
      value={v}
      autoFocus
      placeholder="Group title"
      onFocus={(e) => e.target.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(v);
        if (e.key === 'Escape') finish(props.value);
      }}
    />
  );
}

// ---- text & note ----------------------------------------------------------------------------------

/** Floating text (no background, grows with its content) or a sticky note (colored, fixed size, grows if needed). */
export const TextNode = memo(function TextNode({ id, type, data, selected, height }: NodeProps<RFTextNode>) {
  const ctx = useWorkspace();
  const [editing, setEditing] = useEditing(id);
  const note = type === 'note';
  const contentRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(height);
  heightRef.current = height;
  const fontSize = data.fontSize ?? (note ? DEFAULT_NOTE_FONT_SIZE : DEFAULT_TEXT_FONT_SIZE);
  const fontWeight = data.fontWeight ?? DEFAULT_FONT_WEIGHT;
  const bg = note ? data.color ?? DEFAULT_NOTE_COLOR : undefined;
  const autoText = bg && isLightColor(bg) ? '#1f2328' : '#f0f0f0';
  const style = {
    fontSize,
    fontWeight,
    ...(note ? { background: bg, color: data.textColor ?? autoText } : { color: data.color }),
  } as CSSProperties;

  // Text nodes are exactly as tall as their content; notes only grow when the content no longer fits.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const fit = () => {
      const needed = Math.max(NODE_SIZE_FLOOR, Math.ceil(el.scrollHeight + (note ? 24 : 0)));
      const current = heightRef.current ?? 0;
      if (note ? needed > current + 1 : Math.abs(needed - current) > 1) ctx.setHeight(id, needed);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ctx, id, note, editing]);

  const finish = (text: string) => {
    setEditing(false);
    if (!note && !text.trim()) ctx.remove(id); // an emptied floating text disappears, like in other whiteboards
    else if (text !== data.text) ctx.updateData(id, { text });
  };

  return (
    <div
      className={`pw-text-node ${note ? 'pw-note' : 'pw-text'}${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
      style={style}
      onDoubleClick={() => setEditing(true)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        ctx.openNodeMenu(id, e.clientX, e.clientY);
      }}
    >
      {note ? (
        <NodeResizer isVisible={selected && !editing} minWidth={60} minHeight={40} lineClassName="pw-resize-line" handleClassName="pw-resize-handle" />
      ) : (
        selected &&
        !editing && (
          <>
            <NodeResizeControl position={Position.Left} variant={ResizeControlVariant.Line} resizeDirection="horizontal" minWidth={40} className="pw-resize-line" />
            <NodeResizeControl position={Position.Right} variant={ResizeControlVariant.Line} resizeDirection="horizontal" minWidth={40} className="pw-resize-line" />
          </>
        )
      )}
      <BoardToolbar
        id={id}
        colors={
          note
            ? [
                { key: 'color', kind: 'background', value: data.color, fallback: DEFAULT_NOTE_COLOR },
                { key: 'textColor', kind: 'text', value: data.textColor, allowDefault: true, fallback: autoText },
              ]
            : [{ key: 'color', kind: 'text', value: data.color, allowDefault: true }]
        }
        font={{ size: fontSize, weight: fontWeight }}
      />
      <NodeHandles />
      <div ref={contentRef} className="pw-text-content">
        {editing ? (
          <TextEditor value={data.text} onDone={finish} />
        ) : data.text ? (
          data.text
        ) : (
          <span className="pw-text-placeholder">{note ? 'Double-click to write' : 'Text'}</span>
        )}
      </div>
    </div>
  );
});

export function TextEditor(props: { value: string; onDone(v: string): void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [v, setV] = useState(props.value);
  const done = useRef(false);
  const finish = (value: string) => {
    if (done.current) return;
    done.current = true;
    props.onDone(value);
  };
  useLayoutEffect(() => {
    const el = ref.current!;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }, [v]);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      className="pw-text-input nodrag nowheel nopan"
      value={v}
      rows={1}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onPointerDown={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) finish(v);
      }}
    />
  );
}

// ---- annotation -----------------------------------------------------------------------------------

/** Annotations that start in edit mode when they appear (just turned on). */
const editAnnotationOnMount = new Set<string>();

/** Turn a node's annotation on (and start typing in it) or off (removing its text). */
export function useToggleAnnotation(id: string, value: string | undefined) {
  const ctx = useWorkspace();
  return () => {
    if (value !== undefined) return ctx.setAnnotation(id, undefined);
    editAnnotationOnMount.add(id);
    ctx.setAnnotation(id, '');
  };
}

/**
 * Optional caption centered below a file, group, shape or media node, like the caption under an image in an article.
 * It hangs outside the node's box, so it never changes the node's size; `inline` puts it in the normal flow instead.
 */
export function Annotation(props: { id: string; value?: string; inline?: boolean }) {
  // Mount the caption only while there is an annotation, so turning it on starts editing (see useToggleAnnotation).
  return props.value === undefined ? null : <AnnotationCaption id={props.id} value={props.value} inline={props.inline} />;
}

function AnnotationCaption(props: { id: string; value: string; inline?: boolean }) {
  const ctx = useWorkspace();
  const [editing, setEditing] = useState(() => editAnnotationOnMount.delete(props.id));
  return (
    <div
      className={`pw-annotation${props.inline ? ' inline' : ''}${editing ? ' editing' : ''}`}
      title={editing ? undefined : 'Annotation (double-click to edit)'}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {editing ? (
        <TextEditor
          value={props.value}
          onDone={(annotation) => {
            setEditing(false);
            if (annotation !== props.value) ctx.setAnnotation(props.id, annotation);
          }}
        />
      ) : props.value ? (
        props.value
      ) : (
        <span className="pw-text-placeholder">Add an annotation</span>
      )}
    </div>
  );
}

// ---- shape ----------------------------------------------------------------------------------------

const SHAPE_STROKE_WIDTH = 2;

/** A shape drawn at its pixel size, so outlines keep their width and corners their radius when it is resized. */
export function ShapeSvg(props: { def: ShapeDef; width: number; height: number; fill: string; stroke: string; strokeWidth?: number; className?: string }) {
  const w = Math.max(1, props.width);
  const h = Math.max(1, props.height);
  return (
    <svg className={props.className} width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible" aria-hidden>
      {props.def.parts(w, h).map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill={p.fill ? props.fill : 'none'}
          stroke={props.stroke}
          strokeWidth={props.strokeWidth ?? SHAPE_STROKE_WIDTH}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

/** A diagram shape from the shapes panel, with a centered label (double-click to edit). */
export const ShapeNode = memo(function ShapeNode({ id, data, selected, width, height }: NodeProps<RFShapeNode>) {
  const ctx = useWorkspace();
  const [editing, setEditing] = useEditing(id);
  const def = shapeDef(data.shape);
  const w = width ?? def.size.width;
  const h = height ?? def.size.height;
  const noFill = data.color === 'none';
  const fill = noFill ? 'transparent' : data.color ?? DEFAULT_SHAPE_FILL;
  const onCanvas = noFill || !!def.labelBelow;
  // Lines over the canvas (no fill, a stick figure) default to the canvas's text color so they stay visible.
  const autoStroke = noFill || def.outline ? 'var(--pw-canvas-fg)' : DEFAULT_SHAPE_STROKE;
  const stroke = data.strokeColor ?? autoStroke;
  // A label under the shape, or inside one without fill, sits on the canvas; otherwise it must read on the fill.
  const autoText = onCanvas ? undefined : isLightColor(fill) ? '#1f2328' : '#f0f0f0';
  const fontSize = data.fontSize ?? DEFAULT_SHAPE_FONT_SIZE;
  const fontWeight = data.fontWeight ?? DEFAULT_FONT_WEIGHT;
  const box = textBoxOf(def, w, h);
  const labelStyle: CSSProperties = {
    fontSize,
    fontWeight,
    color: data.textColor ?? autoText,
    ...(def.labelBelow ? { left: -60, right: -60, top: '100%' } : { left: box.x, top: box.y, width: box.width, height: box.height }),
  };

  const finish = (text: string) => {
    setEditing(false);
    if (text !== data.text) ctx.updateData(id, { text });
  };

  // Under a stick figure the label already sits below the shape, so the annotation follows it there.
  const annotation = <Annotation id={id} value={data.annotation} inline={def.labelBelow} />;

  return (
    <>
      <div
        className={`pw-shape${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
        onDoubleClick={() => setEditing(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.openNodeMenu(id, e.clientX, e.clientY);
        }}
      >
        <NodeResizer isVisible={selected && !editing} minWidth={NODE_SIZE_FLOOR} minHeight={NODE_SIZE_FLOOR} lineClassName="pw-resize-line" handleClassName="pw-resize-handle" />
        <BoardToolbar
          id={id}
          colors={[
            { key: 'color', kind: 'background', label: 'Fill color', value: data.color, fallback: DEFAULT_SHAPE_FILL, allowNone: true },
            { key: 'strokeColor', kind: 'stroke', label: 'Line color', value: data.strokeColor, fallback: autoStroke, allowDefault: true },
            { key: 'textColor', kind: 'text', value: data.textColor, allowDefault: true, fallback: autoText ?? '#f0f0f0' },
          ]}
          font={{ size: fontSize, weight: fontWeight }}
          annotation={data.annotation}
        />
        <NodeHandles />
        <ShapeSvg className="pw-shape-svg" def={def} width={w} height={h} fill={fill} stroke={stroke} />
        <div className={`pw-shape-label${def.labelBelow ? ' below' : ''}${onCanvas && !data.textColor ? ' on-canvas' : ''}`} style={labelStyle}>
          {editing ? <TextEditor value={data.text} onDone={finish} /> : data.text}
          {def.labelBelow && annotation}
        </div>
      </div>
      {!def.labelBelow && annotation}
    </>
  );
});

// ---- media ----------------------------------------------------------------------------------------

export const MediaNode = memo(function MediaNode({ id, data, selected }: NodeProps<RFMediaNode>) {
  const ctx = useWorkspace();
  const [failed, setFailed] = useState(false);
  const video = isVideoPath(data.src) || data.src.startsWith('data:video/');
  const url = ctx.mediaUrl(data.src);
  useEffect(() => setFailed(false), [url]);

  return (
    <>
      <div
        className={`pw-media${selected ? ' selected' : ''}${video ? ' video' : ''}`}
        // A video's own controls keep their double-click.
        onDoubleClick={(e) => (e.target as HTMLElement).tagName !== 'VIDEO' && ctx.focusNode(id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.openNodeMenu(id, e.clientX, e.clientY);
        }}
      >
        <NodeResizer isVisible={selected} keepAspectRatio minWidth={40} minHeight={40} lineClassName="pw-resize-line" handleClassName="pw-resize-handle" />
        <BoardToolbar id={id} annotation={data.annotation} />
        <NodeHandles />
        {video && (
          <div className="pw-media-grip" title={data.src}>
            <span className="codicon codicon-device-camera-video" />
            <span className="pw-media-name">{baseName(data.src)}</span>
          </div>
        )}
        {failed || !url ? (
          <div className="pw-media-error">
            <span className="codicon codicon-warning" />
            Cannot show {data.src.startsWith('data:') ? 'this media' : baseName(data.src)}
          </div>
        ) : video ? (
          <video className="nodrag nowheel" src={url} controls preload="metadata" onError={() => setFailed(true)} />
        ) : (
          <img src={url} alt={baseName(data.src)} draggable={false} onError={() => setFailed(true)} />
        )}
      </div>
      <Annotation id={id} value={data.annotation} />
    </>
  );
});

// ---- floating toolbar (colors, font size & weight, delete) ---------------------------------------------

type ColorSlot = {
  key: 'color' | 'textColor' | 'strokeColor';
  /** What the color changes: shown as a dot (background), a hollow square (stroke) or an underlined "A" (text). */
  kind: 'background' | 'stroke' | 'text';
  /** Button tooltip (defaults to "Background color" / "Text color"). */
  label?: string;
  value?: string;
  /** Offer "Theme default" / "Automatic" (clears the value). */
  allowDefault?: boolean;
  /** Offer "No fill" (the value `'none'`). */
  allowNone?: boolean;
  /** Color in effect when `value` is undefined, for the button preview. */
  fallback?: string;
};

type Popup = ColorSlot['key'] | 'size' | 'weight' | 'titlePosition' | 'borderStyle' | 'borderWidth';

const BORDER_STYLE_LABELS: Record<GroupBorderStyle, string> = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', none: 'No border' };

/** A little box drawn with the border style and thickness. */
const BorderIcon = ({ style = 'solid', width = 1.5 }: { style?: GroupBorderStyle; width?: number }) => (
  <span className={`pw-border-icon${style === 'none' ? ' none' : ''}`} style={{ borderStyle: style === 'none' ? 'dashed' : style, borderWidth: Math.min(width, 4) }} />
);

const BORDER_STYLE_OPTIONS: Option<GroupBorderStyle>[] = GROUP_BORDER_STYLES.map((s) => ({ value: s, label: BORDER_STYLE_LABELS[s], icon: <BorderIcon style={s} /> }));
const BORDER_WIDTH_OPTIONS: Option<number>[] = GROUP_BORDER_WIDTHS.map((w) => ({ value: w, label: `${w} px`, icon: <BorderIcon width={w} /> }));

const TITLE_POSITION_LABELS: Record<GroupTitlePosition, string> = {
  'top-left': 'Top left',
  'top-center': 'Top center',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom center',
  'bottom-right': 'Bottom right',
};

/** A little box with a bar where the title sits. */
const TitlePositionIcon = ({ position }: { position: GroupTitlePosition }) => (
  <span className={`pw-title-pos-icon ${position.split('-').map((p) => `title-${p}`).join(' ')}`}>
    <span />
  </span>
);

/**
 * Passing `annotation` (the node's current one, even undefined) adds the annotation toggle; text and notes leave it out.
 * `font.defaultWeight` is the weight stored as undefined (default: regular); `titlePosition` adds the group title position picker;
 * `border` adds border style and thickness pickers after the border color.
 */
function BoardToolbar(props: {
  id: string;
  colors?: ColorSlot[];
  font?: { size: number; weight: number; defaultWeight?: number };
  titlePosition?: GroupTitlePosition;
  border?: { width: number; style: GroupBorderStyle };
  group?: boolean;
  annotation?: string;
}) {
  const ctx = useWorkspace();
  const [open, setOpen] = useState<Popup | null>(null);
  const toggle = (p: Popup) => setOpen((o) => (o === p ? null : p));
  const close = useCallback(() => setOpen(null), []);
  const slot = props.colors?.find((c) => c.key === open);
  const toggleAnnotation = useToggleAnnotation(props.id, props.annotation);
  const annotatable = 'annotation' in props;

  return (
    <NodeToolbar position={Position.Top} offset={10} className="pw-node-toolbar" onPointerDown={stop} onDoubleClick={stop}>
      {slot && (
        <ColorPalette
          key={slot.key}
          value={slot.value}
          allowDefault={slot.allowDefault}
          allowNone={slot.allowNone}
          defaultLabel={slot.key === 'color' ? 'Theme default' : 'Automatic'}
          onPick={(color) => ctx.updateData(props.id, { [slot.key]: color })}
          onClose={close}
        />
      )}
      <div className="pw-node-toolbar-bar">
        {props.colors?.map((c) => {
          const shown = c.value === 'none' ? undefined : c.value ?? c.fallback;
          const border = c.kind === 'stroke' && props.border;
          return (
            <Fragment key={c.key}>
              <ToolbarButton
                label={c.label ?? (c.kind === 'text' ? 'Text color' : 'Background color')}
                active={open === c.key}
                onClick={() => toggle(c.key)}
              >
                {c.kind === 'text' ? (
                  <span className="pw-text-color-icon">
                    A
                    <span className={`pw-text-color-bar${shown ? '' : ' default'}`} style={shown ? { background: shown } : undefined} />
                  </span>
                ) : c.kind === 'stroke' ? (
                  <span className="pw-stroke-icon" style={shown ? { borderColor: shown } : undefined} />
                ) : (
                  <span className={`pw-swatch-dot${shown ? '' : ' default'}`} style={shown ? { background: shown } : undefined} />
                )}
              </ToolbarButton>
              {border && (
                <>
                  <Dropdown
                    compact
                    label="Border style"
                    value={border.style}
                    options={BORDER_STYLE_OPTIONS}
                    open={open === 'borderStyle'}
                    onToggle={() => toggle('borderStyle')}
                    onClose={close}
                    onPick={(s) => ctx.updateData(props.id, { strokeStyle: s === 'solid' ? undefined : s })}
                  />
                  {border.style !== 'none' && (
                    <Dropdown
                      compact
                      label="Border thickness"
                      value={border.width}
                      options={BORDER_WIDTH_OPTIONS}
                      open={open === 'borderWidth'}
                      onToggle={() => toggle('borderWidth')}
                      onClose={close}
                      onPick={(w) => ctx.updateData(props.id, { strokeWidth: w === DEFAULT_GROUP_BORDER_WIDTH ? undefined : w })}
                    />
                  )}
                  <span className="pw-node-toolbar-sep" />
                </>
              )}
            </Fragment>
          );
        })}
        {props.font && (
          <>
            <span className="pw-node-toolbar-sep" />
            <FontSizeField
              value={props.font.size}
              open={open === 'size'}
              onToggle={() => toggle('size')}
              onClose={close}
              onPick={(fontSize) => ctx.updateData(props.id, { fontSize })}
            />
            <Dropdown
              label="Font weight"
              value={props.font.weight}
              options={FONT_WEIGHTS.map((w) => ({ value: w.value, label: w.label, style: { fontWeight: w.value } }))}
              open={open === 'weight'}
              onToggle={() => toggle('weight')}
              onClose={close}
              onPick={(fontWeight) => ctx.updateData(props.id, { fontWeight: fontWeight === (props.font?.defaultWeight ?? DEFAULT_FONT_WEIGHT) ? undefined : fontWeight })}
            />
            {props.titlePosition && (
              <Dropdown
                compact
                label="Title position"
                value={props.titlePosition}
                options={GROUP_TITLE_POSITIONS.map((p) => ({ value: p, label: TITLE_POSITION_LABELS[p], icon: <TitlePositionIcon position={p} /> }))}
                open={open === 'titlePosition'}
                onToggle={() => toggle('titlePosition')}
                onClose={close}
                onPick={(titlePosition) => ctx.updateData(props.id, { titlePosition: titlePosition === 'top-left' ? undefined : titlePosition })}
              />
            )}
            <span className="pw-node-toolbar-sep" />
          </>
        )}
        {annotatable && (
          <ToolbarButton label={props.annotation !== undefined ? 'Remove annotation' : 'Add annotation'} active={props.annotation !== undefined} onClick={toggleAnnotation}>
            <span className="codicon codicon-comment" />
          </ToolbarButton>
        )}
        {props.group && (
          <ToolbarButton label="Ungroup (keep the content)" onClick={() => ctx.ungroup(props.id)}>
            <span className="codicon codicon-ungroup-by-ref-type" />
          </ToolbarButton>
        )}
        <ToolbarButton label={props.group ? 'Delete group and its content' : 'Delete'} onClick={() => ctx.remove(props.id)}>
          <span className="codicon codicon-trash" />
        </ToolbarButton>
      </div>
    </NodeToolbar>
  );
}

export function ToolbarButton(props: { label: string; active?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button className={`pw-node-toolbar-button${props.active ? ' active' : ''}`} title={props.label} aria-label={props.label} aria-pressed={props.active} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

/** Close a popup on Escape or on a pointer down outside `ref`'s parent (the popup and the control that opened it). */
function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [ref, onClose]);
}

/** Popups open above the toolbar, or below it when there is no room at the top of the window. */
function useFlipBelow(ref: RefObject<HTMLElement | null>) {
  const [below, setBelow] = useState(false);
  useLayoutEffect(() => {
    if (ref.current && ref.current.getBoundingClientRect().top < 4) setBelow(true);
  }, [ref]);
  return below;
}

/** Editable font size (any value in range, committed on Enter/blur) with a dropdown of common sizes. */
export function FontSizeField(props: { value: number; open: boolean; onToggle(): void; onClose(): void; onPick(size: number): void }) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = (raw: string) => {
    const v = clampFontSize(raw);
    setDraft(String(v ?? props.value));
    if (v !== undefined && v !== props.value) props.onPick(v);
  };
  return (
    <div className="pw-dropdown pw-font-size">
      <input
        className="pw-font-size-input nodrag"
        value={draft}
        inputMode="numeric"
        title="Font size (px): type a value or pick one"
        aria-label="Font size"
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit(draft);
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(String(props.value));
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            commit(String((clampFontSize(draft) ?? props.value) + (e.key === 'ArrowUp' ? 1 : -1)));
          }
        }}
      />
      <button className={`pw-dropdown-toggle${props.open ? ' active' : ''}`} title="Font sizes" aria-label="Font sizes" aria-expanded={props.open} onClick={props.onToggle}>
        <span className="codicon codicon-chevron-down" />
      </button>
      {props.open && (
        <DropdownMenu
          label="Font size"
          value={props.value}
          options={FONT_SIZES.map((v) => ({ value: v, label: String(v) }))}
          onPick={(v) => {
            props.onPick(v);
            props.onClose();
          }}
          onClose={props.onClose}
        />
      )}
    </div>
  );
}

export type Option<T extends string | number = number> = { value: T; label: string; style?: CSSProperties; icon?: ReactNode };

/** A dropdown button; `compact` shows only the current option's icon (options with icons show them in the menu too). */
export function Dropdown<T extends string | number>(props: {
  label: string;
  value: T;
  options: Option<T>[];
  compact?: boolean;
  open: boolean;
  onToggle(): void;
  onClose(): void;
  onPick(v: T): void;
}) {
  const current = props.options.find((o) => o.value === props.value);
  return (
    <div className="pw-dropdown">
      <button
        className={`pw-dropdown-button${props.compact ? ' compact' : ''}${props.open ? ' active' : ''}`}
        title={current ? `${props.label}: ${current.label}` : props.label}
        aria-label={props.label}
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        {props.compact && current?.icon ? current.icon : <span style={current?.style}>{current?.label ?? props.value}</span>}
        <span className="codicon codicon-chevron-down" />
      </button>
      {props.open && (
        <DropdownMenu
          label={props.label}
          value={props.value}
          options={props.options}
          onPick={(v) => {
            props.onPick(v);
            props.onClose();
          }}
          onClose={props.onClose}
        />
      )}
    </div>
  );
}

function DropdownMenu<T extends string | number>(props: { label: string; value: T; options: Option<T>[]; onPick(v: T): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, props.onClose);
  const below = useFlipBelow(ref);
  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div ref={ref} className={`pw-dropdown-menu nowheel${below ? ' below' : ''}`} role="listbox" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.value}
          role="option"
          aria-selected={o.value === props.value}
          className={`pw-dropdown-item${o.value === props.value ? ' active' : ''}`}
          style={o.style}
          onClick={() => props.onPick(o.value)}
        >
          <span className={`codicon codicon-check${o.value === props.value ? '' : ' hidden'}`} />
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorPalette(props: {
  value?: string;
  allowDefault?: boolean;
  allowNone?: boolean;
  defaultLabel: string;
  onPick(color: string | undefined): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, props.onClose);
  const below = useFlipBelow(ref);
  const value = props.value?.toLowerCase();
  const swatch = (c: string) => (
    <button
      key={c}
      className={`pw-swatch${value === c ? ' active' : ''}`}
      style={{ background: c }}
      title={c}
      aria-label={`Color ${c}`}
      onClick={() => props.onPick(c)}
    />
  );
  return (
    <div ref={ref} className={`pw-palette${below ? ' below' : ''}`} role="dialog" aria-label="Colors">
      <div className="pw-palette-row">{PALETTE.dark.map(swatch)}</div>
      <div className="pw-palette-row">{PALETTE.light.map(swatch)}</div>
      <div className="pw-palette-footer">
        {props.allowDefault && (
          <button className={`pw-palette-link${value ? '' : ' active'}`} onClick={() => props.onPick(undefined)}>
            <span className={`pw-swatch-dot default`} /> {props.defaultLabel}
          </button>
        )}
        {props.allowNone && (
          <button className={`pw-palette-link${value === 'none' ? ' active' : ''}`} onClick={() => props.onPick('none')}>
            <span className={`pw-swatch-dot default`} /> No fill
          </button>
        )}
        <label className="pw-palette-link" title="Pick any color">
          <span className="codicon codicon-symbol-color" /> Custom…
          <input type="color" value={value && value !== 'none' ? value : '#888888'} onChange={(e) => props.onPick(e.target.value.toLowerCase())} />
        </label>
      </div>
    </div>
  );
}
