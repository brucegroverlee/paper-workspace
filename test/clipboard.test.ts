import { describe, expect, it } from 'vitest';
import { FILE_HEADER_HEIGHT, FILE_PADDING } from '../src/shared/workspace';
import { mergeCopies, mergeTags, snapshotNodes } from '../src/webview/clipboard';
import type { RFEdge, RFNode } from '../src/webview/context';

const file = (id: string, path: string, extra: Partial<RFNode> = {}): RFNode =>
  ({ id, type: 'file', position: { x: 0, y: 0 }, width: 664, height: 600, data: { file: path }, ...extra }) as RFNode;
const editor = (id: string, parent: string, path: string, y: number, target?: { start: number; end: number }, extra: Partial<RFNode> = {}): RFNode =>
  ({ id, type: 'editor', parentId: parent, position: { x: FILE_PADDING, y }, width: 640, height: 200, data: { file: path, target }, ...extra }) as RFNode;
const folder = (id: string, path: string, extra: Partial<RFNode> = {}): RFNode =>
  ({ id, type: 'folder', position: { x: 0, y: 0 }, width: 800, height: 600, data: { folder: path }, ...extra }) as RFNode;
const note = (id: string, extra: Partial<RFNode> = {}): RFNode =>
  ({ id, type: 'note', position: { x: 0, y: 0 }, width: 200, height: 200, data: { text: id }, ...extra }) as RFNode;
const link = (id: string, source: string, target: string): RFEdge => ({ id, type: 'link', source, target, data: {} });
const ids = (ns: { id: string }[]) => ns.map((n) => n.id).sort().join(',');

describe('snapshotNodes', () => {
  const canvas = [
    file('f', 'a.ts', { position: { x: 100, y: 50 } }),
    editor('e1', 'f', 'a.ts', FILE_HEADER_HEIGHT, { start: 1, end: 5 }),
    editor('e2', 'f', 'a.ts', 300, { start: 10, end: 20 }),
    editor('e3', 'f', 'a.ts', 600),
    note('n'),
  ];

  it('copies a picked file with all its snippets', () => {
    const snap = snapshotNodes(canvas, [canvas[0]]);
    expect(ids(snap.nodes)).toBe('e1,e2,e3,f');
    expect(snap.removable).toEqual(['f']);
  });

  it('copies snippets picked without their file in a file node holding only them, stacked from the top', () => {
    const snap = snapshotNodes(canvas, [canvas[2], canvas[3]]);
    expect(ids(snap.nodes)).toBe('e2,e3,f');
    const [top, a, b] = snap.nodes;
    expect(top).toMatchObject({ id: 'f', position: { x: 100, y: 50 } });
    expect(top.parentId).toBeUndefined();
    expect(a.position.y).toBe(FILE_HEADER_HEIGHT);
    expect(b.position.y).toBeGreaterThan(a.position.y + 200);
    expect(top.height).toBeLessThan(600 + 200); // sized to the two snippets, not the whole file
    expect(snap.removable.sort()).toEqual(['e2', 'e3']);
  });

  it('treats every snippet of a file picked as the whole file', () => {
    const snap = snapshotNodes(canvas, [canvas[1], canvas[2], canvas[3]]);
    expect(snap.removable).toEqual(['f']);
  });
});

