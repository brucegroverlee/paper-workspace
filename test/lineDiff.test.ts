import { describe, expect, it } from 'vitest';
import { diffLines, gitMarks, splitLines, subtractMarks } from '../src/shared/lineDiff';

const marks = (a: string, b: string) => gitMarks(diffLines(a.split(''), b.split('')));

/** Applies hunks to `a` using lines from `b`; must give back `b` for any correct diff. */
function patch(a: string[], b: string[]) {
  const out: string[] = [];
  let i = 0;
  for (const h of diffLines(a, b)) {
    const origStart = h.origStart - 1;
    out.push(...a.slice(i, origStart), ...b.slice(h.modStart - 1, h.modStart - 1 + h.modCount));
    i = origStart + h.origCount;
  }
  return [...out, ...a.slice(i)];
}

describe('diffLines / gitMarks', () => {
  it('reports nothing for identical text', () => {
    expect(marks('abc', 'abc')).toEqual([]);
  });

  it('marks added lines', () => {
    expect(marks('abc', 'abXYc')).toEqual([{ kind: 'added', start: 3, end: 4 }]);
    expect(marks('', 'ab')).toEqual([{ kind: 'added', start: 1, end: 2 }]);
  });

  it('marks modified lines', () => {
    expect(marks('abcd', 'aXYd')).toEqual([{ kind: 'modified', start: 2, end: 3 }]);
  });

  it('marks deletions after the line they follow, 0 for the top of the file', () => {
    expect(marks('abcd', 'ad')).toEqual([{ kind: 'deleted', start: 1, end: 1 }]);
    expect(marks('abcd', 'cd')).toEqual([{ kind: 'deleted', start: 0, end: 0 }]);
    expect(marks('abcd', 'ab')).toEqual([{ kind: 'deleted', start: 2, end: 2 }]);
  });

  it('finds several separate changes', () => {
    expect(marks('abcdefgh', 'aXcdeYZfh')).toEqual([
      { kind: 'modified', start: 2, end: 2 },
      { kind: 'added', start: 6, end: 7 },
      { kind: 'deleted', start: 8, end: 8 },
    ]);
  });

  it('produces hunks that turn the base into the current text', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcde'[Math.floor(rnd() * 5)]);
      const b = Array.from({ length: Math.floor(rnd() * 30) }, () => 'abcde'[Math.floor(rnd() * 5)]);
      expect(patch(a, b)).toEqual(b);
    }
  });

  it('falls back to one change when the texts differ too much', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = ['a0', ...Array.from({ length: 50 }, (_, i) => `b${i}`), 'a49'];
    expect(diffLines(a, b, 10)).toEqual([{ origStart: 2, origCount: 48, modStart: 2, modCount: 50 }]);
  });

  it('splits lines on any line ending', () => {
    expect(splitLines('a\r\nb\nc\n')).toEqual(['a', 'b', 'c', '']);
  });
});

describe('subtractMarks', () => {
  it('keeps what only the older base sees: staged changes', () => {
    // HEAD "abcd" -> index "aXcd" (staged: line 2 modified) -> current "aXcYd" (unstaged: line 4 added).
    const all = marks('abcd', 'aXcYd');
    const unstaged = marks('aXcd', 'aXcYd');
    expect(unstaged).toEqual([{ kind: 'added', start: 4, end: 4 }]);
    expect(subtractMarks(all, unstaged)).toEqual([{ kind: 'modified', start: 2, end: 2 }]);
  });

  it('cuts ranges around unstaged lines and drops deletions shown as unstaged', () => {
    const all = [
      { kind: 'added' as const, start: 1, end: 5 },
      { kind: 'deleted' as const, start: 7, end: 7 },
      { kind: 'deleted' as const, start: 9, end: 9 },
    ];
    const unstaged = [
      { kind: 'modified' as const, start: 3, end: 3 },
      { kind: 'deleted' as const, start: 7, end: 7 },
    ];
    expect(subtractMarks(all, unstaged)).toEqual([
      { kind: 'added', start: 1, end: 2 },
      { kind: 'added', start: 4, end: 5 },
      { kind: 'deleted', start: 9, end: 9 },
    ]);
  });
});
