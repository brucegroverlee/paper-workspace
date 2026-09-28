import { describe, expect, it } from 'vitest';
import { GROUP_HEADER_HEIGHT, GROUP_PADDING, canvasBackgroundOf, groupHeaderHeight, clampFontSize, isLightColor, mediaSizeFor, parseWorkspace, serializeWorkspace } from '../src/shared/workspace';
import { absolutePos, arrange, cloneTrees, copyTrees, dropNodes, dropTargetFor, fitGroups, reparent, type TreeNode } from '../src/webview/boardLayout';
import { toneOver } from '../src/webview/tone';

const ids = (ns: { id: string }[]) => ns.map((n) => n.id).join(',');

describe('board nodes in the .workspace format', () => {
  const raw = {
    version: 2,
    nodes: [
      { id: 'e', type: 'editor', parent: 'f' },
      { id: 'f', type: 'file', file: 'a.ts', parent: 'g2', position: { x: 10, y: 50 }, width: 300, height: 200 },
      { id: 'g2', type: 'group', parent: 'g1', title: 'Inner', position: { x: 20, y: 40 }, width: 400, height: 300 },
      { id: 'g1', type: 'group', title: 'Outer', color: '#FFEC99', position: { x: 0, y: 0 }, width: 600, height: 500 },
      { id: 't', type: 'text', text: 'Hello', fontSize: 28, fontWeight: 700, textColor: '#123456', position: { x: 700, y: 0 } },
      { id: 'n', type: 'note', text: 'Todo', color: 'red', textColor: '#AABBCC', fontWeight: 'x', position: { x: 700, y: 100 } },
      { id: 'm', type: 'media', src: '.paperworkspace/media/a.png', parent: 'g1', position: { x: 30, y: 400 }, width: 120, height: 80 },
      { id: 'bad', type: 'media', position: { x: 0, y: 0 } },
    ],
  };

  it('parses groups, text, notes and media with parents first', () => {
    const { workspace } = parseWorkspace(JSON.stringify(raw));
    expect(ids(workspace.nodes)).toBe('g1,t,n,g2,m,f,e');
    const g1 = workspace.nodes.find((n) => n.id === 'g1')!;
    expect(g1).toMatchObject({ title: 'Outer', color: '#ffec99' });
    expect(workspace.nodes.find((n) => n.id === 't')).toMatchObject({ text: 'Hello', fontSize: 28, fontWeight: 700, textColor: undefined, width: 240, height: 40 });
    expect(workspace.nodes.find((n) => n.id === 'n')).toMatchObject({ text: 'Todo', color: undefined, textColor: '#aabbcc', fontWeight: undefined });
    expect(workspace.nodes.find((n) => n.id === 'f')).toMatchObject({ parent: 'g2' });
  });

  it('round-trips', () => {
    const once = serializeWorkspace(parseWorkspace(JSON.stringify(raw)).workspace);
    expect(serializeWorkspace(parseWorkspace(once).workspace)).toBe(once);
    expect(JSON.parse(once).nodes.find((n: any) => n.id === 't')).not.toHaveProperty('parent');
  });

  it('parses and round-trips group title styles, dropping defaults and invalid values', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'a', type: 'group', title: 'A', textColor: '#FF0000', fontSize: 40, fontWeight: 800, titlePosition: 'bottom-center' },
        { id: 'b', type: 'group', title: 'B', textColor: 'red', fontSize: -3, fontWeight: 'x', titlePosition: 'middle' },
        { id: 'c', type: 'group', title: 'C', titlePosition: 'top-left' },
      ],
    });
    const { workspace } = parseWorkspace(text);
    expect(workspace.nodes[0]).toMatchObject({ textColor: '#ff0000', fontSize: 40, fontWeight: 800, titlePosition: 'bottom-center' });
    expect(workspace.nodes[1]).toMatchObject({ textColor: undefined, fontSize: undefined, fontWeight: undefined, titlePosition: undefined });
    const out = JSON.parse(serializeWorkspace(workspace)).nodes;
    expect(out[0]).toMatchObject({ textColor: '#ff0000', fontSize: 40, fontWeight: 800, titlePosition: 'bottom-center' });
    for (const key of ['textColor', 'fontSize', 'fontWeight', 'titlePosition']) {
      expect(out[1]).not.toHaveProperty(key);
      expect(out[2]).not.toHaveProperty(key);
    }
  });

  it('parses and round-trips group borders, dropping defaults and invalid values', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'a', type: 'group', title: 'A', strokeColor: '#00FF00', strokeWidth: 3, strokeStyle: 'dashed' },
        { id: 'b', type: 'group', title: 'B', strokeColor: 'green', strokeWidth: -1, strokeStyle: 'wavy' },
        { id: 'c', type: 'group', title: 'C', strokeWidth: 1.5, strokeStyle: 'solid' },
        { id: 'd', type: 'group', title: 'D', strokeWidth: 99, strokeStyle: 'none' },
      ],
    });
    const { workspace } = parseWorkspace(text);
    expect(workspace.nodes[0]).toMatchObject({ strokeColor: '#00ff00', strokeWidth: 3, strokeStyle: 'dashed' });
    expect(workspace.nodes[1]).toMatchObject({ strokeColor: undefined, strokeWidth: undefined, strokeStyle: undefined });
    expect(workspace.nodes[3]).toMatchObject({ strokeWidth: 20, strokeStyle: 'none' });
    const out = JSON.parse(serializeWorkspace(workspace)).nodes;
    expect(out[0]).toMatchObject({ strokeColor: '#00ff00', strokeWidth: 3, strokeStyle: 'dashed' });
    for (const key of ['strokeColor', 'strokeWidth', 'strokeStyle']) {
      expect(out[1]).not.toHaveProperty(key);
      expect(out[2]).not.toHaveProperty(key);
    }
  });

  it('clamps typed font sizes and validates the canvas background', () => {
    expect(clampFontSize('24')).toBe(24);
    expect(clampFontSize('2')).toBe(6);
    expect(clampFontSize(999)).toBe(200);
    expect(clampFontSize('')).toBeUndefined();
    expect(clampFontSize('abc')).toBeUndefined();
    expect(canvasBackgroundOf('#ABCDEF')).toBe('#abcdef');
    expect(canvasBackgroundOf('grey')).toBe('#e4e5e8');
  });

  it('drops parents that are missing, not groups, or cyclic', () => {
    const { workspace } = parseWorkspace(
      JSON.stringify({
        nodes: [
          { id: 'a', type: 'group', parent: 'b', title: '' },
          { id: 'b', type: 'group', parent: 'a', title: '' },
          { id: 't', type: 'text', parent: 'nope', text: '' },
          { id: 'u', type: 'note', parent: 't', text: '' },
        ],
      }),
    );
    const parents = Object.fromEntries(workspace.nodes.map((n) => [n.id, n.parent]));
    expect(parents).toEqual({ a: undefined, b: 'a', t: undefined, u: undefined });
  });

  it('picks readable text colors and scales media', () => {
    expect(isLightColor('#ffec99')).toBe(true);
    expect(isLightColor('#27405f')).toBe(false);
    expect(mediaSizeFor({ width: 1920, height: 1080 })).toEqual({ width: 480, height: 270 });
    expect(mediaSizeFor({ width: 100, height: 50 })).toEqual({ width: 100, height: 50 });
  });
});

