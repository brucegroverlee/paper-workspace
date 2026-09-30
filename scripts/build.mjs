// Builds the extension host bundle, the canvas webview bundle and Monaco's editor worker.
//   --watch       rebuild on change
//   --production  minify, no sourcemaps
//   --harness     also emit dist/harness/ for testing the webview in a normal browser
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const harness = process.argv.includes('--harness');

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'linked',
  logLevel: 'info',
  legalComments: 'none',
};

const builds = [
  {
    ...common,
    entryPoints: { extension: 'src/extension/extension.ts' },
    outdir: 'dist',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
  },
  {
    ...common,
    entryPoints: { webview: 'src/webview/main.tsx' },
    outdir: 'dist',
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.ttf': 'file' },
    assetNames: '[name]-[hash]',
    define: {
      'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
      __HARNESS__: JSON.stringify(harness),
    },
  },
  {
    ...common,
    entryPoints: { 'editor.worker': 'node_modules/monaco-editor/esm/vs/editor/editor.worker.js' },
    outdir: 'dist',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: false,
  },
];

rmSync('dist', { recursive: true, force: true });
if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
// The regex engine TextMate grammars run on (webview/textmate.ts loads it from the page's `pw-onig` URL).
mkdirSync('dist', { recursive: true });
cpSync('node_modules/vscode-oniguruma/release/onig.wasm', 'dist/onig.wasm');
if (harness) {
  mkdirSync('dist/harness', { recursive: true });
  cpSync('scripts/harness', 'dist/harness', { recursive: true });
}
