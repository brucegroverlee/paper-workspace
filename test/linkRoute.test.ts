import { describe, expect, it } from 'vitest';
import { parseWorkspace, serializeWorkspace } from '../src/shared/workspace';
import { nearestOnPath, orthogonal, pointAt, routeLink, snapPoint } from '../src/webview/linkRoute';

const right = { x: 1, y: 0 };
const left = { x: -1, y: 0 };

describe('link bend points', () => {
  it('round-trips through the .workspace format, dropping bad points', () => {
    const raw = {
      version: 2,
      nodes: [
        { id: 'a', type: 'text', text: 'A', position: { x: 0, y: 0 } },
        { id: 'b', type: 'text', text: 'B', position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: 'l1', source: 'a', target: 'b', points: [{ x: 10, y: 20 }, { x: 'no' }, null, { x: '30', y: 40 }] },
        { id: 'l2', source: 'a', target: 'b', points: [] },
      ],
    };
    const { workspace } = parseWorkspace(JSON.stringify(raw));
    expect(workspace.edges[0].points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
    expect(workspace.edges[1].points).toBeUndefined();
    const again = parseWorkspace(serializeWorkspace(workspace)).workspace;
    expect(again.edges.map((e) => e.points)).toEqual(workspace.edges.map((e) => e.points));
  });

  it('moves the middle of an elbow sideways through one bend point', () => {
    // Right side of one node to the left side of another, below and to the right; bend at x = 60.
    const { line, anchors } = orthogonal({ x: 0, y: 0 }, right, { x: 200, y: 100 }, left, [{ x: 60, y: 50 }]);
    expect(line).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 50 },
      { x: 60, y: 100 },
      { x: 180, y: 100 },
      { x: 200, y: 100 },
    ]);
    expect(anchors).toEqual([0, 2, line.length - 1]);
  });

  it('leaves the node before turning back toward a bend point behind it', () => {
    const { line } = orthogonal({ x: 0, y: 0 }, right, { x: 200, y: 0 }, left, [{ x: -50, y: -80 }]);
    expect(line.slice(0, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: -80 },
      { x: -50, y: -80 },
    ]);
    // Every stretch is horizontal or vertical.
    for (let i = 1; i < line.length; i++) expect(line[i].x === line[i - 1].x || line[i].y === line[i - 1].y).toBe(true);
  });

  it('puts the label halfway and a handle in the middle of each stretch', () => {
    const route = routeLink('straight', { x: 0, y: 0 }, right, { x: 200, y: 0 }, left, [{ x: 100, y: 100 }]);
    expect(route.path).toBe('M0,0 L100,100 L200,0');
    expect(route.label).toEqual({ x: 100, y: 100 });
    expect(route.mids).toEqual([
      { x: 50, y: 50 },
      { x: 150, y: 50 },
    ]);
  });

  it('draws curves through their bend points', () => {
    const route = routeLink('curve', { x: 0, y: 0 }, right, { x: 200, y: 0 }, left, [{ x: 100, y: 80 }]);
    expect(route.path.startsWith('M0,0 C')).toBe(true);
    expect(route.path).toContain(' 100,80 C');
    expect(route.mids).toHaveLength(2);
  });

  it('keeps a moved label position, dropping the defaults and bad values', () => {
    const raw = {
      version: 2,
      nodes: [
        { id: 'a', type: 'text', text: 'A', position: { x: 0, y: 0 } },
        { id: 'b', type: 'text', text: 'B', position: { x: 400, y: 0 } },
      ],
      edges: [
        { id: 'l1', source: 'a', target: 'b', label: 'x', labelAt: 0.25, labelOffset: { x: 4, y: -12 } },
        { id: 'l2', source: 'a', target: 'b', label: 'y', labelAt: 0.5 },
        { id: 'l3', source: 'a', target: 'b', label: 'z', labelAt: 3, labelOffset: { x: 'no' } },
      ],
    };
    const { workspace } = parseWorkspace(JSON.stringify(raw));
    expect(workspace.edges.map((e) => [e.labelAt, e.labelOffset])).toEqual([
      [0.25, { x: 4, y: -12 }],
      [undefined, undefined],
      [undefined, undefined],
    ]);
    expect(parseWorkspace(serializeWorkspace(workspace)).workspace.edges[0]).toMatchObject({ labelAt: 0.25, labelOffset: { x: 4, y: -12 } });
  });

  it('finds points along a sampled path and the closest one to a spot', () => {
    const line = { pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], total: 200 };
    expect(pointAt(line, 0.25)).toEqual({ x: 50, y: 0 });
    expect(pointAt(line, 0.75)).toEqual({ x: 100, y: 50 });
    expect(nearestOnPath(line, { x: 130, y: 60 })).toEqual({ at: 0.8, point: { x: 100, y: 60 } });
  });

  it('snaps a dragged point in line with its neighbors', () => {
    expect(snapPoint({ x: 103, y: 47 }, [{ x: 100, y: 0 }, { x: 300, y: 50 }], 8)).toEqual({ x: 100, y: 50 });
    expect(snapPoint({ x: 120, y: 30 }, [{ x: 100, y: 0 }], 8)).toEqual({ x: 120, y: 30 });
  });
});
