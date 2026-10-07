// Paper menus: the "more actions" button in title bars and the right-click menu share these entries and this popup,
// styled like the node toolbar.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type HeaderMenuItem =
  | { icon: string; label: string; onClick(): void; active?: boolean; danger?: boolean; disabled?: boolean }
  | { icon: string; label: string; submenu: MenuEntries; disabled?: boolean }
  | 'separator';
export type MenuEntries = (HeaderMenuItem | false | null | undefined)[];

/** Drop falsy entries and leading, trailing or doubled separators, so callers can build the list with `cond && item`. */
function tidy(items: MenuEntries) {
  const out: HeaderMenuItem[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item === 'separator' && (!out.length || out[out.length - 1] === 'separator')) continue;
    out.push(item);
  }
  if (out[out.length - 1] === 'separator') out.pop();
  return out;
}

/** `items` is called while the menu is open, so entries that depend on the canvas (stacking order) are current. */
export function HeaderMenu(props: { items(): MenuEntries }) {
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
      {open && <MenuPopup anchor={button.current!} items={props.items()} onClose={close} />}
    </>
  );
}

/**
 * Rendered in the document body: nodes live inside the canvas transform (and headers clip their overflow), so the menu
 * would otherwise scale with the zoom and be cut off. Opens below a button (`anchor`) or at a point (right-click).
 * Closes on a pick, Escape, a click elsewhere or wheel.
 * Not on window blur: the click that opens it can also select the paper, and the host's Explorer reveal for that
 * selection briefly takes focus from the webview, which would close the menu right after it opened.
 */
export function MenuPopup(props: { anchor: HTMLElement | { x: number; y: number }; items: MenuEntries; onClose(): void }) {
  const { anchor, onClose } = props;
  const items = tidy(props.items);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const x = anchor instanceof HTMLElement ? undefined : anchor.x;
  const y = anchor instanceof HTMLElement ? undefined : anchor.y;

  // A button's menu goes below it, right-aligned, or above it when there is no room below; a point's menu starts
  // there. Kept inside the window.
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    const fit = (left: number, top: number) => ({
      left: Math.max(4, Math.min(left, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(top, window.innerHeight - r.height - 4)),
    });
    if (x !== undefined && y !== undefined) return setPos(fit(x, y));
    const a = (anchor as HTMLElement).getBoundingClientRect();
    const below = a.bottom + 6;
    setPos(fit(a.right - r.width, below + r.height > window.innerHeight - 4 ? a.top - 6 - r.height : below));
  }, [anchor, x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !(anchor instanceof HTMLElement && anchor.contains(t))) onClose();
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
      <MenuItems items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

function MenuItems(props: { items: HeaderMenuItem[]; onClose(): void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      {props.items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="pw-header-menu-sep" role="separator" />
        ) : 'submenu' in item ? (
          <SubMenu key={i} item={item} open={open === i} onOpen={(o) => setOpen(o ? i : null)} onClose={props.onClose} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`pw-header-menu-item${item.active ? ' active' : ''}${item.danger ? ' danger' : ''}`}
            disabled={item.disabled}
            onPointerEnter={() => setOpen(null)}
            onClick={() => {
              props.onClose();
              item.onClick();
            }}
          >
            <span className={`codicon codicon-${item.icon}`} />
            {item.label}
          </button>
        ),
      )}
    </>
  );
}

/**
 * An entry that opens more entries beside it on hover or click (right of the menu, or left when there is no room).
 * The panel is a child of the menu, so a click in it does not count as a click elsewhere.
 */
function SubMenu(props: { item: Extract<HeaderMenuItem, { submenu: MenuEntries }>; open: boolean; onOpen(open: boolean): void; onClose(): void }) {
  const { item, open, onOpen } = props;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const a = button.current!.getBoundingClientRect();
    const r = panel.current!.getBoundingClientRect();
    const left = a.right + r.width + 4 <= window.innerWidth ? a.right + 2 : a.left - r.width - 2;
    setPos({ left: Math.max(4, left), top: Math.max(4, Math.min(a.top - 5, window.innerHeight - r.height - 4)) });
  }, [open]);
  return (
    <>
      <button
        ref={button}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`pw-header-menu-item${open ? ' open' : ''}`}
        disabled={item.disabled}
        onPointerEnter={() => onOpen(true)}
        onClick={() => onOpen(!open)}
      >
        <span className={`codicon codicon-${item.icon}`} />
        {item.label}
        <span className="codicon codicon-chevron-right pw-header-menu-more" />
      </button>
      {open && (
        <div ref={panel} className="pw-header-menu" role="menu" style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}>
          <MenuItems items={tidy(item.submenu)} onClose={props.onClose} />
        </div>
      )}
    </>
  );
}
