// "More actions" button for paper title bars: the less used actions live in a popup styled like the node toolbar.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type HeaderMenuItem = { icon: string; label: string; onClick(): void; active?: boolean; danger?: boolean } | 'separator';

/** Drop falsy entries and leading, trailing or doubled separators, so callers can build the list with `cond && item`. */
function tidy(items: (HeaderMenuItem | false | null | undefined)[]) {
  const out: HeaderMenuItem[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item === 'separator' && (!out.length || out[out.length - 1] === 'separator')) continue;
    out.push(item);
  }
  if (out[out.length - 1] === 'separator') out.pop();
  return out;
}

export function HeaderMenu(props: { items: (HeaderMenuItem | false | null | undefined)[] }) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={button}
        className={`pw-icon nodrag${open ? ' active' : ''}`}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <span className="codicon codicon-kebab-vertical" />
      </button>
      {open && <Popup anchor={button.current!} items={tidy(props.items)} onClose={close} />}
    </>
  );
}

/**
 * Rendered in the document body: nodes live inside the canvas transform (and headers clip their overflow), so the menu
 * would otherwise scale with the zoom and be cut off. Closes on a pick, Escape, a click elsewhere or wheel.
 * Not on window blur: the click that opens it can also select the paper, and the host's Explorer reveal for that
 * selection briefly takes focus from the webview, which would close the menu right after it opened.
 */
function Popup(props: { anchor: HTMLElement; items: HeaderMenuItem[]; onClose(): void }) {
  const { anchor, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Below the button, right-aligned with it; above it when there is no room below. Kept inside the window.
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const r = ref.current!.getBoundingClientRect();
    const below = a.bottom + 6;
    const top = below + r.height > window.innerHeight - 4 ? Math.max(4, a.top - 6 - r.height) : below;
    setPos({ left: Math.max(4, Math.min(a.right - r.width, window.innerWidth - r.width - 4)), top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', onClose, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onClose, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="pw-header-menu"
      role="menu"
      style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="pw-header-menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`pw-header-menu-item${item.active ? ' active' : ''}${item.danger ? ' danger' : ''}`}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            <span className={`codicon codicon-${item.icon}`} />
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