describe('group layout helpers', () => {
  const tree = (): TreeNode[] => [
    { id: 'g', type: 'group', position: { x: 100, y: 100 }, width: 300, height: 200 },
    { id: 'a', type: 'note', parentId: 'g', position: { x: 20, y: 50 }, width: 50, height: 50 },
    { id: 'b', type: 'note', position: { x: 500, y: 500 }, width: 50, height: 50 },
  ];

  it('computes canvas positions and reparents without moving on screen', () => {
    let ns = tree();
    expect(absolutePos(ns, 'a')).toEqual({ x: 120, y: 150 });
    ns = reparent(ns, 'a', undefined);
    expect(ns.find((n) => n.id === 'a')).toMatchObject({ position: { x: 120, y: 150 } });
    expect(ns.find((n) => n.id === 'a')).not.toHaveProperty('parentId');
    ns = reparent(ns, 'b', 'g');
    expect(ns.find((n) => n.id === 'b')).toMatchObject({ parentId: 'g', position: { x: 400, y: 400 } });
  });

  it('finds the topmost group under the center of a dragged node, never itself or its content', () => {
    const ns: TreeNode[] = [
      ...tree(),
      { id: 'inner', type: 'group', parentId: 'g', position: { x: 100, y: 40 }, width: 150, height: 150, zIndex: 5 },
      { id: 'c', type: 'note', position: { x: 220, y: 160 }, width: 20, height: 20 },
    ];
    expect(dropTargetFor(ns, 'c', new Set(['c']))).toBe('inner');
    expect(dropTargetFor(ns, 'b', new Set(['b']))).toBeUndefined();
    expect(dropTargetFor(ns, 'inner', new Set(['inner']))).toBe('g');
    expect(dropTargetFor(ns, 'g', new Set(['g']))).toBeUndefined();
  });

  it('drops a node dragged out of its group onto the canvas instead of growing the group', () => {
    const ns = tree();
    ns[1] = { ...ns[1], position: { x: 350, y: 50 } }; // center at canvas (475, 175): right of the group
    const out = fitGroups(dropNodes(ns, new Set(['a'])));
    expect(out.find((n) => n.id === 'a')).not.toHaveProperty('parentId');
    expect(absolutePos(out, 'a')).toEqual({ x: 450, y: 150 });
    expect(out.find((n) => n.id === 'g')).toMatchObject({ width: 300, height: 200 });
    // Children carried by a dropped group stay in it.
    expect(dropNodes(tree(), new Set(['g', 'a'])).find((n) => n.id === 'a')).toMatchObject({ parentId: 'g' });
  });

  it('grows a group around content sticking out, keeping the content in place on screen', () => {
    const ns = tree();
    ns[1] = { ...ns[1], position: { x: -30, y: 10 } };
    ns.push({ id: 'c', type: 'note', parentId: 'g', position: { x: 280, y: 190 }, width: 50, height: 50 });
    const out = fitGroups(ns);
    const g = out.find((n) => n.id === 'g')!;
    const dx = GROUP_PADDING + 30;
    const dy = GROUP_HEADER_HEIGHT + GROUP_PADDING / 2 - 10;
    expect(g.position).toEqual({ x: 100 - dx, y: 100 - dy });
    expect(absolutePos(out, 'a')).toEqual({ x: 70, y: 110 });
    expect(absolutePos(out, 'c')).toEqual(absolutePos(ns, 'c'));
    expect(g.width).toBe(330 + GROUP_PADDING + dx);
    expect(g.height).toBe(240 + GROUP_PADDING + dy);
    expect(fitGroups(out)).toBe(out);
  });

  it('keeps content clear of a big title bar, at the top or at the bottom', () => {
    const bar = groupHeaderHeight(40);
    expect(bar).toBeGreaterThan(GROUP_HEADER_HEIGHT);
    const top = tree();
    top[0] = { ...top[0], data: { fontSize: 40 } };
    const g = fitGroups(top).find((n) => n.id === 'g')!;
    expect(g.position.y).toBe(100 - (bar + GROUP_PADDING / 2 - 50));

    const bottom = tree();
    bottom[0] = { ...bottom[0], data: { fontSize: 40, titlePosition: 'bottom-left' } };
    bottom[1] = { ...bottom[1], position: { x: 20, y: 140 } }; // bottom edge at 190, over the bar
    const out = fitGroups(bottom);
    const gb = out.find((n) => n.id === 'g')!;
    expect(gb.position).toEqual({ x: 100, y: 100 });
    expect(gb.height).toBe(190 + bar + GROUP_PADDING / 2);
    expect(fitGroups(out)).toBe(out);
    // Without a top bar, content may sit near the top edge.
    expect(fitGroups(tree().map((n) => (n.id === 'g' ? { ...n, data: { titlePosition: 'bottom-right' } } : n.id === 'a' ? { ...n, position: { x: 20, y: 10 } } : n)))[0].position).toEqual({ x: 100, y: 100 });
  });

  it('orders parents before children and stacks content above its group', () => {
    const ns: TreeNode[] = [
      { id: 'a', type: 'note', parentId: 'g', position: { x: 0, y: 0 } },
      { id: 'b', type: 'note', position: { x: 0, y: 0 } },
      { id: 'g', type: 'group', position: { x: 0, y: 0 } },
    ];
    const out = arrange(ns);
    expect(ids(out)).toBe('b,g,a');
    expect(out.map((n) => n.zIndex)).toEqual([0, 1, 2]);
    expect(arrange(out)).toBe(out);
  });
});