describe('mergeCopies', () => {
  it('adds copies of files that are not on the canvas as they are', () => {
    const copies = [file('f2', 'b.ts'), editor('x', 'f2', 'b.ts', FILE_HEADER_HEIGHT)];
    const r = mergeCopies([note('n')], copies, []);
    expect(ids(r.nodes)).toBe('f2,n,x');
    expect([...r.roots]).toEqual(['f2']);
  });

  it('adds the snippets of a file already on the canvas to that file, skipping ones it already shows', () => {
    const canvas = [file('f', 'a.ts'), editor('e1', 'f', 'a.ts', FILE_HEADER_HEIGHT, { start: 1, end: 5 })];
    const copies = [file('c', 'a.ts'), editor('c1', 'c', 'a.ts', FILE_HEADER_HEIGHT, { start: 1, end: 5 }), editor('c2', 'c', 'a.ts', 300, { start: 8, end: 9 }), note('cn')];
    const links = [link('l1', 'c2', 'cn'), link('l2', 'c1', 'cn'), link('l3', 'c', 'cn')];
    const r = mergeCopies(canvas, copies, links);
    expect(ids(r.nodes)).toBe('c2,cn,e1,f');
    const added = r.nodes.find((n) => n.id === 'c2')!;
    expect(added).toMatchObject({ parentId: 'f', hidden: false, position: { x: FILE_PADDING, y: FILE_HEADER_HEIGHT + 200 + 16 } });
    expect([...r.roots]).toEqual(['cn']);
    expect(r.links.map((l) => `${l.source}>${l.target}`)).toEqual(['c2>cn', 'e1>cn', 'f>cn']);
    expect(r.reveal).toBeUndefined();
  });

  it('reveals the existing snippet when the paste adds nothing', () => {
    const canvas = [file('f', 'a.ts'), editor('e1', 'f', 'a.ts', FILE_HEADER_HEIGHT)];
    const r = mergeCopies(canvas, [file('c', 'a.ts'), editor('c1', 'c', 'a.ts', FILE_HEADER_HEIGHT)], []);
    expect(ids(r.nodes)).toBe('e1,f');
    expect(r.reveal).toBe('e1');
  });

  it('adds nothing to a locked file', () => {
    const canvas = [file('f', 'a.ts', { data: { file: 'a.ts', locked: true } } as Partial<RFNode>), editor('e1', 'f', 'a.ts', FILE_HEADER_HEIGHT)];
    const r = mergeCopies(canvas, [file('c', 'a.ts'), editor('c1', 'c', 'a.ts', FILE_HEADER_HEIGHT, { start: 3, end: 4 })], []);
    expect(ids(r.nodes)).toBe('e1,f');
  });

  it('puts the content of a folder already on the canvas into it, below its own content', () => {
    const canvas = [folder('d', 'src'), note('own', { parentId: 'd', position: { x: 16, y: 40 } })];
    const copies = [folder('cd', 'src', { position: { x: 900, y: 0 } }), note('cn', { parentId: 'cd', position: { x: 50, y: 60 } })];
    const r = mergeCopies(canvas, copies, []);
    expect(ids(r.nodes)).toBe('cn,d,own');
    const moved = r.nodes.find((n) => n.id === 'cn')!;
    expect(moved.parentId).toBe('d');
    expect(moved.position.y).toBeGreaterThanOrEqual(40 + 200);
  });

  it('puts the content of a locked folder copy on the canvas instead', () => {
    const canvas = [folder('d', 'src', { data: { folder: 'src', locked: true } } as Partial<RFNode>)];
    const copies = [folder('cd', 'src', { position: { x: 900, y: 10 } }), note('cn', { parentId: 'cd', position: { x: 50, y: 60 } })];
    const r = mergeCopies(canvas, copies, []);
    const moved = r.nodes.find((n) => n.id === 'cn')!;
    expect(moved.parentId).toBeUndefined();
    expect(moved.position).toEqual({ x: 950, y: 70 });
    expect([...r.roots]).toEqual(['cn']);
  });
});

describe('mergeTags', () => {
  it('reuses tags with the same label and adds the others, renaming taken ids', () => {
    const existing = [{ id: 't1', label: 'Bug', color: '#ff0000' }];
    const { tags, map } = mergeTags(existing, [
      { id: 'x', label: 'bug', color: '#00ff00' },
      { id: 't1', label: 'Todo', color: '#0000ff' },
      { id: 'y', label: 'Idea', color: '#ffff00' },
    ]);
    expect(map.get('x')).toBe('t1');
    expect(map.get('t1')).not.toBe('t1');
    expect(map.get('y')).toBe('y');
    expect(tags.map((t) => t.label)).toEqual(['Bug', 'Todo', 'Idea']);
  });
});
