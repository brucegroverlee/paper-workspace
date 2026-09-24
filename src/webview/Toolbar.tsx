import { useEffect, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import {
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_FOCUS_PERCENT,
  DEFAULT_MIN_NODE_SIZE,
  FOCUS_PERCENT_CEILING,
  FOCUS_PERCENT_FLOOR,
  NODE_SIZE_CEILING,
  NODE_SIZE_FLOOR,
  clampFocusPercent,
  clampNodeSize,
} from '../shared/workspace';
import type { CanvasConfig } from '../shared/protocol';

export type Tool = 'select' | 'hand';
export type CreateKind = 'group' | 'text' | 'note' | 'media';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

export function Toolbar(props: {
  tool: Tool;
  onTool(t: Tool): void;
  onCreate(kind: CreateKind): void;
  onHelp(): void;
  shapesOpen: boolean;
  onShapes(): void;
  configOpen: boolean;
  onConfig(): void;
}) {
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);

  return (
    <div className="pw-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pw-tool-group">
        <ToolButton icon="hand" label="Hand — pan the canvas (H, or hold Space)" active={props.tool === 'hand'} onClick={() => props.onTool('hand')} />
        <ToolButton icon="cursor" label="Select — move papers and box-select (V)" active={props.tool === 'select'} onClick={() => props.onTool('select')} />
        <div className="pw-zoom-label" title="Zoom">{Math.round(zoom * 100)}%</div>
        <input
          className="pw-zoom-slider"
          type="range"
          aria-label="Zoom"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => rf.zoomTo(Number(e.target.value))}
        />
        <ToolButton icon="screen-full" label="Fit all papers (Shift+1)" onClick={() => rf.fitView({ padding: 0.15, duration: 250, maxZoom: 1 })} />
      </div>
      <div className="pw-tool-group">
        <ToolButton icon="primitive-square" label="Group — wraps the selection, or adds an empty group (Ctrl+G)" onClick={() => props.onCreate('group')} />
        <ToolButton icon="text-size" label="Text (T)" onClick={() => props.onCreate('text')} />
        <ToolButton icon="note" label="Sticky note (N)" onClick={() => props.onCreate('note')} />
        <ToolButton icon="file-media" label="Image or video from your computer (or paste one with Ctrl+V)" onClick={() => props.onCreate('media')} />
        <ToolButton icon="symbol-misc" label="Shapes — rectangles, flowchart symbols, arrows (S)" active={props.shapesOpen} onClick={props.onShapes} />
      </div>
      <div className="pw-tool-group">
        <ToolButton icon="settings-gear" label="Configuration" active={props.configOpen} onClick={props.onConfig} />
        <ToolButton icon="question" label="Help & shortcuts" onClick={props.onHelp} />
      </div>
    </div>
  );
}

export const ZOOM_LIMITS = { min: MIN_ZOOM, max: MAX_ZOOM };

