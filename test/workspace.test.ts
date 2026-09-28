import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_SPACE,
  CUSTOM_COLORS_MAX,
  EDITOR_GAP,
  FILE_HEADER_HEIGHT,
  FILE_PADDING,
  DEFAULT_FOLDER_SIZE,
  FOLDER_GAP,
  GROUP_PADDING,
  addFolder,
  addSnippet,
  isInFolder,
  isLocked,
  clampRange,
  editorHeightFor,
  editorsOf,
  emptyWorkspace,
  fileSizeFor,
  findFreePosition,
  isEditorNode,
  isFileNode,
  nextEditorSlot,
  parseWorkspace,
  relocateRange,
  restack,
  stackPosition,
  serializeWorkspace,
  type EditorNode,
  type WorkspaceFile,
} from '../src/shared/workspace';
import { isAbsoluteWorkspacePath, sanitizeWorkspaceName, toWorkspacePath } from '../src/shared/paths';

const sample: WorkspaceFile = {
  version: 2,
  nodes: [
    { id: 'f1', type: 'file', file: 'src/a.ts', position: { x: 10.6, y: -4.2 }, width: 664, height: 400 },
    {
      id: 'e1',
      type: 'editor',
      parent: 'f1',
      target: { start: 3, end: 9 },
      anchor: 'export function a() {',
      position: { x: 12, y: 40 },
      width: 640,
      height: 300,
    },
    { id: 'e2', type: 'editor', parent: 'f1', position: { x: 12, y: 356 }, width: 640, height: 200 },
  ],
  edges: [],
};

let seq = 0;
const ids = () => (prefix = 'n') => `${prefix}${++seq}`;

