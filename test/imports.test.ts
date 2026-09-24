import { describe, expect, it } from 'vitest';
import { candidatePaths, moduleSpecifierAt, quotedStringAt } from '../src/shared/imports';

const IMPORT = "import NonAdminInfoBanner from './components/NonAdminInfoBanner';";
const col = (line: string, needle: string) => line.indexOf(needle) + 1;

describe('quotedStringAt', () => {
  it('finds the string around a column, with 1-based content columns', () => {
    const hit = quotedStringAt(IMPORT, col(IMPORT, 'components'));
    expect(hit?.text).toBe('./components/NonAdminInfoBanner');
    expect(IMPORT.slice(hit!.start - 1, hit!.end - 1)).toBe('./components/NonAdminInfoBanner');
  });

  it('includes the quotes themselves and nothing outside', () => {
    expect(quotedStringAt(IMPORT, col(IMPORT, "'"))?.text).toBe('./components/NonAdminInfoBanner');
    expect(quotedStringAt(IMPORT, col(IMPORT, 'NonAdmin'))).toBeUndefined();
  });
});

describe('moduleSpecifierAt', () => {
  it('returns the clicked module path', () => {
    expect(moduleSpecifierAt(IMPORT, col(IMPORT, 'components'))?.text).toBe('./components/NonAdminInfoBanner');
  });

  it('returns the line specifier when clicking the imported name', () => {
    expect(moduleSpecifierAt(IMPORT, col(IMPORT, 'NonAdmin'))?.text).toBe('./components/NonAdminInfoBanner');
  });

  it('handles require, dynamic import, re-exports and CSS imports', () => {
    expect(moduleSpecifierAt("const x = require('./x');", 12)?.text).toBe('./x');
    expect(moduleSpecifierAt("const Page = lazy(() => import('./Page'));", 5)?.text).toBe('./Page');
    expect(moduleSpecifierAt('export { a } from "../a";', 3)?.text).toBe('../a');
    expect(moduleSpecifierAt("@import 'vars';", 2)?.text).toBe('vars');
  });

  it('ignores strings on ordinary lines (JSX, calls)', () => {
    const jsx = '      <TouchTunesServices title="Services" />';
    expect(moduleSpecifierAt(jsx, col(jsx, 'Services"'))).toBeUndefined();
    expect(moduleSpecifierAt("console.log('./not-an-import');", 15)).toBeUndefined();
  });
});

describe('candidatePaths', () => {
  it('tries the path, extensions, then index files', () => {
    const c = candidatePaths('./components/Banner');
    expect(c[0]).toBe('./components/Banner');
    expect(c).toContain('./components/Banner.tsx');
    expect(c).toContain('./components/Banner/index.ts');
    expect(c.indexOf('./components/Banner.tsx')).toBeLessThan(c.indexOf('./components/Banner/index.ts'));
  });

  it('leaves bare and aliased specifiers to the language service', () => {
    expect(candidatePaths('react')).toEqual([]);
    expect(candidatePaths('@components/full-screen-modal')).toEqual([]);
    expect(candidatePaths('..')).toContain('../index.ts');
  });
});
