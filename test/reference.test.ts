import { describe, expect, it } from 'vitest';
import { formatReference, parseReference } from '../src/shared/reference';

describe('workspace references', () => {
  it('formats a workspace and an item', () => {
    expect(formatReference({ workspace: '.paperworkspace/How login works.workspace' })).toBe('paperworkspace:.paperworkspace/How login works.workspace');
    expect(formatReference({ workspace: '.paperworkspace/Auth.workspace', node: { type: 'editor', id: 'e_route' } })).toBe(
      'paperworkspace:.paperworkspace/Auth.workspace#editor/e_route',
    );
    expect(formatReference({ workspace: 'C:\\work\\Auth.workspace' })).toBe('paperworkspace:C:/work/Auth.workspace');
  });

  it('parses what it formats, ignoring quotes and whitespace', () => {
    const ref = { workspace: '.paperworkspace/How login works.workspace', node: { type: 'note', id: 'n_mb3x9kq' } };
    expect(parseReference(formatReference(ref))).toEqual(ref);
    expect(parseReference(`  \`${formatReference(ref)}\`\n`)).toEqual(ref);
    expect(parseReference('paperworkspace:.paperworkspace/A.workspace')).toEqual({ workspace: '.paperworkspace/A.workspace' });
  });

  it('splits on the last # so workspace names may contain one', () => {
    expect(parseReference('paperworkspace:.paperworkspace/Bug #12.workspace#file/f_1')).toEqual({
      workspace: '.paperworkspace/Bug #12.workspace',
      node: { type: 'file', id: 'f_1' },
    });
  });

  it('rejects other text', () => {
    expect(parseReference('src/auth.ts')).toBeUndefined();
    expect(parseReference('paperworkspace:')).toBeUndefined();
    expect(parseReference('paperworkspace:.paperworkspace/A.workspace#editor')).toBeUndefined();
    expect(parseReference('paperworkspace:.paperworkspace/A.workspace#/e_1')).toBeUndefined();
  });
});
