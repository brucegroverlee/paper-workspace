import { describe, expect, it } from 'vitest';
import { parseJsonc } from '../src/shared/jsonc';
import { customizationRules } from '../src/shared/textmate';

describe('parseJsonc', () => {
  it('accepts comments and trailing commas', () => {
    const text = `{
      // a theme
      "name": "x", /* inline */
      "tokenColors": [{ "scope": "comment", "settings": { "foreground": "#6A9955", }, },],
    }`;
    expect(parseJsonc(text)).toEqual({ name: 'x', tokenColors: [{ scope: 'comment', settings: { foreground: '#6A9955' } }] });
  });

  it('leaves comment-like and comma text inside strings alone', () => {
    expect(parseJsonc('{ "url": "http://a/*b*/", "s": "x,]", "q": "say \\"hi\\" // no" }')).toEqual({
      url: 'http://a/*b*/',
      s: 'x,]',
      q: 'say "hi" // no',
    });
  });
});

describe('customizationRules', () => {
  it('turns shortcuts and textMateRules into rules, theme-scoped ones last', () => {
    const rules = customizationRules(
      {
        comments: '#111111',
        textMateRules: [{ scope: 'keyword', settings: { fontStyle: 'bold' } }],
        '[Dark Modern]': { strings: { foreground: '#222222' } },
        '[Other]': { numbers: '#333333' },
      },
      'Dark Modern',
    );
    expect(rules).toEqual([
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#111111' } },
      { scope: 'keyword', settings: { fontStyle: 'bold' } },
      { scope: ['string', 'meta.embedded.assembly'], settings: { foreground: '#222222' } },
    ]);
  });

  it('ignores missing or malformed values', () => {
    expect(customizationRules(undefined, 'x')).toEqual([]);
    expect(customizationRules({ textMateRules: [null, { scope: 'a' }] }, 'x')).toEqual([]);
  });
});