describe('parseWorkspace / serializeWorkspace', () => {
  it('round-trips, rounds coordinates and grows file nodes to contain their editors', () => {
    const text = serializeWorkspace(sample);
    const { workspace, error } = parseWorkspace(text);
    expect(error).toBeUndefined();
    const file = workspace.nodes.find(isFileNode)!;
    expect(file.position).toEqual({ x: 11, y: -4 });
    expect(file.height).toBe(356 + 200 + FILE_PADDING); // grown to fit e2
    expect(parseWorkspace(serializeWorkspace(workspace)).workspace).toEqual(workspace);
  });

  it('keeps parents before children and omits the anchor of untargeted editors', () => {
    const shuffled = { ...sample, nodes: [sample.nodes[2], sample.nodes[1], sample.nodes[0]] };
    const out = JSON.parse(serializeWorkspace(shuffled));
    expect(out.nodes.map((n: { id: string }) => n.id)).toEqual(['f1', 'e2', 'e1']);
    expect(out.nodes[1]).not.toHaveProperty('target');
    expect(out.nodes[1]).not.toHaveProperty('anchor');
  });

  it('treats an empty file as an empty workspace', () => {
    expect(parseWorkspace('   ')).toEqual({ workspace: emptyWorkspace() });
  });

  it('reports invalid JSON instead of throwing', () => {
    const r = parseWorkspace('{ nope');
    expect(r.error).toMatch(/Invalid JSON/);
    expect(r.workspace.nodes).toEqual([]);
  });

  it('drops unknown kinds, orphan editors and dangling edges; repairs bad ranges', () => {
    const { workspace } = parseWorkspace(
      JSON.stringify({
        nodes: [
          { id: 'f', type: 'file', file: 'x.ts' },
          { id: 'e', type: 'editor', parent: 'f', target: { start: 0, end: -5 } },
          { id: 'orphan', type: 'editor', parent: 'missing' },
          { id: 'b', type: 'hologram' },
        ],
        edges: [{ id: 'x', source: 'e', target: 'b' }],
      }),
    );
    expect(workspace.nodes.map((n) => n.id)).toEqual(['f', 'e']);
    expect((workspace.nodes[1] as EditorNode).target).toEqual({ start: 1, end: 1 });
    expect(workspace.edges).toEqual([]);
  });

  it('links: keeps sides and style, drops invalid values, leaves defaults out of the file', () => {
    const nodes = [
      { id: 's1', type: 'shape', shape: 'rectangle', text: '' },
      { id: 's2', type: 'shape', shape: 'ellipse', text: '' },
    ];
    const { workspace } = parseWorkspace(
      JSON.stringify({
        nodes,
        edges: [
          { id: 'plain', source: 's1', target: 's2' },
          {
            id: 'styled', source: 's1', sourceSide: 'right', target: 's2', targetSide: 'middle', path: 'rounded', color: '#FF0000',
            width: 4, dash: 'dotted', startMarker: 'circle', endMarker: 'none', label: 'calls', labelColor: 'red', labelBackground: 'none', fontSize: 18, fontWeight: 650,
          },
          { id: 'defaults', source: 's2', target: 's1', path: 'curve', width: 2, dash: 'solid', startMarker: 'none', endMarker: 'arrow', label: '' },
        ],
      }),
    );
    expect(workspace.edges[0]).toEqual({ id: 'plain', source: 's1', target: 's2' });
    expect(workspace.edges[1]).toEqual({
      id: 'styled', source: 's1', sourceSide: 'right', target: 's2', path: 'rounded', color: '#ff0000',
      width: 4, dash: 'dotted', startMarker: 'circle', endMarker: 'none', label: 'calls', labelBackground: 'none', fontSize: 18, fontWeight: 700,
    });
    const saved = JSON.parse(serializeWorkspace(workspace)).edges;
    // `endMarker: 'none'` differs from the default arrow, so it is kept; default values are not written.
    expect(saved[1]).toMatchObject({ endMarker: 'none', startMarker: 'circle' });
    expect(saved[2]).toEqual({ id: 'defaults', source: 's2', target: 's1' });
    const text = serializeWorkspace(workspace);
    expect(serializeWorkspace(parseWorkspace(text).workspace)).toBe(text);
  });

  it('annotations: kept on files, groups, shapes and media (even empty), left out when off, ignored on text and notes', () => {
    const { workspace } = parseWorkspace(
      JSON.stringify({
        nodes: [
          { id: 'f', type: 'file', file: 'a.ts', annotation: 'entry point' },
          { id: 'g', type: 'group', title: 'G', annotation: '' },
          { id: 's', type: 'shape', shape: 'rectangle', text: '', annotation: 'step 1' },
          { id: 'm', type: 'media', src: 'x.png', annotation: 'screenshot' },
          { id: 'n', type: 'note', text: 'x', annotation: 'dropped' },
          { id: 't', type: 'text', text: 'y', annotation: 'dropped' },
          { id: 'plain', type: 'group', title: 'P' },
        ],
      }),
    );
    const saved = JSON.parse(serializeWorkspace(workspace)).nodes;
    const byId = Object.fromEntries(saved.map((n: { id: string }) => [n.id, n]));
    expect(['f', 'g', 's', 'm'].map((id) => byId[id].annotation)).toEqual(['entry point', '', 'step 1', 'screenshot']);
    for (const id of ['n', 't', 'plain']) expect(byId[id]).not.toHaveProperty('annotation');
    const text = serializeWorkspace(workspace);
    expect(serializeWorkspace(parseWorkspace(text).workspace)).toBe(text);
  });

  it('titles: custom names kept, empty names dropped, visibility saved only when not the default (shown for files and editors)', () => {
    const { workspace } = parseWorkspace(
      JSON.stringify({
        nodes: [
          { id: 'f1', type: 'file', file: 'src/a.ts', title: 'Entry', showTitle: true },
          { id: 'e1', type: 'editor', parent: 'f1', title: '', showTitle: true },
          { id: 'f2', type: 'file', file: 'src/b.ts', showTitle: false },
          { id: 'e2', type: 'editor', parent: 'f2', title: 'Parser', showTitle: false },
          { id: 'e3', type: 'editor', parent: 'f2', showTitle: 'yes' },
        ],
      }),
    );
    const saved = JSON.parse(serializeWorkspace(workspace)).nodes;
    const byId = Object.fromEntries(saved.map((n: { id: string }) => [n.id, n]));
    expect(byId.f1).toMatchObject({ title: 'Entry' });
    expect(byId.f1).not.toHaveProperty('showTitle');
    for (const id of ['e1', 'e3']) {
      expect(byId[id]).not.toHaveProperty('title');
      expect(byId[id]).not.toHaveProperty('showTitle');
    }
    expect(byId.f2).toMatchObject({ showTitle: false });
    expect(byId.e2).toMatchObject({ title: 'Parser', showTitle: false });
    const text = serializeWorkspace(workspace);
    expect(serializeWorkspace(parseWorkspace(text).workspace)).toBe(text);
  });

  it('title bar colors: kept on files and editors as lowercase #rrggbb, invalid values dropped', () => {
    const { workspace } = parseWorkspace(
      JSON.stringify({
        nodes: [
          { id: 'f1', type: 'file', file: 'src/a.ts', headerColor: '#FF8800' },
          { id: 'e1', type: 'editor', parent: 'f1', headerColor: '#1f6feb' },
          { id: 'e2', type: 'editor', parent: 'f1', headerColor: 'red' },
        ],
      }),
    );
    const saved = JSON.parse(serializeWorkspace(workspace)).nodes;
    const byId = Object.fromEntries(saved.map((n: { id: string }) => [n.id, n]));
    expect(byId.f1).toMatchObject({ headerColor: '#ff8800' });
    expect(byId.e1).toMatchObject({ headerColor: '#1f6feb' });
    expect(byId.e2).not.toHaveProperty('headerColor');
    const text = serializeWorkspace(workspace);
    expect(serializeWorkspace(parseWorkspace(text).workspace)).toBe(text);
  });

  it('tags: defined per workspace, referenced by id from files and editors; bad or unknown entries are dropped', () => {
    const { workspace } = parseWorkspace(
      JSON.stringify({
        tags: [
          { id: 'tag1', label: ' Bug ', color: '#FFC9C9' },
          { id: 'tag2', label: 'Todo', color: 'red' }, // invalid color: gets a palette color
          { id: 'tag3', label: 'bug' }, // same label as tag1 (ignoring case)
          { id: 'tag1', label: 'Again' }, // same id
          { id: 'tag4', label: '   ' },
          { label: 'No id' },
          { id: 'tag5', label: 'Unused', color: '#27405f' },
        ],
        nodes: [
          { id: 'f1', type: 'file', file: 'src/a.ts', tags: ['tag2', 'tag1', 'tag2', 'tag3', 42] },
          { id: 'e1', type: 'editor', parent: 'f1', tags: ['nope'] },
          { id: 'e2', type: 'editor', parent: 'f1', tags: ['tag5'] },
          { id: 'g1', type: 'group', title: 'G', tags: ['tag1'] },
        ],
      }),
    );
    expect(workspace.tags?.map((t) => [t.id, t.label])).toEqual([
      ['tag1', 'Bug'],
      ['tag2', 'Todo'],
      ['tag5', 'Unused'],
    ]);
    expect(workspace.tags![0].color).toBe('#ffc9c9');
    expect(workspace.tags![1].color).toMatch(/^#[0-9a-f]{6}$/);
    const byId = Object.fromEntries(workspace.nodes.map((n) => [n.id, n]));
    expect(byId.f1).toMatchObject({ tags: ['tag2', 'tag1'] });
    expect(byId.e1).not.toHaveProperty('tags', expect.anything());
    expect(byId.e2).toMatchObject({ tags: ['tag5'] });

    const text = serializeWorkspace(workspace);
    const saved = JSON.parse(text);
    expect(Object.keys(saved)).toEqual(['version', 'tags', 'nodes', 'edges']);
    const savedById = Object.fromEntries(saved.nodes.map((n: { id: string }) => [n.id, n]));
    expect(savedById.e1).not.toHaveProperty('tags');
    expect(savedById.g1).not.toHaveProperty('tags'); // only files and editors carry tags
    expect(serializeWorkspace(parseWorkspace(text).workspace)).toBe(text);
    // No tags at all: nothing is written.
    expect(JSON.parse(serializeWorkspace(sample))).not.toHaveProperty('tags');
  });

  it('tag placement: saved only when not the default (right); unknown values fall back to it', () => {
    const placement = (v: unknown) => parseWorkspace(JSON.stringify({ tagPlacement: v, nodes: [] })).workspace.tagPlacement;
    expect(placement('bottom')).toBe('bottom');
    expect(placement('top')).toBe('top');
    expect(placement('right')).toBeUndefined();
    expect(placement('middle')).toBeUndefined();
    expect(JSON.parse(serializeWorkspace({ ...emptyWorkspace(), tagPlacement: 'left' })).tagPlacement).toBe('left');
    expect(JSON.parse(serializeWorkspace({ ...emptyWorkspace(), tagPlacement: 'right' }))).not.toHaveProperty('tagPlacement');
  });

  it('custom colors: valid, lowercase and unique, only the newest are kept, left out when empty', () => {
    const many = Array.from({ length: CUSTOM_COLORS_MAX + 5 }, (_, i) => `#0000${(i + 16).toString(16)}`);
    const parse = (v: unknown) => parseWorkspace(JSON.stringify({ customColors: v, nodes: [] })).workspace.customColors;
    expect(parse(['#AABBCC', 'red', '#aabbcc', 12, '#123456'])).toEqual(['#aabbcc', '#123456']);
    expect(parse(many)).toEqual(many.slice(-CUSTOM_COLORS_MAX));
    expect(parse([])).toBeUndefined();
    expect(JSON.parse(serializeWorkspace({ ...emptyWorkspace(), customColors: ['#123456'] })).customColors).toEqual(['#123456']);
    expect(JSON.parse(serializeWorkspace({ ...emptyWorkspace(), customColors: [] }))).not.toHaveProperty('customColors');
  });

  it('hidden tags: only `showTags: false` is saved, and papers keep their tags while hidden', () => {
    const text = JSON.stringify({
      showTags: false,
      tags: [{ id: 't1', label: 'Bug', color: '#ffc9c9' }],
      nodes: [{ id: 'f1', type: 'file', file: 'a.ts', tags: ['t1'] }, { id: 'e1', type: 'editor', parent: 'f1' }],
    });
    const { workspace } = parseWorkspace(text);
    expect(workspace.showTags).toBe(false);
    expect(workspace.nodes.find(isFileNode)!.tags).toEqual(['t1']);
    expect(JSON.parse(serializeWorkspace(workspace))).toMatchObject({ showTags: false });
    expect(parseWorkspace(JSON.stringify({ showTags: true, nodes: [] })).workspace).not.toHaveProperty('showTags');
    expect(JSON.parse(serializeWorkspace({ ...workspace, showTags: true }))).not.toHaveProperty('showTags');
  });

  it('snippet annotations: saved, and their caption space counts in the file size and the next snippet slot', () => {
    const { workspace } = parseWorkspace(
      JSON.stringify({
        nodes: [
          { id: 'f', type: 'file', file: 'a.ts' },
          { id: 'e1', type: 'editor', parent: 'f', position: { x: 12, y: 40 }, width: 640, height: 200, annotation: 'the reducer' },
          { id: 'e2', type: 'editor', parent: 'f', position: { x: 12, y: 300 }, width: 640, height: 100 },
        ],
      }),
    );
    const [e1, e2] = editorsOf(workspace, 'f');
    expect(JSON.parse(serializeWorkspace(workspace)).nodes[1].annotation).toBe('the reducer');
    expect(fileSizeFor([e1]).height).toBe(40 + 200 + ANNOTATION_SPACE + FILE_PADDING);
    expect(nextEditorSlot([e1]).y).toBe(40 + 200 + ANNOTATION_SPACE + EDITOR_GAP);
    expect(nextEditorSlot([e1, e2]).y).toBe(300 + 100 + EDITOR_GAP);
  });

  it('migrates v1 flat code nodes to a file node with one targeted editor', () => {
    const v1 = {
      version: 1,
      nodes: [{ id: 'n1', type: 'code', file: 'src/a.ts', range: { start: 5, end: 12 }, anchor: 'x', position: { x: 100, y: 50 }, width: 560 }],
      edges: [],
    };
    const { workspace } = parseWorkspace(JSON.stringify(v1));
    expect(workspace.version).toBe(2);
    const [file, editor] = workspace.nodes;
    expect(file).toMatchObject({ type: 'file', file: 'src/a.ts', position: { x: 100, y: 50 }, width: 560 });
    expect(editor).toMatchObject({ type: 'editor', parent: file.id, target: { start: 5, end: 12 }, anchor: 'x' });
    // A single editor fills its file node below the header.
    expect(editor).toMatchObject({ position: { x: 0, y: FILE_HEADER_HEIGHT }, width: 560, height: file.height - FILE_HEADER_HEIGHT });
  });

  it('single-editor files: the file size is authoritative and round-trips without growing', () => {
    const single = {
      version: 2,
      nodes: [
        { id: 'f', type: 'file', file: 'a.ts', position: { x: 0, y: 0 }, width: 700, height: 500 },
        { id: 'e', type: 'editor', parent: 'f', position: { x: 12, y: 40 }, width: 300, height: 100 },
      ],
      edges: [],
    };
    const once = parseWorkspace(JSON.stringify(single)).workspace;
    expect(once.nodes[1]).toMatchObject({ position: { x: 0, y: FILE_HEADER_HEIGHT }, width: 700, height: 500 - FILE_HEADER_HEIGHT });
    const twice = parseWorkspace(serializeWorkspace(once)).workspace;
    expect(twice).toEqual(once);
  });
});

describe('addSnippet', () => {
  const base = { lineHeight: 20, origin: { x: 0, y: 0 }, id: ids() };

  it('creates a file node with one editor for a new file', () => {
    const r = addSnippet(emptyWorkspace(), { ...base, file: 'src/a.ts', target: { start: 3, end: 6 }, anchor: 'a' });
    expect(r.created).toBe(true);
    const [file, editor] = r.workspace.nodes;
    expect(file.type).toBe('file');
    expect(editor).toMatchObject({ id: r.editorId, parent: file.id, target: { start: 3, end: 6 }, anchor: 'a' });
    // One editor = one combined node: the editor fills the file below its header.
    expect(editor.position).toEqual({ x: 0, y: FILE_HEADER_HEIGHT });
    expect(file).toMatchObject({ width: editor.width, height: editor.height + FILE_HEADER_HEIGHT });
  });

  it('gives new files and editors the configured title visibility, leaving existing nodes alone', () => {
    const showTitles = { file: false, editor: true };
    const one = addSnippet(emptyWorkspace(), { ...base, file: 'src/a.ts', target: { start: 3, end: 6 }, showTitles });
    expect(one.workspace.nodes.map((n) => (n as { showTitle?: boolean }).showTitle)).toEqual([false, true]);
    const two = addSnippet(one.workspace, { ...base, file: 'src/a.ts', target: { start: 40, end: 50 }, showTitles: { file: true, editor: false } });
    const byId = Object.fromEntries(two.workspace.nodes.map((n) => [n.id, n as { showTitle?: boolean }]));
    expect(byId[one.workspace.nodes[0].id].showTitle).toBe(false); // the existing file keeps its own
    expect(byId[one.editorId].showTitle).toBe(true);
    expect(byId[two.editorId].showTitle).toBe(false);
  });

  it('adds a second snippet inside the existing file node, below the first, and grows the file', () => {
    const one = addSnippet(emptyWorkspace(), { ...base, file: 'src/a.ts', target: { start: 3, end: 6 } });
    const two = addSnippet(one.workspace, { ...base, file: 'src/a.ts', target: { start: 40, end: 50 } });
    expect(two.created).toBe(true);
    const file = two.workspace.nodes.find(isFileNode)!;
    const editors = editorsOf(two.workspace, file.id);
    expect(editors).toHaveLength(2);
    expect(two.workspace.nodes.filter(isFileNode)).toHaveLength(1);
    // The first editor became a padded child of the group, keeping its size.
    expect(editors[0].position).toEqual({ x: FILE_PADDING, y: FILE_HEADER_HEIGHT });
    expect(editors[0].width).toBe(one.workspace.nodes.find(isEditorNode)!.width);
    expect(editors[1].position.y).toBe(editors[0].position.y + editors[0].height + EDITOR_GAP);
    expect(file.width).toBe(editors[0].width + FILE_PADDING * 2);
    expect(file.height).toBeGreaterThanOrEqual(editors[1].position.y + editors[1].height + FILE_PADDING);
  });

  it('reuses an editor whose target already covers the lines', () => {
    const one = addSnippet(emptyWorkspace(), { ...base, file: 'src/a.ts', target: { start: 3, end: 20 } });
    const again = addSnippet(one.workspace, { ...base, file: 'src/a.ts', target: { start: 5, end: 8 } });
    expect(again.created).toBe(false);
    expect(again.editorId).toBe(one.editorId);
  });

  it('opening a whole file that is already on the canvas reveals it instead of duplicating', () => {
    const one = addSnippet(emptyWorkspace(), { ...base, file: 'src/a.ts', target: { start: 3, end: 6 } });
    const whole = addSnippet(one.workspace, { ...base, file: 'src/a.ts' });
    expect(whole.created).toBe(false);
    expect(whole.editorId).toBe(one.editorId);
  });

  it('places new file nodes without overlapping existing ones', () => {
    const a = addSnippet(emptyWorkspace(), { ...base, file: 'a.ts' });
    const b = addSnippet(a.workspace, { ...base, file: 'b.ts' });
    const [fa, fb] = b.workspace.nodes.filter(isFileNode);
    expect(fb.position).not.toEqual(fa.position);
    expect(b.workspace.nodes.filter(isEditorNode)).toHaveLength(2);
  });

  it('sizes editors to their target within limits', () => {
    expect(editorHeightFor(undefined, 20)).toBeGreaterThan(300);
    expect(editorHeightFor({ start: 1, end: 3 }, 20)).toBeLessThan(editorHeightFor({ start: 1, end: 15 }, 20));
    expect(editorHeightFor({ start: 1, end: 1000 }, 20)).toBeLessThanOrEqual(560);
  });
});

describe('ranges', () => {
  it('clamps to the document', () => {
    expect(clampRange({ start: 8, end: 20 }, 10)).toEqual({ start: 8, end: 10 });
    expect(clampRange({ start: 50, end: 60 }, 10)).toEqual({ start: 10, end: 10 });
    expect(clampRange({ start: 1, end: 5 }, 0)).toEqual({ start: 1, end: 1 });
  });

  const lines = ['import x;', '', '// moved', 'export function a() {', '  return 1;', '}'];

  it('keeps a range whose anchor still matches', () => {
    expect(relocateRange(lines, { start: 4, end: 6 }, 'export function a() {')).toEqual({ start: 4, end: 6 });
  });

  it('follows the anchor when lines were inserted above while the canvas was closed', () => {
    expect(relocateRange(lines, { start: 2, end: 4 }, 'export function a() {')).toEqual({ start: 4, end: 6 });
  });

  it('prefers the nearest match when the anchor text repeats', () => {
    const dup = ['}', 'a', '}', 'b', '}'];
    expect(relocateRange(dup, { start: 4, end: 4 }, '}').start).toBe(3);
  });

  it('falls back to the clamped range when the anchor is gone', () => {
    expect(relocateRange(lines, { start: 5, end: 9 }, 'deleted line')).toEqual({ start: 5, end: 6 });
  });
});

describe('layout helpers', () => {
  it('finds a free slot that does not overlap existing nodes', () => {
    const existing = [{ position: { x: 0, y: 0 }, width: 100, height: 100 }];
    const p = findFreePosition(existing, { x: 0, y: 0 }, { width: 100, height: 100 });
    expect(p.x >= 140 || p.y >= 140).toBe(true);
  });
});

describe('paths', () => {
  it('stores workspace files relative to the workspace root', () => {
    expect(toWorkspacePath('/c:/repo', '/c:/repo/src/a.ts')).toBe('src/a.ts');
    expect(toWorkspacePath('/c:/repo/', '/c:/repo/src/a.ts')).toBe('src/a.ts');
    expect(toWorkspacePath('/C:/Repo', '/c:/repo/src/a.ts')).toBe('src/a.ts');
    expect(toWorkspacePath('/c:/repo', '/c:/other/a.ts')).toBeUndefined();
    expect(toWorkspacePath('/c:/repo', '/c:/repository/a.ts')).toBeUndefined();
  });

  it('recognizes absolute paths and URIs', () => {
    expect(isAbsoluteWorkspacePath('src/a.ts')).toBe(false);
    expect(isAbsoluteWorkspacePath('C:/x/a.ts')).toBe(true);
    expect(isAbsoluteWorkspacePath('/home/a.ts')).toBe(true);
    expect(isAbsoluteWorkspacePath('vscode-remote://ssh/x.ts')).toBe(true);
  });

  it('sanitizes workspace names', () => {
    expect(sanitizeWorkspaceName('  auth/flow: v2.workspace ')).toBe('auth-flow- v2');
  });
});

describe('restack', () => {
  // f1, f2, f3 are top-level; e1..e3 belong to f1 and are interleaved with other items.
  const items = [
    { id: 'f1' },
    { id: 'f2' },
    { id: 'e1', p: 'f1' },
    { id: 'f3' },
    { id: 'e2', p: 'f1' },
    { id: 'e3', p: 'f1' },
  ];
  const group = (t: { p?: string }) => t.p;
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(',');

  it('moves within the group, keeping other items in their slots', () => {
    expect(ids(restack(items, group, 'f1', 'front'))).toBe('f2,f3,e1,f1,e2,e3');
    expect(ids(restack(items, group, 'f3', 'back'))).toBe('f3,f1,e1,f2,e2,e3');
    expect(ids(restack(items, group, 'f1', 'forward'))).toBe('f2,f1,e1,f3,e2,e3');
    expect(ids(restack(items, group, 'e3', 'backward'))).toBe('f1,f2,e1,f3,e3,e2');
  });

  it('returns the same array when nothing changes', () => {
    expect(restack(items, group, 'f3', 'front')).toBe(items);
    expect(restack(items, group, 'e1', 'backward')).toBe(items);
    expect(restack(items, group, 'missing', 'front')).toBe(items);
  });

  it('reports the position in the group', () => {
    expect(stackPosition(items, group, 'f3')).toEqual({ isFront: true, isBack: false });
    expect(stackPosition(items, group, 'e1')).toEqual({ isFront: false, isBack: true });
  });

  it('survives serialization (relative order of files and of editors is kept)', () => {
    const workspace = parseWorkspace(
      JSON.stringify({
        nodes: [
          { id: 'b', type: 'file', file: 'b.ts', position: { x: 0, y: 0 }, width: 100, height: 100 },
          { id: 'a', type: 'file', file: 'a.ts', position: { x: 0, y: 0 }, width: 100, height: 100 },
          { id: 'eb', type: 'editor', parent: 'b' },
          { id: 'ea', type: 'editor', parent: 'a' },
        ],
      }),
    ).workspace;
    expect(ids(parseWorkspace(serializeWorkspace(workspace)).workspace.nodes)).toBe('b,a,eb,ea');
  });
});

describe('folder nodes', () => {
  const base = { lineHeight: 20, origin: { x: 0, y: 0 } };
  const withFolders = (): WorkspaceFile =>
    parseWorkspace(
      JSON.stringify({
        nodes: [
          { id: 'src', type: 'folder', folder: 'src', color: '#C5E3FF', tags: ['x'], position: { x: 0, y: 0 }, width: 800, height: 400 },
          { id: 'pages', type: 'folder', folder: 'src/pages', title: 'Pages', showTitle: false, position: { x: 1000, y: 0 } },
        ],
      }),
    ).workspace;

  it('parses, fills defaults and round-trips', () => {
    const ws = withFolders();
    expect(ws.nodes.find((n) => n.id === 'src')).toMatchObject({ type: 'folder', folder: 'src', color: '#c5e3ff', tags: undefined, width: 800 });
    expect(ws.nodes.find((n) => n.id === 'pages')).toMatchObject({ title: 'Pages', showTitle: false, ...DEFAULT_FOLDER_SIZE });
    const once = serializeWorkspace(ws);
    expect(serializeWorkspace(parseWorkspace(once).workspace)).toBe(once);
  });

  it('can hold other boxes', () => {
    const { workspace } = parseWorkspace(
      JSON.stringify({ nodes: [{ id: 'd', type: 'folder', folder: 'src' }, { id: 't', type: 'text', text: 'hi', parent: 'd' }] }),
    );
    expect(workspace.nodes.find((n) => n.id === 't')?.parent).toBe('d');
  });

  it('matches paths inside a folder', () => {
    expect(isInFolder('src/a.ts', 'src')).toBe(true);
    expect(isInFolder('srcx/a.ts', 'src')).toBe(false);
    expect(isInFolder('src', 'src')).toBe(false);
    expect(isInFolder('a.ts', '')).toBe(true);
    expect(isInFolder('/abs/a.ts', '')).toBe(false);
    expect(isInFolder('C:/Repo/src/a.ts', 'c:/repo/src')).toBe(true);
  });

  it('adds a new file into the deepest folder that contains it, side by side then below', () => {
    const one = addSnippet(withFolders(), { ...base, file: 'src/pages/a.ts' });
    const fa = one.workspace.nodes.find(isFileNode)!;
    expect(fa).toMatchObject({ parent: 'pages', position: { x: GROUP_PADDING, y: FILE_HEADER_HEIGHT + GROUP_PADDING } });
    const pages = one.workspace.nodes.find((n) => n.id === 'pages')!;
    expect(pages.width).toBeGreaterThanOrEqual(fa.position.x + fa.width + GROUP_PADDING);

    const two = addSnippet(withFolders(), { ...base, file: 'src/b.ts' });
    expect(two.workspace.nodes.find(isFileNode)?.parent).toBe('src');
    // A second file does not fit beside the first in the 800px folder: it goes below.
    const three = addSnippet(two.workspace, { ...base, file: 'src/c.ts' });
    const [fb, fc] = three.workspace.nodes.filter(isFileNode);
    expect(fc).toMatchObject({ parent: 'src', position: { x: GROUP_PADDING, y: fb.position.y + fb.height + FOLDER_GAP } });
  });

  it('leaves files outside folders, and drops at their position', () => {
    expect(addSnippet(withFolders(), { ...base, file: 'lib/a.ts' }).workspace.nodes.find(isFileNode)?.parent).toBeUndefined();
    const dropped = addSnippet(withFolders(), { ...base, file: 'src/a.ts', position: { x: 5, y: 6 } });
    expect(dropped.workspace.nodes.find(isFileNode)).toMatchObject({ position: { x: 5, y: 6 } });
    expect(dropped.workspace.nodes.find(isFileNode)?.parent).toBeUndefined();
  });

  it('adds a folder once', () => {
    const one = addFolder(emptyWorkspace(), { folder: 'src', origin: { x: 0, y: 0 }, position: { x: 10, y: 20 } });
    expect(one).toMatchObject({ created: true });
    expect(one.workspace.nodes[0]).toMatchObject({ type: 'folder', folder: 'src', position: { x: 10, y: 20 }, ...DEFAULT_FOLDER_SIZE });
    const again = addFolder(one.workspace, { folder: 'src', origin: { x: 0, y: 0 } });
    expect(again).toMatchObject({ created: false, folderId: one.folderId, workspace: one.workspace });
  });
});

describe('file body color', () => {
  it('parses (lowercased, invalid dropped) and round-trips', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'f', type: 'file', file: 'a.ts', color: '#B6D7A8', position: { x: 0, y: 0 }, width: 300, height: 200 },
        { id: 'g', type: 'file', file: 'b.ts', color: 'green', position: { x: 400, y: 0 }, width: 300, height: 200 },
      ],
    });
    const { workspace } = parseWorkspace(text);
    expect(workspace.nodes.find((n) => n.id === 'f')).toMatchObject({ color: '#b6d7a8' });
    expect(workspace.nodes.find((n) => n.id === 'g')).toMatchObject({ color: undefined });
    const once = serializeWorkspace(workspace);
    expect(JSON.parse(once).nodes.find((n: any) => n.id === 'g')).not.toHaveProperty('color');
    expect(serializeWorkspace(parseWorkspace(once).workspace)).toBe(once);
  });
});

