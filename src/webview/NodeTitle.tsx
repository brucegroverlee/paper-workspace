import { useEffect, useRef, useState } from 'react';
import { useStore } from '@xyflow/react';
import { useWorkspace, type TitleData } from './context';
import type { HeaderMenuItem } from './HeaderMenu';

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
 * A file or editor's name above its top-left corner, like frame names in Figma: it keeps the same size on screen
 * at any zoom, so it stays readable when zoomed far out, and is cut to the node's width. Double-click renames it
 * (an empty name goes back to the default text); dragging it moves the node.
 */
/** `fallback` is the text shown while the title was not renamed (a file's base name, a snippet's first target line). */
export function NodeTitle(props: { id: string; data: TitleData; fallback: string; width: number; defaultShown: boolean }) {
  const { id, data } = props;
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
  if (!(data.showTitle ?? props.defaultShown)) return null;
  const { fallback } = props;
  const text = data.title ?? fallback;
  return (
    <div
      className={`pw-node-title${editing ? ' editing' : ''}`}
      // Counter the canvas zoom so the label keeps its screen size; its width in canvas units stays the node's.
      style={{ transform: `scale(${1 / zoom})`, maxWidth: Math.max(0, props.width * zoom) }}
      title={editing ? undefined : `${text} (double-click to rename)`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      {editing ? <TitleInput id={id} value={text} fallback={fallback} onDone={() => setEditing(false)} /> : text}
    </div>
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
