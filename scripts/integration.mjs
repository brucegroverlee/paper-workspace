// Runs test/integration/suite.cjs inside a real VS Code with an isolated profile and a throwaway workspace.
//   node scripts/integration.mjs [--code <path to Code executable>]
import { runTests } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const codeArg = process.argv.indexOf('--code');
const vscodeExecutablePath = codeArg > 0 ? process.argv[codeArg + 1] : process.env.VSCODE_PATH;

const root = mkdtempSync(join(process.env.PW_TMP || tmpdir(), 'pw-it-'));
const ws = join(root, 'workspace');
mkdirSync(join(ws, 'src'), { recursive: true });
mkdirSync(join(ws, '.paperworkspace'), { recursive: true });
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';
writeFileSync(
  join(ws, 'src', 'a.ts'),
  ['// a.ts', '', 'export function three() {', '  return 3;', '}', '// six', 'export const seven = 7;'].join('\n') + '\n',
);
writeFileSync(join(ws, 'src', 'b.ts'), lines(120, (i) => `export const b${i} = ${i};`));
writeFileSync(join(ws, 'src', 'c.ts'), lines(200, (i) => `export const c${i} = ${i};`));
writeFileSync(join(ws, 'src', 'd.ts'), 'export const d = 1;\n');
mkdirSync(join(ws, 'src', 'components'), { recursive: true });
writeFileSync(join(ws, 'src', 'components', 'Banner.tsx'), 'export default function Banner() {\n  return null;\n}\n');
writeFileSync(join(ws, 'src', 'e.ts'), "import Banner from './components/Banner';\nexport const e = Banner;\n");
// A repository with a.ts and b.ts committed (the rest untracked), for the Git gutter.
const git = (...args) => execFileSync('git', ['-c', 'user.name=pw', '-c', 'user.email=pw@example.com', ...args], { cwd: ws });
git('init', '-q');
git('add', 'src/a.ts', 'src/b.ts');
git('commit', '-q', '-m', 'init');
writeFileSync(join(ws, '.paperworkspace', 'main.workspace'), JSON.stringify({ version: 1, nodes: [], edges: [] }, null, 2) + '\n');

const results = join(root, 'results.txt');
try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: resolve('.'),
    extensionTestsPath: resolve('test/integration/suite.cjs'),
    extensionTestsEnv: { PW_RESULTS: results },
    launchArgs: [ws, '--disable-extensions', '--user-data-dir', join(root, 'user-data'), '--skip-welcome', '--skip-release-notes'],
  });
} catch (e) {
  console.error('VS Code exited with an error:', e);
}
let out = '';
try {
  out = readFileSync(results, 'utf8');
} catch {
  out = 'FAIL no results written (suite crashed before finishing)\n';
}
console.log(out);
process.exit(/^FAIL/m.test(out) ? 1 : 0);
