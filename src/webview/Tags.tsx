// Workspace tags: chips on file and editor papers, the picker that sets a paper's tags, and the dialog that edits them all.
// Tags are defined in the .workspace file (per workspace), papers refer to them by id.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@xyflow/react';
import { TAG_LABEL_MAX, TAG_PLACEMENTS, isLightColor, newId, tagColorFor, type TagPlacement, type WorkspaceTag } from '../shared/workspace';
import { useWorkspace, type TagData } from './context';
import type { HeaderMenuItem } from './HeaderMenu';
import { ColorPickerButton } from './ColorPalette';

/** The workspace tags `ids` refer to, in their order (unknown ids are skipped). */
export function resolveTags(all: WorkspaceTag[], ids: string[] | undefined): WorkspaceTag[] {
  if (!ids?.length) return [];
  const byId = new Map(all.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is WorkspaceTag => !!t);
}

/** Menu entry of a file or editor that opens its tag picker. */
export function useTagMenuItem(id: string, data: TagData): HeaderMenuItem {
  const ctx = useWorkspace();
  const has = resolveTags(ctx.tags, data.tags).length > 0;
  return { icon: 'tag', label: has ? 'Edit tags' : 'Add a tag', onClick: () => ctx.openTagPicker(id) };
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Drawn rather than the codicon glyph, which reads as a letter "x" at chip size. */
const CLOSE_ICON = (
  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
    <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export function TagChip(props: { tag: WorkspaceTag; onRemove?(): void; title?: string }) {
  const { tag, onRemove } = props;
  return (
    <span
      className={`pw-tag${onRemove ? ' removable' : ''}`}
      style={{ background: tag.color, color: isLightColor(tag.color) ? '#1f2328' : '#f5f5f5' }}
      title={props.title ?? tag.label}
    >
      <span className="pw-tag-label">{tag.label}</span>
      {onRemove && (
        <button
          className="pw-tag-remove nodrag"
          title={`Remove “${tag.label}”`}
          aria-label={`Remove tag ${tag.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {CLOSE_ICON}
        </button>
      )}
    </span>
  );
}

/** A paper's tags, shown right-aligned on its title row; the × on a chip takes that tag off the paper (not while it is locked). */
export function NodeTags(props: { id: string; tags: WorkspaceTag[]; locked?: boolean }) {
  const ctx = useWorkspace();
  if (!props.tags.length) return null;
  const ids = props.tags.map((t) => t.id);
  return (
    <div className="pw-node-tags" onDoubleClick={(e) => e.stopPropagation()}>
      {props.tags.map((t) => (
        <TagChip key={t.id} tag={t} onRemove={props.locked ? undefined : () => ctx.setNodeTags(props.id, ids.filter((x) => x !== t.id))} />
      ))}
    </div>
  );
}

/**
 * Publishes the canvas zoom as `--pw-zoom`, so the captions under papers with tags at the bottom can move down by one
 * chip row (chips keep their screen size, captions scale with the canvas). Its own component: zooming re-renders only it.
 */
export function ZoomCssVar() {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => document.documentElement.style.setProperty('--pw-zoom', String(zoom)), [zoom]);
  return null;
}

const PLACEMENT_LABELS: Record<TagPlacement, { label: string; icon: string }> = {
  right: { label: 'Right', icon: 'arrow-right' },
  bottom: { label: 'Bottom', icon: 'arrow-down' },
  left: { label: 'Left', icon: 'arrow-left' },
  top: { label: 'Title row', icon: 'arrow-up' },
};

/** Backdrop and card shared by both dialogs; Escape or a click outside cancels. */
function Dialog(props: { title: string; onClose(): void; children: React.ReactNode; className?: string }) {
  return (
    <div
      className="pw-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div className={`pw-dialog-card ${props.className ?? ''}`}>
        <div className="pw-dialog-title">
          {props.title}
          <button className="pw-icon" onClick={props.onClose} aria-label="Close" title="Close">
            <span className="codicon codicon-close" />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

type PickerOption = { kind: 'tag'; tag: WorkspaceTag } | { kind: 'create'; label: string };

/**
 * Pick the tags of one paper: type to filter the workspace tags or to name a new one (with its color), Enter adds the
 * highlighted option, Backspace in the empty field removes the last chip. Nothing changes until Save.
 */
export function TagPickerDialog(props: { tags: WorkspaceTag[]; selected: string[]; onSave(ids: string[], created: WorkspaceTag[]): void; onClose(): void }) {
  const ctx = useWorkspace();
  const [chosen, setChosen] = useState(() => resolveTags(props.tags, props.selected).map((t) => t.id));
  const [created, setCreated] = useState<WorkspaceTag[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const all = useMemo(() => [...props.tags, ...created], [props.tags, created]);
  const [color, setColor] = useState(() => tagColorFor(props.tags.length));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const q = query.trim().slice(0, TAG_LABEL_MAX);
  const exact = q ? all.find((t) => sameLabel(t.label, q)) : undefined;
  const options: PickerOption[] = [
    ...all.filter((t) => !chosen.includes(t.id) && t.label.toLowerCase().includes(q.toLowerCase())).map((tag) => ({ kind: 'tag' as const, tag })),
    ...(q && !exact ? [{ kind: 'create' as const, label: q }] : []),
  ];
  const current = Math.min(active, options.length - 1);

  const add = (id: string) => {
    setChosen((c) => (c.includes(id) ? c : [...c, id]));
    setQuery('');
    setActive(0);
    input.current?.focus();
  };
  const create = (label: string) => {
    const tag = { id: newId('tag'), label, color };
    setCreated((c) => [...c, tag]);
    setColor(tagColorFor(props.tags.length + created.length + 1));
    add(tag.id);
  };
  const pick = (o: PickerOption | undefined) => (o?.kind === 'tag' ? add(o.tag.id) : o ? create(o.label) : undefined);
  const save = () => props.onSave(chosen, created.filter((t) => chosen.includes(t.id)));

  return (
    <Dialog title="Tags" onClose={props.onClose} className="pw-tag-picker">
      <div className="pw-tag-field" onPointerDown={(e) => e.target === e.currentTarget && (e.preventDefault(), input.current?.focus())}>
        {resolveTags(all, chosen).map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => setChosen((c) => c.filter((x) => x !== t.id))} />
        ))}
        <input
          ref={input}
          value={query}
          maxLength={TAG_LABEL_MAX}
          placeholder={chosen.length ? 'Add another tag…' : 'Type to find or create a tag…'}
          aria-label="Tag name"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return save();
            if (e.key === 'Enter') {
              e.preventDefault();
              if (exact && chosen.includes(exact.id)) setQuery('');
              else pick(options[current]);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (options.length) setActive((current + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
            } else if (e.key === 'Backspace' && !query && chosen.length) {
              setChosen((c) => c.slice(0, -1));
            }
          }}
        />
      </div>
      {options.length > 0 && (
        <div className="pw-tag-options" role="listbox" aria-label="Tags">
          {options.map((o, i) => (
            <button
              key={o.kind === 'tag' ? o.tag.id : 'create'}
              role="option"
              aria-selected={i === current}
              className={`pw-tag-option${i === current ? ' active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keep the caret in the field
              onClick={() => pick(o)}
            >
              {o.kind === 'tag' ? (
                <TagChip tag={o.tag} />
              ) : (
                <>
                  <span className="codicon codicon-add" />
                  Create <TagChip tag={{ id: '', label: o.label, color }} />
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {q && !exact && (
        <div className="pw-dialog-inline">
          <span className="pw-dialog-label">Color of the new tag</span>
          <ColorPickerButton value={color} onChange={setColor} label="Color of the new tag" />
        </div>
      )}
      {!all.length && !q && <div className="pw-dialog-hint">This workspace has no tags yet: type a name to create the first one.</div>}
      {!ctx.showTags && <div className="pw-dialog-hint">Tags are hidden on the canvas: right-click the canvas → Show tags.</div>}
      <div className="pw-dialog-actions">
        <button className="pw-button" onClick={props.onClose}>
          Cancel
        </button>
        <button className="pw-button primary" onClick={save}>
          Save
        </button>
      </div>
    </Dialog>
  );
}

/** Every tag of the workspace: rename, recolor, delete (also takes it off its papers) or create. Nothing changes until Save. */
export function TagManagerDialog(props: {
  tags: WorkspaceTag[];
  placement: TagPlacement;
  usage: Map<string, number>;
  onSave(tags: WorkspaceTag[], placement: TagPlacement): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(props.tags);
  const [placement, setPlacement] = useState(props.placement);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(() => tagColorFor(props.tags.length));
  const newInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!props.tags.length) newInput.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const problem = (t: WorkspaceTag) =>
    !t.label.trim() ? 'A tag needs a name' : draft.some((o) => o.id !== t.id && sameLabel(o.label, t.label)) ? 'Another tag has this name' : undefined;
  const invalid = draft.some((t) => problem(t));
  const newProblem = newLabel.trim() && draft.some((t) => sameLabel(t.label, newLabel)) ? 'A tag with this name exists' : undefined;
  const removedUses = props.tags.filter((t) => !draft.some((d) => d.id === t.id)).reduce((n, t) => n + (props.usage.get(t.id) ?? 0), 0);

  const patch = (id: string, p: Partial<WorkspaceTag>) => setDraft((d) => d.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const addNew = () => {
    const label = newLabel.trim().slice(0, TAG_LABEL_MAX);
    if (!label || newProblem) return;
    setDraft((d) => [...d, { id: newId('tag'), label, color: newColor }]);
    setNewLabel('');
    setNewColor(tagColorFor(draft.length + 1));
    newInput.current?.focus();
  };
  const save = () => {
    if (invalid) return;
    // A typed but not yet created tag is kept too.
    const label = newLabel.trim().slice(0, TAG_LABEL_MAX);
    const pending = label && !newProblem ? [{ id: newId('tag'), label, color: newColor }] : [];
    props.onSave([...draft.map((t) => ({ ...t, label: t.label.trim() })), ...pending], placement);
  };

  return (
    <Dialog title="Workspace tags" onClose={props.onClose} className="pw-tag-manager">
      <div className="pw-dialog-hint">Tags belong to this workspace. Add them to a file or snippet from its menu (Add a tag).</div>
      {draft.length > 0 && (
        <div className="pw-tag-rows">
          {draft.map((t) => {
            const uses = props.usage.get(t.id) ?? 0;
            const err = problem(t);
            return (
              <div key={t.id} className="pw-tag-row">
                <div className="pw-tag-row-main">
                  <ColorPickerButton value={t.color} onChange={(color) => patch(t.id, { color })} label={`Color of ${t.label}`} />
                  <input
                    className={`pw-dialog-input${err ? ' invalid' : ''}`}
                    value={t.label}
                    maxLength={TAG_LABEL_MAX}
                    spellCheck={false}
                    aria-label="Tag name"
                    title={err}
                    onChange={(e) => patch(t.id, { label: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && save()}
                  />
                  <TagChip tag={{ ...t, label: t.label.trim() || '…' }} title="Preview" />
                  <span className="pw-tag-uses" title={`On ${uses} paper${uses === 1 ? '' : 's'}`}>
                    {uses}
                  </span>
                  <button
                    className="pw-icon"
                    title={uses ? `Delete (takes it off ${uses} paper${uses === 1 ? '' : 's'})` : 'Delete'}
                    aria-label={`Delete ${t.label}`}
                    onClick={() => setDraft((d) => d.filter((x) => x.id !== t.id))}
                  >
                    <span className="codicon codicon-trash" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="pw-dialog-section">
        <span className="pw-dialog-label">New tag</span>
        <div className="pw-tag-row-main">
          <ColorPickerButton value={newColor} onChange={setNewColor} label="Color of the new tag" />
          <input
            ref={newInput}
            className={`pw-dialog-input${newProblem ? ' invalid' : ''}`}
            value={newLabel}
            maxLength={TAG_LABEL_MAX}
            placeholder="Name"
            spellCheck={false}
            aria-label="New tag name"
            title={newProblem}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (e.ctrlKey || e.metaKey) save();
              else addNew();
            }}
          />
          <button className="pw-button" disabled={!newLabel.trim() || !!newProblem} onClick={addNew}>
            <span className="codicon codicon-add" /> Create
          </button>
        </div>
      </div>
      <div className="pw-dialog-section">
        <span className="pw-dialog-label">Show tags on papers</span>
        <div className="pw-segmented" role="radiogroup" aria-label="Show tags on papers">
          {TAG_PLACEMENTS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={placement === p}
              className={`pw-segment${placement === p ? ' active' : ''}`}
              title={p === 'top' ? 'On the title row, at the top-right corner' : `Beside the paper, on its ${p} side`}
              onClick={() => setPlacement(p)}
            >
              <span className={`codicon codicon-${PLACEMENT_LABELS[p].icon}`} />
              {PLACEMENT_LABELS[p].label}
            </button>
          ))}
        </div>
      </div>
      <div className="pw-dialog-actions">
        {removedUses > 0 && <span className="pw-dialog-hint">Deleted tags come off {removedUses} paper{removedUses === 1 ? '' : 's'}.</span>}
        <button className="pw-button" onClick={props.onClose}>
          Cancel
        </button>
        <button className="pw-button primary" disabled={invalid} onClick={save}>
          Save
        </button>
      </div>
    </Dialog>
  );
}
