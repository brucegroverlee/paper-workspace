import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStore, type FitViewOptions } from '@xyflow/react';
import {
  DEFAULT_CANVAS_BACKGROUND,
  FOCUS_PERCENT_CEILING,
  FOCUS_PERCENT_FLOOR,
  NODE_SIZE_CEILING,
  NODE_SIZE_FLOOR,
  clampFocusPercent,
  clampNodeSize,
  DEFAULT_NEW_FILE_SIZE,
} from '../shared/workspace';
import { DEFAULT_CANVAS_CONFIG, type CanvasConfig } from '../shared/protocol';
import { MenuPopup } from './HeaderMenu';
import type { SnapshotScope } from './snapshot';

export type Tool = 'select' | 'hand';
export type CreateKind = 'group' | 'text' | 'note' | 'media';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

/**
 * Turns a fitView padding fraction into per-side pixels that keep the fitted content clear of the toolbar:
 * the area right of the toolbar is fitted the way fitView would fit the whole pane, so the gap between the
 * toolbar and the content matches the gap on the right.
 */
export function clearOfToolbar(padding: number): FitViewOptions['padding'] {
  const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
  const bar = document.querySelector('.pw-toolbar')?.getBoundingClientRect();
  if (!pane || !pane.width || !pane.height) return padding;
  const inset = bar ? Math.max(0, bar.right - pane.left) : 0;
  const width = Math.max(1, pane.width - inset);
  const x = (width - width / (1 + padding)) / 2;
  const y = (pane.height - pane.height / (1 + padding)) / 2;
  return { left: `${inset + x}px`, right: `${x}px`, top: `${y}px`, bottom: `${y}px` };
}

export function Toolbar(props: {
  tool: Tool;
  onTool(t: Tool): void;
  onCreate(kind: CreateKind): void;
  onHelp(): void;
  shapesOpen: boolean;
  onShapes(): void;
  configOpen: boolean;
  onConfig(): void;
  onViewSource(): void;
  minimapOpen: boolean;
  onMinimap(): void;
  tagsOpen: boolean;
  onTags(): void;
  /** A snapshot is being taken (the button is disabled until it is handed to the host). */
  snapshotBusy: boolean;
  onSnapshot(scope: SnapshotScope): void;
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
        <ToolButton icon="screen-full" label="Fit all papers (Shift+1)" onClick={() => rf.fitView({ padding: clearOfToolbar(0.15), duration: 250, maxZoom: 1 })} />
      </div>
      <div className="pw-tool-group">
        <ToolButton icon="primitive-square" label="Group — wraps the selection, or adds an empty group (Ctrl+G)" onClick={() => props.onCreate('group')} />
        <ToolButton icon="text-size" label="Text (T)" onClick={() => props.onCreate('text')} />
        <ToolButton icon="note" label="Sticky note (N)" onClick={() => props.onCreate('note')} />
        <ToolButton icon="file-media" label="Image or video from your computer (or paste one with Ctrl+V)" onClick={() => props.onCreate('media')} />
        <ToolButton icon="symbol-misc" label="Shapes — rectangles, flowchart symbols, arrows (S)" active={props.shapesOpen} onClick={props.onShapes} />
      </div>
      <div className="pw-tool-group">
        <ToolButton icon="tag" label="Tags — rename, recolor or create this workspace's tags" active={props.tagsOpen} onClick={props.onTags} />
        <SnapshotButton busy={props.snapshotBusy} onSnapshot={props.onSnapshot} />
        <ToolButton icon="file-code" label="View the workspace file's source" onClick={props.onViewSource} />
        <ToolButton icon="map" label={props.minimapOpen ? 'Hide the minimap' : 'Show the minimap'} active={props.minimapOpen} onClick={props.onMinimap} />
        <ToolButton icon="settings-gear" label="Configuration" active={props.configOpen} onClick={props.onConfig} />
        <ToolButton icon="question" label="Help & shortcuts" onClick={props.onHelp} />
      </div>
    </div>
  );
}

export const ZOOM_LIMITS = { min: MIN_ZOOM, max: MAX_ZOOM };

