import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useStore } from '@xyflow/react';
import { toneOver } from './tone';
import { ColorPalette, ColorPopup } from './ColorPalette';
import { useWorkspace, type TagData, type TitleData } from './context';
import type { HeaderMenuItem } from './HeaderMenu';
import { NodeTags, resolveTags } from './Tags';

const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2];

/** Titles that start in edit mode when they (re)appear, e.g. "Rename title" on a hidden title. */
const editTitleOnMount = new Set<string>();

function editTitle(id: string) {
  editTitleOnMount.add(id);
  window.dispatchEvent(new CustomEvent('pw-edit-title', { detail: id }));
}

/** Show/hide, rename and reset entries for a file or editor menu. */
export function useTitleMenuItems(id: string, data: TitleData, defaultShown: boolean): HeaderMenuItem[] {
  const ctx = useWorkspace();
  const shown = data.showTitle ?? defaultShown;
  return [
    { icon: shown ? 'eye-closed' : 'eye', label: shown ? 'Hide title' : 'Show title', active: shown, onClick: () => ctx.updateTitle(id, { showTitle: !shown }) },
    {
      icon: 'edit',
      label: 'Rename title',
      onClick: () => {
        editTitle(id);
        if (!shown) ctx.updateTitle(id, { showTitle: true });
      },
    },
    ...(data.title !== undefined ? [{ icon: 'discard', label: 'Reset title', onClick: () => ctx.updateTitle(id, { title: undefined }) }] : []),
  ];
}

/**
 * A file or editor's title bar color: the menu entry ("Set title bar color" opens the palette below the header,
 * "Remove title bar color" once one is set), the header's props (attach `ref` to it) and the palette popup to render.
 * Without a color the header shows `surface` (a color, undefined = the theme's paper, at an opacity over the canvas);
 * either way its text and icons turn dark or light to stay readable.
 */
export function useHeaderColor(id: string, data: TitleData, surface: { color?: string; alpha: number } = { alpha: 1 }) {
  const ctx = useWorkspace();
  const ref = useRef<HTMLElement>(null);
  const [picking, setPicking] = useState(false);
  const close = useCallback(() => setPicking(false), []);
  const color = data.headerColor;
  const item: HeaderMenuItem = color
    ? { icon: 'symbol-color', label: 'Remove title bar color', active: true, onClick: () => ctx.updateTitle(id, { headerColor: undefined }) }
    : { icon: 'symbol-color', label: 'Set title bar color', onClick: () => setPicking(true) };
  const header = {
    ref,
    className: color ? ` colored ${toneOver({ color, alpha: 1 }, ctx.config.canvasBackground)}` : ` ${toneOver(surface, ctx.config.canvasBackground)}`,
    style: color ? { background: color } : undefined,
  };
  const picker = picking && ref.current && (
    <ColorPopup anchor={ref.current} onClose={close} below>
      <ColorPalette
        value={color}
        label="Title bar color"
        onChange={(c, final) => {
          ctx.updateTitle(id, { headerColor: c });
          if (final) close();
        }}
      />
    </ColorPopup>
  );
  return { item, header, picker };
}

/**
 * A file or folder's body color: menu entries ("Set body color" opens the palette below `header`, "Remove body color"
 * once one is set) and the palette popup to render. `offer` = false leaves out "Set body color" (a file with a single
 * snippet has no body to show it on); a color already set can still be removed.
 */
export function useBodyColor(id: string, color: string | undefined, header: RefObject<HTMLElement | null>, offer = true) {
  const ctx = useWorkspace();
  const [picking, setPicking] = useState(false);
  const close = useCallback(() => setPicking(false), []);
  const items: HeaderMenuItem[] = [
    // The body always has a color (the theme's until one is picked), so this entry is never shown as active.
    ...(offer ? [{ icon: 'paintcan', label: 'Set body color', onClick: () => setPicking(true) }] : []),
    ...(color ? [{ icon: 'discard', label: 'Remove body color', onClick: () => ctx.setBodyColor(id, undefined) }] : []),
  ];
  const picker = picking && header.current && (
    <ColorPopup anchor={header.current} onClose={close} below>
      <ColorPalette
        value={color}
        label="Body color"
        onChange={(c, final) => {
          ctx.setBodyColor(id, c);
          if (final) close();
        }}
      />
    </ColorPopup>
  );
  return { items, picker };
}

/**
 * A file or editor's name above its top-left corner, like frame names in Figma: it keeps the same size on screen
 * at any zoom, so it stays readable when zoomed far out, and is cut to the node's width. Double-click renames it
 * (an empty name goes back to the default text); dragging it moves the node.
 */
/**
 * `fallback` is the text shown while the title was not renamed (a file's base name, a snippet's first target line).
 * The paper's tags go where the workspace's tag placement says: on this row, right-aligned (wrapping upwards when they
 * don't fit, also shown when the title is hidden), or beside the paper on its right, bottom or left.
 */
export function NodeTitle(props: { id: string; data: TitleData & TagData; fallback: string; width: number; defaultShown: boolean }) {
  const { id, data } = props;
  const ctx = useWorkspace();
  const zoom = useStore(zoomSelector);
  const [editing, setEditing] = useState(() => editTitleOnMount.delete(id));
  useEffect(() => {
    const onRequest = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return;
      editTitleOnMount.delete(id);
      setEditing(true);
    };
    window.addEventListener('pw-edit-title', onRequest);
    return () => window.removeEventListener('pw-edit-title', onRequest);
  }, [id]);
  const shown = data.showTitle ?? props.defaultShown;
  // Hidden tags stay on the paper, they are just not drawn.
  const tags = ctx.showTags ? resolveTags(ctx.tags, data.tags) : [];
  const onRow = ctx.tagPlacement === 'top';
  // Counter the canvas zoom so the labels keep their screen size; widths in canvas units stay the node's.
  const scale = `scale(${1 / zoom})`;
  const side = !onRow && tags.length > 0 && (
    <div
      className={`pw-side-tags ${ctx.tagPlacement}`}
      style={{ transform: scale, ...(ctx.tagPlacement === 'bottom' ? { width: Math.max(0, props.width * zoom) } : {}) }}
    >
      <NodeTags id={id} tags={tags} />
    </div>
  );
  if (!shown && !(onRow && tags.length)) return side || null;
  const { fallback } = props;
  const text = data.title ?? fallback;
  return (
    <>
      <div className="pw-node-label-row" style={{ transform: scale, width: Math.max(0, props.width * zoom) }}>
        {shown && (
          <div
            className={`pw-node-title${editing ? ' editing' : ''}`}
            title={editing ? undefined : `${text} (double-click to rename)`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {editing ? <TitleInput id={id} value={text} fallback={fallback} onDone={() => setEditing(false)} /> : text}
          </div>
        )}
        {onRow && <NodeTags id={id} tags={tags} />}
      </div>
      {side}
    </>
  );
}

function TitleInput(props: { id: string; value: string; fallback: string; onDone(): void }) {
  const ctx = useWorkspace();
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(props.value);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = v.trim();
    // Empty or the default text itself: back to following the default.
    if (save && next !== props.value) ctx.updateTitle(props.id, { title: next && next !== props.fallback ? next : undefined });
    props.onDone();
  };
  useEffect(() => {
    ref.current!.focus();
    ref.current!.select();
  }, []);
  return (
    <input
      ref={ref}
      className="pw-node-title-input nodrag nowheel nopan"
      value={v}
      size={Math.max(4, v.length + 1)}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
    />
  );
}
