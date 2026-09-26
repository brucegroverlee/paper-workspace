import { describe, expect, it } from 'vitest';
import {
  BUNDLE_FORMAT,
  createBundle,
  isWorkspaceOwnedPath,
  localMediaSources,
  mediaFolderPath,
  parseBundle,
  rebaseMediaSources,
  rewriteMediaSources,
  serializeBundle,
} from '../src/shared/bundle';
import type { WorkspaceFile } from '../src/shared/workspace';

const rect = { position: { x: 0, y: 0 }, width: 100, height: 80 };
const sample: WorkspaceFile = {
  version: 2,
  nodes: [
    { id: 'f', type: 'file', file: 'src/a.ts', ...rect },
    { id: 'e', type: 'editor', parent: 'f', ...rect },
    { id: 'm1', type: 'media', src: '.paperworkspace/media/main/a.png', ...rect },
    { id: 'm2', type: 'media', src: '.paperworkspace/media/main/a.png', ...rect },
    { id: 'm3', type: 'media', src: 'docs/diagram.svg', ...rect },
    { id: 'm4', type: 'media', src: 'https://example.com/b.png', ...rect },
  ],
  edges: [],
};
const srcs = (w: WorkspaceFile) => w.nodes.flatMap((n) => (n.type === 'media' ? [n.src] : []));

describe('bundle', () => {
  it('lists distinct local media only', () => {
    expect(localMediaSources(sample)).toEqual(['.paperworkspace/media/main/a.png', 'docs/diagram.svg']);
  });

  it('knows which paths a workspace owns', () => {
    expect(mediaFolderPath('main')).toBe('.paperworkspace/media/main');
    expect(isWorkspaceOwnedPath('.paperworkspace/media/main/a.png')).toBe(true);
    expect(isWorkspaceOwnedPath('docs/diagram.svg')).toBe(false);
  });

  it('rewrites and rebases media sources', () => {
    const rewritten = rewriteMediaSources(sample, (s) => (s === 'docs/diagram.svg' ? 'x.svg' : undefined));
    expect(srcs(rewritten)).toEqual(['.paperworkspace/media/main/a.png', '.paperworkspace/media/main/a.png', 'x.svg', 'https://example.com/b.png']);
    const rebased = rebaseMediaSources(sample, '.paperworkspace/media/main', '.paperworkspace/media/renamed');
    expect(srcs(rebased).slice(0, 3)).toEqual(['.paperworkspace/media/renamed/a.png', '.paperworkspace/media/renamed/a.png', 'docs/diagram.svg']);
    // A sibling folder sharing the prefix is not moved.
    const sibling = rebaseMediaSources(
      { ...sample, nodes: [{ id: 'm', type: 'media', src: '.paperworkspace/media/main-2/a.png', ...rect }] },
      '.paperworkspace/media/main',
      '.paperworkspace/media/x',
    );
    expect(srcs(sibling)).toEqual(['.paperworkspace/media/main-2/a.png']);
  });

  it('round-trips through serialize/parse', () => {
    const media = { 'docs/diagram.svg': { name: 'diagram.svg', data: Buffer.from('<svg/>').toString('base64') } };
    const text = serializeBundle(createBundle('main', sample, media, new Date('2026-01-01T00:00:00Z')));
    const parsed = parseBundle(text);
    expect(parsed.name).toBe('main');
    expect(parsed.media).toEqual(media);
    expect(parsed.workspace.nodes.map((n) => n.id).sort()).toEqual(sample.nodes.map((n) => n.id).sort());
    expect(JSON.parse(text).exportedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects files that are not bundles', () => {
    expect(() => parseBundle('nope')).toThrow(/invalid JSON/);
    expect(() => parseBundle(JSON.stringify({ version: 2, nodes: [] }))).toThrow(/Not a Paper Workspace bundle/);
    expect(() => parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, version: 99, workspace: {} }))).toThrow(/newer version/);
  });

  it('drops malformed media entries and defaults the name', () => {
    const parsed = parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, version: 1, workspace: sample, media: { a: { name: 1 }, b: { name: 'b.png', data: '' } } }));
    expect(parsed.name).toBe('imported');
    expect(Object.keys(parsed.media)).toEqual(['b']);
  });
});
