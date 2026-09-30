// Line diff between a file's git base and its current text, turned into VS Code-style gutter marks.

/** A changed region; starts are 1-based. A count of 0 means lines were only added (orig) or only removed (mod). */
export interface Hunk {
  origStart: number;
  origCount: number;
  modStart: number;
  modCount: number;
}

/**
 * A gutter mark on the current text. `added` / `modified` cover lines `start..end`; `deleted` marks lines removed
 * after line `start` (0 = before the first line), with `end === start`.
 */
export interface GitMark {
  kind: 'added' | 'modified' | 'deleted';
  start: number;
  end: number;
}

/** Past this many differing lines the middle of the file is reported as one change instead of diffed precisely. */
const MAX_COST = 1500;

/** Myers diff of two line arrays, after trimming the common prefix and suffix. */
export function diffLines(a: readonly string[], b: readonly string[], maxCost = MAX_COST): Hunk[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  if (!A.length && !B.length) return [];

  const matches = myers(A, B, maxCost) ?? [];
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  const flush = (mi: number, mj: number) => {
    if (mi > i || mj > j) hunks.push({ origStart: pre + i + 1, origCount: mi - i, modStart: pre + j + 1, modCount: mj - j });
  };
  for (const [mi, mj] of matches) {
    flush(mi, mj);
    i = mi + 1;
    j = mj + 1;
  }
  flush(A.length, B.length);
  return hunks;
}

/** Matched line pairs `[indexInA, indexInB]` in order, or null when the edit distance exceeds `max`. */
function myers(A: readonly string[], B: readonly string[], max: number): Array<[number, number]> | null {
  const n = A.length;
  const m = B.length;
  const limit = Math.min(max, n + m);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  // trace[d] holds v for k in [-d, d] after step d, at index k + d.
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= limit && !found; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    trace.push(v.slice(offset - d, offset + d + 1));
  }
  if (!found) return null;

  const pairs: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d - 1];
    const at = (k: number) => prev[k + d - 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) pairs.push([--x, --y]);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) pairs.push([--x, --y]);
  return pairs.reverse();
}

/** Classify hunks the way VS Code's gutter does: pure additions, pure deletions, and everything else as modified. */
export function gitMarks(hunks: readonly Hunk[]): GitMark[] {
  return hunks.map((h) => {
    if (h.modCount === 0) return { kind: 'deleted', start: h.modStart - 1, end: h.modStart - 1 };
    const end = h.modStart + h.modCount - 1;
    return { kind: h.origCount === 0 ? 'added' : 'modified', start: h.modStart, end };
  });
}

/**
 * The marks of `all` (current text vs an older base, e.g. HEAD) not already shown by `unstaged` (current text vs
 * the index): what differs only from the older base, i.e. staged (or committed since that base) changes. Ranges are
 * cut around lines `unstaged` covers; a deletion is dropped when `unstaged` has one at the same place.
 */
export function subtractMarks(all: readonly GitMark[], unstaged: readonly GitMark[]): GitMark[] {
  const covered = new Set<number>();
  const deletedAt = new Set<number>();
  for (const m of unstaged) {
    if (m.kind === 'deleted') deletedAt.add(m.start);
    else for (let l = m.start; l <= m.end; l++) covered.add(l);
  }
  const out: GitMark[] = [];
  for (const m of all) {
    if (m.kind === 'deleted') {
      if (!deletedAt.has(m.start)) out.push(m);
      continue;
    }
    let start = -1;
    for (let l = m.start; l <= m.end + 1; l++) {
      const free = l <= m.end && !covered.has(l);
      if (free && start < 0) start = l;
      if (!free && start >= 0) {
        out.push({ kind: m.kind, start, end: l - 1 });
        start = -1;
      }
    }
  }
  return out;
}

/** Split text into lines the way editors number them (a trailing newline yields a last empty line). */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}
