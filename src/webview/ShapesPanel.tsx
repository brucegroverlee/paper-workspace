// Shape library panel (opens beside the toolbar, like the configuration): click a shape to add it at the center of
// the view, or drag it onto the canvas (into a group, if dropped over one).
import { useState } from 'react';
import { ShapeSvg } from './BoardNodes';
import { SHAPE_DRAG_TYPE, SHAPE_SECTIONS, shapeDef } from './shapes';

const THUMB = { width: 34, height: 28 };

/** Collapsed sections survive closing and reopening the panel. */
const collapsed = new Set<string>(['basic']);

export function ShapesPanel(props: { onAdd(shape: string): void; onClose(): void }) {
  const [query, setQuery] = useState('');
  const [, rerender] = useState(0);
  const q = query.trim().toLowerCase();
  const sections = q
    ? [{ id: 'results', title: 'Results', shapes: [...new Set(SHAPE_SECTIONS.flatMap((s) => s.shapes))].filter((id) => matches(id, q)) }]
    : SHAPE_SECTIONS;

  const toggle = (id: string) => {
    if (!collapsed.delete(id)) collapsed.add(id);
    rerender((n) => n + 1);
  };

  return (
    <div className="pw-config pw-shapes" role="dialog" aria-label="Shapes" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pw-config-title">
        Shapes
        <button className="pw-icon" onClick={props.onClose} aria-label="Close" title="Close">
          <span className="codicon codicon-close" />
        </button>
      </div>
      <input
        className="pw-shapes-search"
        type="search"
        placeholder="Search shapes"
        aria-label="Search shapes"
        value={query}
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      <div className="pw-shapes-list nowheel">
        {sections.map((s) => {
          const open = !!q || !collapsed.has(s.id);
          return (
            <section key={s.id} className="pw-shapes-section">
              {!q && (
                <button className="pw-shapes-heading" aria-expanded={open} onClick={() => toggle(s.id)}>
                  <span className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
                  {s.title}
                </button>
              )}
              {open && (
                <div className="pw-shapes-grid">
                  {s.shapes.map((id) => (
                    <ShapeButton key={id} id={id} onAdd={props.onAdd} />
                  ))}
                  {!s.shapes.length && <div className="pw-shapes-empty">No shapes match “{query.trim()}”</div>}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="pw-config-hint">Click to add, or drag onto the canvas or into a group.</div>
    </div>
  );
}

function matches(id: string, q: string) {
  const def = shapeDef(id);
  return def.id.includes(q) || def.label.toLowerCase().includes(q);
}

function ShapeButton(props: { id: string; onAdd(shape: string): void }) {
  const def = shapeDef(props.id);
  // Fit the shape's default proportions into the thumbnail box.
  const k = Math.min(THUMB.width / def.size.width, THUMB.height / def.size.height);
  return (
    <button
      className="pw-shape-thumb"
      title={def.label}
      aria-label={def.label}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(SHAPE_DRAG_TYPE, def.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => props.onAdd(def.id)}
    >
      <ShapeSvg def={def} width={def.size.width * k} height={def.size.height * k} fill="var(--pw-toolbar-bg)" stroke="currentColor" strokeWidth={1.2} />
    </button>
  );
}