describe('copy & paste of board nodes', () => {
  const ns: TreeNode[] = [
    { id: 'g', type: 'group', position: { x: 100, y: 100 }, width: 400, height: 300 },
    { id: 'f', type: 'file', parentId: 'g', position: { x: 10, y: 40 }, width: 100, height: 100 },
    { id: 'e', type: 'editor', parentId: 'f', position: { x: 0, y: 40 }, width: 100, height: 60 },
    { id: 's', type: 'shape', parentId: 'g', position: { x: 200, y: 50 }, width: 80, height: 40 },
    { id: 'n', type: 'note', position: { x: 700, y: 0 }, width: 200, height: 200 },
  ];
  const noCode = (n: TreeNode) => n.type !== 'file' && n.type !== 'editor';

  it('snapshots a nested node top-level at its canvas position', () => {
    expect(copyTrees(ns, ['s'])).toEqual([{ id: 's', type: 'shape', position: { x: 300, y: 150 }, width: 80, height: 40 }]);
  });

  it('snapshots a group with its content, minus what `keep` rejects', () => {
    const snap = copyTrees(ns, ['g', 'n'], noCode);
    expect(ids(snap)).toBe('g,s,n');
    expect(snap.find((n) => n.id === 's')).toMatchObject({ parentId: 'g', position: { x: 200, y: 50 } });
  });

  it('clones with fresh ids, remapped parents and moved roots', () => {
    let i = 0;
    const copies = cloneTrees(copyTrees(ns, ['g'], noCode), { x: 24, y: 24 }, () => `c${i++}`);
    expect(copies).toMatchObject([
      { id: 'c0', position: { x: 124, y: 124 } },
      { id: 'c1', parentId: 'c0', position: { x: 200, y: 50 } },
    ]);
    // Pasting again gives new ids, and the originals are untouched.
    expect(ids(cloneTrees(copyTrees(ns, ['g'], noCode), { x: 0, y: 0 }, () => `d${i++}`))).toBe('d2,d3');
    expect(ns[0].position).toEqual({ x: 100, y: 100 });
  });
});