function ToolButton(props: { icon: string; label: string; active?: boolean; disabled?: boolean; onClick?(): void }) {
  return (
    <button
      className={`pw-tool${props.active ? ' active' : ''}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className={`codicon codicon-${props.icon}`} />
    </button>
  );
}

type Range = { min: number; max: number; step: number; clamp(v: unknown): number };
const NODE_SIZE: Range = { min: NODE_SIZE_FLOOR, max: NODE_SIZE_CEILING, step: 10, clamp: clampNodeSize };
const FOCUS: Range = { min: FOCUS_PERCENT_FLOOR, max: FOCUS_PERCENT_CEILING, step: 5, clamp: clampFocusPercent };

const CONFIG_FIELDS: { key: 'minNodeWidth' | 'minNodeHeight' | 'focusPercent'; label: string; hint: string; range: Range }[] = [
  { key: 'minNodeWidth', label: 'Minimum node width', hint: 'px, for files and snippets', range: NODE_SIZE },
  { key: 'minNodeHeight', label: 'Minimum node height', hint: 'px, for files and snippets', range: NODE_SIZE },
  { key: 'focusPercent', label: 'Focus fill', hint: '% of the window a focused paper fills (higher zooms in more)', range: FOCUS },
];

/** Canvas configuration; values are VS Code settings (`paperWorkspace.*`), so they apply to every canvas. */
export function ConfigPanel(props: { config: CanvasConfig; onChange(patch: Partial<CanvasConfig>): void; onClose(): void }) {
  return (
    <div className="pw-config" role="dialog" aria-label="Configuration" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pw-config-title">
        Configuration
        <button className="pw-icon" onClick={props.onClose} aria-label="Close" title="Close">
          <span className="codicon codicon-close" />
        </button>
      </div>
      {CONFIG_FIELDS.map((f) => (
        <NumberField
          key={f.key}
          label={f.label}
          hint={f.hint}
          range={f.range}
          value={props.config[f.key]}
          onCommit={(v) => props.onChange({ [f.key]: v })}
        />
      ))}
      <ColorField
        label="Canvas background"
        value={props.config.canvasBackground}
        defaultValue={DEFAULT_CANVAS_BACKGROUND}
        onCommit={(canvasBackground) => props.onChange({ canvasBackground })}
      />
      <button
        className="pw-config-reset"
        onClick={() =>
          props.onChange({
            minNodeWidth: DEFAULT_MIN_NODE_SIZE,
            minNodeHeight: DEFAULT_MIN_NODE_SIZE,
            focusPercent: DEFAULT_FOCUS_PERCENT,
            canvasBackground: DEFAULT_CANVAS_BACKGROUND,
          })
        }
      >
        Reset to defaults
      </button>
    </div>
  );
}

/** Number input that commits a clamped value on Enter or blur, and shows the value in effect otherwise. */
function NumberField(props: { label: string; hint: string; range: Range; value: number; onCommit(v: number): void }) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = () => {
    const v = props.range.clamp(draft);
    setDraft(String(v));
    if (v !== props.value) props.onCommit(v);
  };
  return (
    <label className="pw-config-field">
      <span className="pw-config-label">{props.label}</span>
      <input
        type="number"
        min={props.range.min}
        max={props.range.max}
        step={props.range.step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(String(props.value));
        }}
      />
      <span className="pw-config-hint">{props.hint}</span>
    </label>
  );
}

/** Color picker plus a hex text box; the picker previews live, both commit the value. */
function ColorField(props: { label: string; value: string; defaultValue: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = (raw: string) => {
    const hex = `#${raw.trim().replace(/^#/, '')}`;
    const next = /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : props.value;
    setDraft(next);
    if (next !== props.value) props.onCommit(next);
  };
  return (
    <div className="pw-config-field wide">
      <span className="pw-config-label">{props.label}</span>
      <div className="pw-config-color">
        <label className="pw-config-swatch" style={{ background: props.value }} title="Pick a color">
          <input type="color" value={props.value} onChange={(e) => props.onCommit(e.target.value.toLowerCase())} aria-label={props.label} />
        </label>
        <input
          type="text"
          value={draft}
          spellCheck={false}
          maxLength={7}
          aria-label={`${props.label} (hex)`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(draft);
            if (e.key === 'Escape') setDraft(props.value);
          }}
        />
      </div>
      <span className="pw-config-hint">
        Applies to every canvas.{' '}
        {props.value !== props.defaultValue && (
          <button className="pw-config-link" onClick={() => props.onCommit(props.defaultValue)}>
            Use default grey
          </button>
        )}
      </span>
    </div>
  );
}

export function HelpOverlay(props: { onClose(): void }) {
  const rows: [string, string][] = [
    ['Add code', 'Select lines in an editor → Ctrl+Alt+P, or Explorer → "Add to Paper Workspace"'],
    ['Drop files', 'Hold Shift while dragging files from the Explorer onto the canvas'],
    ['Edit & scroll', 'Each snippet is a full editor: scroll, edit, Ctrl+S saves the layout and all changed files'],
    ['Add snippet', '＋ on a file header adds another editor for that file (seeded with your selection)'],
    ['Target', 'Pin sets a snippet’s target to the selection (or visible lines); ◎ / the pill scrolls back to it'],
    ['Group', 'Ctrl+G wraps the selection in a group (or adds an empty one); drag nodes in or out by dropping them; Ctrl+Shift+G ungroups'],
    ['Text & notes', 'T adds text, N a sticky note; double-click to edit, Esc or Ctrl+Enter to finish'],
    ['Shapes', 'The shapes button (S) opens the shape library: click a shape to add it, or drag it onto the canvas or into a group; double-click a shape to label it'],
    ['Copy & paste', 'Ctrl+C / Ctrl+X copy or cut the selected groups, text, notes, shapes and media; Ctrl+V pastes at the pointer (as often as you like); Ctrl+D duplicates'],
    ['Media', 'Toolbar image button, Ctrl+V with an image on the clipboard, or drop image/video files'],
    ['Colors & fonts', 'Select a group, text, note or shape and use the toolbar above it; the canvas background is in the ⚙ configuration panel'],
    ['Resize', 'Select a node and drag its handles (the minimum size is in the ⚙ configuration panel)'],
    ['Move', 'Drag a file or snippet by its header; groups, text, notes and media anywhere'],
    ['Pan', 'Scroll over the canvas, middle-drag, hold Space, or use the Hand tool (H)'],
    ['Zoom', 'Ctrl + scroll (also over code), pinch, or the zoom slider'],
    ['Fit all', 'Shift+1'],
    ['Remove', 'Select a file or snippet and press Delete (the source file is not touched)'],
    ['Open in editor', 'Double-click a file header'],
  ];
  return (
    <div className="pw-help" role="dialog" aria-label="Paper Workspace help" onClick={props.onClose}>
      <div className="pw-help-card" onClick={(e) => e.stopPropagation()}>
        <div className="pw-help-title">
          Paper Workspace
          <button className="pw-icon" onClick={props.onClose} aria-label="Close">
            <span className="codicon codicon-close" />
          </button>
        </div>
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
