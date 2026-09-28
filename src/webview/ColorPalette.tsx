// The color picker: a grid of swatches (greys, bright hues, six rows of shades), then the workspace's custom colors
// with a "+" for any color and, where the host supports it, an eyedropper. Use `ColorPalette` inline or
// `ColorPickerButton` for a swatch that opens it in a popup. Custom colors are shared by every picker of the workspace.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { COLOR_GRID, isLightColor } from '../shared/workspace';
import { useWorkspace } from './context';

const inGrid = (c: string) => COLOR_GRID.some((row) => row.includes(c));

/** Chromium's EyeDropper API (not in the DOM typings yet). */
type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };
const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

/** `#rrggbb`, lowercase; `rgb(r, g, b)` (what some eyedroppers return) is converted. */
function toHex(c: string): string | undefined {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(c);
  return m ? `#${m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : undefined;
}

function Swatch(props: { color: string; selected: boolean; onPick(color: string, final: boolean): void }) {
  const { color, selected } = props;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={color}
      title={color}
      className={`pw-palette-swatch${selected ? ' selected' : ''}`}
      style={{ background: color, color: isLightColor(color) ? '#1f2328' : '#ffffff' }}
      onClick={() => props.onPick(color, true)}
    >
      {selected && <span className="codicon codicon-check" />}
    </button>
  );
}

/**
 * The palette itself. `onChange` gets every pick; `final` is false for the live previews while the custom picker is
 * dragged. Colors finished in the custom picker or taken with the eyedropper are also added to the workspace's custom row.
 */
export function ColorPalette(props: { value: string | undefined; onChange(color: string, final: boolean): void; label?: string }) {
  const ctx = useWorkspace();
  const value = props.value?.toLowerCase();
  const custom = useRef<HTMLInputElement>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  // The native input fires `input` while dragging (a live preview) and `change` once the picker closes (keep it).
  useEffect(() => {
    const el = custom.current!;
    const done = () => ctx.addCustomColor(el.value.toLowerCase());
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [ctx]);

  const eyedrop = async () => {
    if (!EyeDropper) return;
    try {
      const hex = toHex((await new EyeDropper().open()).sRGBHex);
      if (!hex) return;
      onChange.current(hex, true);
      ctx.addCustomColor(hex);
    } catch {
      /* cancelled with Escape */
    }
  };

  // A current color that is neither in the grid nor saved still shows (selected) at the start of the custom row.
  const customs = value && !inGrid(value) && !ctx.customColors.includes(value) ? [value, ...ctx.customColors] : ctx.customColors;
  return (
    <div className="pw-palette" role="radiogroup" aria-label={props.label ?? 'Color'}>
      <div className="pw-palette-grid">
        {COLOR_GRID.map((row, i) => (
          <div key={i} className={`pw-palette-row${i < 2 ? ' spaced' : ''}`}>
            {row.map((c) => (
              <Swatch key={c} color={c} selected={c === value} onPick={props.onChange} />
            ))}
          </div>
        ))}
      </div>
      <div className="pw-palette-heading">Custom</div>
      <div className="pw-palette-row wrap">
        {customs.map((c) => (
          <Swatch key={c} color={c} selected={c === value} onPick={props.onChange} />
        ))}
        <label className="pw-palette-add" title="Custom color…">
          <span className="codicon codicon-add" />
          <input
            ref={custom}
            type="color"
            aria-label="Custom color"
            value={value && /^#[0-9a-f]{6}$/.test(value) ? value : '#000000'}
            onChange={(e) => props.onChange(e.target.value.toLowerCase(), false)}
          />
        </label>
      </div>
      {EyeDropper && (
        <button type="button" className="pw-palette-eyedropper" title="Pick a color from the screen" aria-label="Pick a color from the screen" onClick={eyedrop}>
          {EYEDROPPER_ICON}
        </button>
      )}
    </div>
  );
}

/** The codicon font has no eyedropper, so it is drawn (16px, like a codicon). */
const EYEDROPPER_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.2 2.6a1.9 1.9 0 0 1 2.7 2.7l-1.4 1.4.7.7-1.1 1.1-3.4-3.4 1.1-1.1.7.7z" />
    <path d="M7.6 5.7 2.9 10.4l-.6 2.4.9.9 2.4-.6 4.7-4.7" />
  </svg>
);

/**
 * A swatch button that opens the palette in a popup below it (above when there is no room), kept in the window and
 * rendered in the document body so dialogs and zoomed nodes don't clip it. Closes on a pick (swatch or eyedropper),
 * Escape or a click elsewhere; the custom picker previews live and leaves it open.
 */
export function ColorPickerButton(props: { value: string; onChange(color: string): void; label: string; className?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`pw-color-button${open ? ' open' : ''} ${props.className ?? ''}`}
        style={{ background: props.value }}
        title={props.label}
        aria-label={props.label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <ColorPopup anchor={button.current!} onClose={close}>
          <ColorPalette
            value={props.value}
            label={props.label}
            onChange={(c, final) => {
              props.onChange(c);
              if (final) close();
            }}
          />
        </ColorPopup>
      )}
    </>
  );
}

/**
 * Opens below `anchor`, or above it when there is no room below. `below` always opens below, right against it (a title bar's palette):
 * when the window is too short it moves up just enough to stay on screen rather than jump above the anchor.
 */
export function ColorPopup(props: { anchor: HTMLElement; onClose(): void; children: React.ReactNode; below?: boolean }) {
  const { anchor, onClose, below: alwaysBelow } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    // A title bar's palette sits right against the bar; other popups keep a little room from their button.
    const below = a.bottom + (alwaysBelow ? 0 : 6);
    const top = !alwaysBelow && below + r.height > window.innerHeight - 4 ? a.top - 6 - r.height : below;
    setPos({
      left: Math.max(4, Math.min(a.left, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(top, window.innerHeight - r.height - 4)),
    });
  }, [anchor, alwaysBelow]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    // Capture: Escape closes only the popup, not a dialog it was opened from.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={ref} className="pw-color-popup" style={pos ?? { left: 0, top: 0, visibility: 'hidden' }} onPointerDown={(e) => e.stopPropagation()}>
      {props.children}
    </div>,
    document.body,
  );
}
