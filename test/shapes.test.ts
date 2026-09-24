import { describe, expect, it } from 'vitest';
import { DEFAULT_SHAPE_SIZE, parseWorkspace, serializeWorkspace } from '../src/shared/workspace';
import { SHAPE_SECTIONS, isKnownShape, shapeDef, textBoxOf } from '../src/webview/shapes';

describe('shape nodes in the .workspace format', () => {
  const raw = {
    version: 2,
    nodes: [
      { id: 'g', type: 'group', title: 'Flow', position: { x: 0, y: 0 }, width: 600, height: 400 },
      { id: 's1', type: 'shape', parent: 'g', shape: 'diamond', text: 'OK?', color: '#FFEC99', strokeColor: '#27405F', fontSize: 16, fontWeight: 700, position: { x: 20, y: 50 }, width: 140, height: 100 },
      { id: 's2', type: 'shape', shape: 'Bad Name!', text: 3, color: 'none', textColor: 'red', position: { x: 700, y: 0 } },
      { id: 's3', type: 'shape', shape: 'future-shape', parent: 'missing', position: { x: 0, y: 500 } },
    ],
  };

  it('parses shapes, validating kind, colors and fonts', () => {
    const { workspace } = parseWorkspace(JSON.stringify(raw));
    expect(workspace.nodes.find((n) => n.id === 's1')).toMatchObject({
      parent: 'g',
      shape: 'diamond',
      text: 'OK?',
      color: '#ffec99',
      strokeColor: '#27405f',
      fontSize: 16,
      fontWeight: 700,
      width: 140,
      height: 100,
    });
    expect(workspace.nodes.find((n) => n.id === 's2')).toMatchObject({ shape: 'rectangle', text: '', color: 'none', textColor: undefined, ...DEFAULT_SHAPE_SIZE });
    // Unknown (newer) kinds are kept as written; a missing group sends the shape back to the canvas.
    const s3 = workspace.nodes.find((n) => n.id === 's3')!;
    expect(s3).toMatchObject({ shape: 'future-shape' });
    expect(s3.parent).toBeUndefined();
  });

  it('round-trips', () => {
    const once = serializeWorkspace(parseWorkspace(JSON.stringify(raw)).workspace);
    expect(serializeWorkspace(parseWorkspace(once).workspace)).toBe(once);
    const s2 = JSON.parse(once).nodes.find((n: any) => n.id === 's2');
    expect(s2).toMatchObject({ color: 'none' });
    expect(s2).not.toHaveProperty('strokeColor');
  });
});

describe('shape library', () => {
  const ids = [...new Set(SHAPE_SECTIONS.flatMap((s) => s.shapes))];

  it('defines every shape listed in the panel', () => {
    for (const id of ids) expect(isKnownShape(id), id).toBe(true);
  });

  it('falls back to a rectangle for unknown kinds', () => {
    expect(shapeDef('nope').id).toBe('rectangle');
  });

  it('produces valid paths and a label box inside the shape at any size', () => {
    for (const id of ids) {
      const def = shapeDef(id);
      for (const [w, h] of [[def.size.width, def.size.height], [20, 20], [600, 40], [40, 600]]) {
        const parts = def.parts(w, h);
        expect(parts.length, id).toBeGreaterThan(0);
        for (const p of parts) expect(p.d, id).toMatch(/^M[-\d. MLHVACQTZ]+$/);
        const box = textBoxOf(def, w, h);
        expect(box.x, id).toBeGreaterThanOrEqual(0);
        expect(box.y, id).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, id).toBeLessThanOrEqual(w + 0.001);
        expect(box.y + box.height, id).toBeLessThanOrEqual(h + 0.001);
      }
    }
  });
});
