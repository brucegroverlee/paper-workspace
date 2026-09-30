// Gives the webview harness VS Code's highlighting: copies the TypeScript/React grammars, their language
// configurations and a color theme from a VS Code (or fork) install into dist/harness/tm/, which the mock host
// serves like the extension host would. Run after `npm run dev:webview` has built dist/:
//   node scripts/harness-textmate.mjs <path to the install's resources/app/extensions> [theme id, default "Dark Modern"]
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [extensionsDir, themeId = 'Dark Modern'] = process.argv.slice(2);
if (!extensionsDir || !existsSync(extensionsDir)) {
  console.error('usage: node scripts/harness-textmate.mjs <resources/app/extensions> [theme id]');
  process.exit(1);
}
const LANGUAGES = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact']);

// JSONC -> JSON (comments and trailing commas), enough for VS Code's own files.
const jsonc = (text) =>
  JSON.parse(
    text
      .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? '')
      .replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (m, str, close) => str ?? close),
  );

const out = join('dist', 'harness', 'tm');
mkdirSync(out, { recursive: true });
const grammars = [];
let themePath;
for (const name of readdirSync(extensionsDir)) {
  const pkgPath = join(extensionsDir, name, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const { contributes = {} } = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const g of contributes.grammars ?? []) {
    const wanted = LANGUAGES.has(g.language) || (g.injectTo ?? []).some((s) => /source\.(ts|tsx|js|jsx)/.test(s)) || /^source\.js/.test(g.scopeName);
    if (!wanted || !g.scopeName) continue;
    const { path, ...info } = g;
    grammars.push(info);
    writeFileSync(join(out, `${g.scopeName}.json`), readFileSync(join(extensionsDir, name, path)));
  }
  for (const l of contributes.languages ?? []) {
    if (LANGUAGES.has(l.id) && l.configuration) {
      writeFileSync(join(out, `lang.${l.id}.json`), JSON.stringify(jsonc(readFileSync(join(extensionsDir, name, l.configuration), 'utf8'))));
    }
  }
  for (const t of contributes.themes ?? []) if ((t.id ?? t.label) === themeId) themePath = join(extensionsDir, name, t.path);
}
if (!themePath) {
  console.error(`theme "${themeId}" not found`);
  process.exit(1);
}
const rules = (file) => {
  const json = jsonc(readFileSync(file, 'utf8'));
  return [...(json.include ? rules(join(dirname(file), json.include)) : []), ...(Array.isArray(json.tokenColors) ? json.tokenColors : [])];
};
writeFileSync(join(out, 'init.json'), JSON.stringify({ theme: { name: themeId, rules: rules(themePath) }, grammars }));
console.log(`wrote ${grammars.length} grammars and "${themeId}" to ${out}`);
