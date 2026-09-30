// Grammars and the active color theme, read from installed extensions, so papers color code like the text editor.
import * as vscode from 'vscode';
import { parseRawGrammar } from 'vscode-textmate';
import { parseJsonc } from '../shared/jsonc';
import { customizationRules, type GrammarInfo, type TextmateInit, type TextmateRequest, type TextmateResult, type TextmateTheme, type TokenColorRule } from '../shared/textmate';

interface ContributedGrammar {
  language?: string;
  scopeName?: string;
  path?: string;
  injectTo?: string[];
  embeddedLanguages?: Record<string, string>;
  tokenTypes?: Record<string, string>;
  balancedBracketScopes?: string[];
  unbalancedBracketScopes?: string[];
}
interface ContributedTheme {
  id?: string;
  label?: string;
  uiTheme?: string;
  path?: string;
}

/** Everything read from `vscode.extensions.all`; rebuilt when extensions change. */
let catalog:
  | {
      grammars: Map<string, { info: GrammarInfo; uri: vscode.Uri }>;
      themes: Array<{ settingsId: string; uiTheme?: string; uri: vscode.Uri }>;
      languageConfigs: Map<string, vscode.Uri>;
    }
  | undefined;
vscode.extensions.onDidChange(() => (catalog = undefined));

function getCatalog() {
  if (catalog) return catalog;
  const grammars = new Map<string, { info: GrammarInfo; uri: vscode.Uri }>();
  const themes: Array<{ settingsId: string; uiTheme?: string; uri: vscode.Uri }> = [];
  const languageConfigs = new Map<string, vscode.Uri>();
  for (const ext of vscode.extensions.all) {
    const contributes = ext.packageJSON?.contributes ?? {};
    for (const g of (contributes.grammars ?? []) as ContributedGrammar[]) {
      if (!g.scopeName || !g.path) continue;
      const { scopeName, language, injectTo, embeddedLanguages, tokenTypes, balancedBracketScopes, unbalancedBracketScopes } = g;
      const existing = grammars.get(scopeName);
      // Keep the language of an earlier registration if a later one only re-registers the scope.
      grammars.set(scopeName, {
        info: { scopeName, language: language ?? existing?.info.language, injectTo, embeddedLanguages, tokenTypes, balancedBracketScopes, unbalancedBracketScopes },
        uri: vscode.Uri.joinPath(ext.extensionUri, g.path),
      });
    }
    for (const t of (contributes.themes ?? []) as ContributedTheme[]) {
      const settingsId = t.id ?? t.label;
      if (settingsId && t.path) themes.push({ settingsId, uiTheme: t.uiTheme, uri: vscode.Uri.joinPath(ext.extensionUri, t.path) });
    }
    for (const l of (contributes.languages ?? []) as Array<{ id?: string; configuration?: string }>) {
      if (l.id && l.configuration && !languageConfigs.has(l.id)) languageConfigs.set(l.id, vscode.Uri.joinPath(ext.extensionUri, l.configuration));
    }
  }
  return (catalog = { grammars, themes, languageConfigs });
}

async function readText(uri: vscode.Uri) {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

const UI_THEME_KIND: Record<string, vscode.ColorThemeKind> = {
  vs: vscode.ColorThemeKind.Light,
  'vs-dark': vscode.ColorThemeKind.Dark,
  'hc-black': vscode.ColorThemeKind.HighContrast,
  'hc-light': vscode.ColorThemeKind.HighContrastLight,
};

/** Built-in themes' setting values carry a legacy "Default " prefix ("Default Dark Modern" is id "Dark Modern"). */
const themeKey = (id: string) => id.replace(/^Default /, '');

/** The theme in use: `workbench.colorTheme`, or a preferred theme when the OS color scheme picked one. */
function activeTheme() {
  const { themes } = getCatalog();
  const wb = vscode.workspace.getConfiguration('workbench');
  const kind = vscode.window.activeColorTheme.kind;
  const candidates = ['colorTheme', 'preferredDarkColorTheme', 'preferredLightColorTheme', 'preferredHighContrastColorTheme', 'preferredHighContrastLightColorTheme']
    .map((key) => wb.get<string>(key))
    .map((id) => id && themes.find((t) => themeKey(t.settingsId) === themeKey(id)))
    .filter((t): t is (typeof themes)[number] => !!t);
  return candidates.find((t) => !t.uiTheme || UI_THEME_KIND[t.uiTheme] === kind) ?? candidates[0];
}

/** Token color rules of a theme file, following `include` and `tokenColors` pointing at a .tmTheme file. */
async function themeRules(uri: vscode.Uri, depth = 0): Promise<TokenColorRule[]> {
  if (depth > 10) return [];
  const text = await readText(uri);
  if (!/\.json$/i.test(uri.path)) return plistRules(text, uri.path);
  const json = parseJsonc(text) as { include?: string; tokenColors?: TokenColorRule[] | string };
  const rules: TokenColorRule[] = [];
  const near = (p: string) => vscode.Uri.joinPath(uri, '..', p);
  if (json.include) rules.push(...(await themeRules(near(json.include), depth + 1)));
  if (typeof json.tokenColors === 'string') rules.push(...plistRules(await readText(near(json.tokenColors)), json.tokenColors));
  else if (Array.isArray(json.tokenColors)) rules.push(...json.tokenColors);
  return rules;
}

/** A .tmTheme (plist) file's rules; vscode-textmate's grammar reader parses any plist. */
function plistRules(text: string, path: string): TokenColorRule[] {
  const plist = parseRawGrammar(text, path.replace(/\.[^./]*$/, '.plist')) as unknown as { settings?: TokenColorRule[] };
  return Array.isArray(plist.settings) ? plist.settings : [];
}

/** The active theme's token colors plus the user's `editor.tokenColorCustomizations`; undefined if it can't be read. */
export async function readTextmateTheme(): Promise<TextmateTheme | undefined> {
  const theme = activeTheme();
  if (!theme) return undefined;
  try {
    const rules = await themeRules(theme.uri);
    rules.push(...customizationRules(vscode.workspace.getConfiguration('editor').get('tokenColorCustomizations'), theme.settingsId));
    return { name: theme.settingsId, rules: rules.filter((r) => r && typeof r === 'object' && r.settings) };
  } catch (e) {
    console.warn(`[paper-workspace] could not read color theme ${theme.settingsId}`, e);
    return undefined;
  }
}

export async function readTextmateInit(): Promise<TextmateInit | undefined> {
  const theme = await readTextmateTheme();
  if (!theme) return undefined;
  return { theme, grammars: [...getCatalog().grammars.values()].map((g) => g.info) };
}

export async function textmateRequest(request: TextmateRequest): Promise<TextmateResult> {
  try {
    if (request.kind === 'grammar') {
      const g = getCatalog().grammars.get(request.scopeName);
      return g ? { content: await readText(g.uri), path: g.uri.path } : null;
    }
    const uri = getCatalog().languageConfigs.get(request.languageId);
    return uri ? (parseJsonc(await readText(uri)) as Record<string, unknown>) : null;
  } catch (e) {
    console.warn('[paper-workspace] textmate request failed', request, e);
    return null;
  }
}

/** Settings that change the token colors. */
export function affectsTextmateTheme(e: vscode.ConfigurationChangeEvent) {
  return ['workbench.colorTheme', 'workbench.preferredDarkColorTheme', 'workbench.preferredLightColorTheme', 'editor.tokenColorCustomizations'].some((k) =>
    e.affectsConfiguration(k),
  );
}