/** Monaco's bundled codicon font has no "hand" glyph, so the pan tool draws its own (16px, like a codicon). */
const HAND_ICON = (
  <svg className="pw-tool-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 11V6a2 2 0 0 0-4 0v5" />
    <path d="M14 10V4a2 2 0 0 0-4 0v6" />
    <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
);

/** Camera button with a menu: snapshot of what is on screen, or of every paper in the workspace. */
function SnapshotButton(props: { busy: boolean; onSnapshot(scope: SnapshotScope): void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const toggle = () => {
    if (menu) return setMenu(null);
    const r = ref.current!.getBoundingClientRect();
    setMenu({ x: r.right + 8, y: r.top }); // beside the toolbar, like its panels
  };
  return (
    <>
      <ToolButton
        buttonRef={ref}
        icon={props.busy ? 'loading' : 'device-camera'}
        label={props.busy ? 'Taking a snapshot…' : 'Snapshot — save the current view or the whole workspace as an image'}
        active={!!menu}
        disabled={props.busy}
        onClick={toggle}
      />
      {menu && (
        <MenuPopup
          anchor={menu}
          items={[
            { icon: 'screen-normal', label: 'Snapshot of the current view', onClick: () => props.onSnapshot('view') },
            { icon: 'screen-full', label: 'Snapshot of the whole workspace', onClick: () => props.onSnapshot('workspace') },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

function ToolButton(props: {
  icon: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?(): void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={props.buttonRef}
      className={`pw-tool${props.active ? ' active' : ''}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon === 'hand' ? HAND_ICON : <span className={`codicon codicon-${props.icon}${props.icon === 'loading' ? ' codicon-modifier-spin' : ''}`} />}
    </button>
  );
}

type Range = { min: number; max: number; step: number; clamp(v: unknown): number };
const NODE_SIZE: Range = { min: NODE_SIZE_FLOOR, max: NODE_SIZE_CEILING, step: 10, clamp: clampNodeSize };
const NEW_FILE_WIDTH: Range = { ...NODE_SIZE, clamp: (v) => clampNodeSize(v, DEFAULT_NEW_FILE_SIZE.width) };
const NEW_FILE_HEIGHT: Range = { ...NODE_SIZE, clamp: (v) => clampNodeSize(v, DEFAULT_NEW_FILE_SIZE.height) };
const FOCUS: Range = { min: FOCUS_PERCENT_FLOOR, max: FOCUS_PERCENT_CEILING, step: 5, clamp: clampFocusPercent };

const CONFIG_FIELDS: { key: 'minNodeWidth' | 'minNodeHeight' | 'newFileWidth' | 'newFileHeight' | 'focusPercent'; label: string; hint: string; range: Range }[] = [
  { key: 'minNodeWidth', label: 'Minimum node width', hint: 'px, for files and snippets', range: NODE_SIZE },
  { key: 'minNodeHeight', label: 'Minimum node height', hint: 'px, for files and snippets', range: NODE_SIZE },
  { key: 'newFileWidth', label: 'New file width', hint: 'px, for files added from the Explorer (snippets from a selection fit their lines)', range: NEW_FILE_WIDTH },
  { key: 'newFileHeight', label: 'New file height', hint: 'px, for files added from the Explorer', range: NEW_FILE_HEIGHT },
  { key: 'focusPercent', label: 'Focus fill', hint: '% of the window a focused paper fills (higher zooms in more)', range: FOCUS },
];

const TITLE_FIELDS: { key: 'showFileTitleByDefault' | 'showEditorTitleByDefault'; label: string; hint: string }[] = [
  { key: 'showFileTitleByDefault', label: 'Show file title by default', hint: 'for newly added file papers' },
  { key: 'showEditorTitleByDefault', label: 'Show editor title by default', hint: 'for newly added snippet editors' },
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
      {TITLE_FIELDS.map((f) => (
        <label key={f.key} className="pw-config-field pw-config-check">
          <span className="pw-config-label">{f.label}</span>
          <input type="checkbox" checked={props.config[f.key]} onChange={(e) => props.onChange({ [f.key]: e.target.checked })} />
          <span className="pw-config-hint">{f.hint}</span>
        </label>
      ))}
      <button className="pw-config-reset" onClick={() => props.onChange(DEFAULT_CANVAS_CONFIG)}>
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
    ['Add code', 'Select lines in an editor → Ctrl+Alt+P, or right-click a file or folder in the Explorer → "Add to Paper Workspace"'],
    ['Drop files', 'Hold Shift while dragging files or folders from the Explorer onto the canvas'],
    ['Edit & scroll', 'Each snippet is a full editor: scroll, edit, Ctrl+click to go to a definition; Ctrl+S saves the layout and all changed files'],
    ['Add snippet', '⋮ (or right-click) on a file header → Add a snippet editor: another editor for that file, seeded with your selection'],
    ['Target', '⋮ (or right-click) → Set target to selection (or the visible lines), or Clear target; ◎ or the "Back to" pill scrolls back to it'],
    ['Folders', 'A folder is a container like a group: files added from that folder go inside it; its header button reveals it in the Explorer'],
    ['Group', 'Ctrl+G wraps the selection in a group (or adds an empty one); drag nodes in or out by dropping them; Ctrl+Shift+G ungroups'],
    ['Text & notes', 'T adds text, N a sticky note; double-click to edit, Esc or Ctrl+Enter to finish'],
    ['Shapes', 'The shapes button (S) opens the shape library: click a shape to add it, or drag it onto the canvas or into a group; double-click a shape to label it'],
    ['Links', 'Hover a node and drag from a dot on any side onto another node (or its side); select a link to change its color, thickness, line style, path, arrow heads and label; double-click it to write the label; drag an end to reconnect it'],
    ['Copy & paste', 'Ctrl+C / Ctrl+X copy or cut the selected groups, text, notes, shapes and media; Ctrl+V pastes at the pointer (as often as you like); Ctrl+D duplicates'],
    ['Tags', 'Right-click a file, snippet or folder → Add a tag (or Edit tags): pick tags or type a new one; the × on a chip removes it. The tag button in the toolbar edits all of this workspace’s tags'],
    ['Titles & captions', 'Double-click a title to rename it; ⋮ (or right-click) shows or hides it, sets the title bar and body colors, and adds an annotation. Right-click the empty canvas to show or hide all titles or tags'],
    ['Lock', 'Right-click a file, snippet, folder or group → Lock (or the lock button in a group’s toolbar): it and everything inside it can’t be moved, resized, edited or deleted, and its code is read-only. A lock icon shows before its title; Unlock from the same menu'],
    ['Copy reference', 'Right-click any paper, note, text, shape, group or image → Copy reference, then paste it into an AI chat so it knows which item you mean (right-click the empty canvas for the whole workspace)'],
    ['Media', 'Toolbar image button, Ctrl+V with an image on the clipboard, or drop image/video files'],
    ['Colors & fonts', 'Select a group, text, note or shape and use the toolbar above it; the canvas background is in the ⚙ configuration panel'],
    ['Resize', 'Select a node and drag its handles (the minimum size is in the ⚙ configuration panel)'],
    ['Move', 'Drag a file or snippet by its header; folders, groups, text, notes, shapes and media anywhere'],
    ['Select', 'Select tool (V): drag on the empty canvas to box-select; Shift or Ctrl+click adds to the selection'],
    ['Pan', 'Scroll over the canvas, middle- or right-drag, hold Space, or use the Hand tool (H)'],
    ['Zoom', 'Ctrl + scroll (also over code), pinch, or the zoom slider'],
    ['Focus', 'Double-click a header (or ⋮ → Focus on this paper) to zoom to it; the zoom level is in the ⚙ configuration panel'],
    ['Fit all', 'Shift+1 or the fit button in the toolbar'],
    ['Snapshot', 'The camera button saves the current view, or every paper in the workspace, as a PNG image where you choose'],
    ['Remove', 'Select a node and press Delete, or use × on its header (the source file is not touched)'],
    ['Open in editor', 'The go-to-file button on a file or snippet header opens it in a text editor at its target'],
    ['Snapshot', 'The camera button saves the current view or the whole workspace as an image'],
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
