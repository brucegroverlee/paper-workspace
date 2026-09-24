// Import-path helpers for Ctrl/Cmd+click in workspaces. Pure string logic so it can be unit tested.

/** A quoted string on a line: its contents and 1-based columns of the contents (end exclusive). */
export interface QuotedString {
  text: string;
  start: number;
  end: number;
}

const MODULE_LINE = /^\s*(import|export)\b|\brequire\s*\(|\bimport\s*\(|^\s*@(import|use|forward)\b/;

/** The quoted string containing 1-based `column`, if any. Escapes and template literals are not handled. */
export function quotedStringAt(line: string, column: number): QuotedString | undefined {
  const re = /(['"`])((?:(?!\1).)*)\1/g;
  for (let m: RegExpExecArray | null; (m = re.exec(line)); ) {
    const start = m.index + 2; // column of the first character inside the quotes
    const end = start + m[2].length;
    if (column >= start - 1 && column <= end) return { text: m[2], start, end };
  }
  return undefined;
}

/**
 * The module specifier to open when clicking at `column` on an import-like line:
 * the clicked string, or the line's only specifier when clicking elsewhere (e.g. on the imported name).
 */
export function moduleSpecifierAt(line: string, column: number): QuotedString | undefined {
  if (!MODULE_LINE.test(line)) return undefined;
  const hit = quotedStringAt(line, column);
  if (hit) return hit.text ? hit : undefined;
  const all = [...line.matchAll(/(['"`])((?:(?!\1).)+)\1/g)];
  if (all.length !== 1) return undefined;
  const m = all[0];
  return { text: m[2], start: m.index! + 2, end: m.index! + 2 + m[2].length };
}

/** Extensions tried, in order, when a relative specifier has none (TS/JS resolution plus common assets). */
export const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.json'];

/**
 * Candidate paths (POSIX, relative to the importing file's directory) for a relative specifier, most likely first.
 * Returns [] for bare or aliased specifiers (`react`, `@components/x`): those need the language service.
 */
export function candidatePaths(specifier: string): string[] {
  if (!/^\.\.?(\/|$)/.test(specifier)) return [];
  const base = specifier.replace(/\/+$/, '');
  const exts = RESOLVE_EXTENSIONS;
  return [base, ...exts.map((e) => base + e), ...exts.map((e) => `${base}/index${e}`)];
}