describe('folders as containers', () => {
  const folder: TreeNode = { id: 'd', type: 'folder', position: { x: 0, y: 0 }, width: 400, height: 300 };

  it('take dropped boxes like groups', () => {
    const f: TreeNode = { id: 'f', type: 'file', position: { x: 100, y: 100 }, width: 100, height: 100 };
    expect(dropTargetFor([folder, f], 'f', new Set(['f']))).toBe('d');
  });

  it('grow to fit their content, below their title bar', () => {
    const kid: TreeNode = { id: 'k', type: 'text', parentId: 'd', position: { x: 10, y: 5 }, width: 500, height: 50 };
    const fitted = fitGroups([folder, kid]);
    const d = fitted.find((n) => n.id === 'd')!;
    const k = fitted.find((n) => n.id === 'k')!;
    expect(k.position.y).toBeGreaterThanOrEqual(40);
    expect(d.width).toBeGreaterThanOrEqual(k.position.x + 500);
  });
});

describe('title bar text tone', () => {
  it('picks the text color that contrasts most with what shows behind the bar', () => {
    expect(toneOver({ color: '#ffffff', alpha: 1 }, '#000000')).toBe('on-light');
    expect(toneOver({ color: '#1c4587', alpha: 1 }, '#e4e5e8')).toBe('on-dark');
    // A dark color at 60% over a light canvas is a mid tone: dark text reads better there.
    expect(toneOver({ color: '#1c4587', alpha: 0.6 }, '#e4e5e8')).toBe('on-light');
    // Mostly transparent: the canvas decides.
    expect(toneOver({ color: '#000000', alpha: 0.1 }, '#ffffff')).toBe('on-light');
    expect(toneOver({ color: '#ffffff', alpha: 0.1 }, '#101010')).toBe('on-dark');
  });
});