describe('locks', () => {
  const text = JSON.stringify({
    nodes: [
      { id: 'g', type: 'group', title: 'G', locked: true, position: { x: 0, y: 0 }, width: 900, height: 700 },
      { id: 'd', type: 'folder', folder: 'src', parent: 'g', locked: 'yes', position: { x: 20, y: 40 }, width: 800, height: 600 },
      { id: 'f', type: 'file', file: 'src/a.ts', parent: 'd', position: { x: 20, y: 60 }, width: 640, height: 420 },
      { id: 'e', type: 'editor', parent: 'f', locked: true, position: { x: 0, y: 40 }, width: 640, height: 380 },
      { id: 'n', type: 'note', text: 'x', locked: true, position: { x: 1000, y: 0 } },
      { id: 'd2', type: 'folder', folder: 'lib', locked: true, position: { x: 1000, y: 400 }, width: 400, height: 300 },
    ],
  });

  it('parses only `true` on lockable kinds and round-trips', () => {
    const { workspace } = parseWorkspace(text);
    const byId = (id: string) => workspace.nodes.find((n) => n.id === id) as { locked?: boolean };
    expect(byId('g').locked).toBe(true);
    expect(byId('d').locked).toBeUndefined();
    expect(byId('e').locked).toBe(true);
    const once = serializeWorkspace(workspace);
    const saved = JSON.parse(once).nodes;
    expect(saved.find((n: any) => n.id === 'n')).not.toHaveProperty('locked');
    expect(saved.find((n: any) => n.id === 'f')).not.toHaveProperty('locked');
    expect(serializeWorkspace(parseWorkspace(once).workspace)).toBe(once);
  });

  it('locks everything inside a locked node', () => {
    const { workspace } = parseWorkspace(text);
    expect(['g', 'd', 'f', 'e'].map((id) => isLocked(workspace, id))).toEqual([true, true, true, true]);
    expect(isLocked(workspace, 'n')).toBe(false);
    const open = { ...workspace, nodes: workspace.nodes.map((n) => (n.id === 'g' ? { ...n, locked: undefined } : n)) };
    expect(['g', 'd', 'f', 'e'].map((id) => isLocked(open, id))).toEqual([false, false, false, true]);
  });

  it('adds no snippet to a locked file and no file to a locked folder', () => {
    const { workspace } = parseWorkspace(text);
    const snippet = addSnippet(workspace, { file: 'src/a.ts', target: { start: 50, end: 60 }, lineHeight: 19, origin: { x: 0, y: 0 } });
    expect(snippet).toMatchObject({ created: false, editorId: 'e' });
    const file = addSnippet(workspace, { file: 'lib/b.ts', lineHeight: 19, origin: { x: 0, y: 0 } });
    expect(file.created).toBe(true);
    expect(file.workspace.nodes.find((n) => isFileNode(n) && n.file === 'lib/b.ts')).not.toHaveProperty('parent');
  });
});
