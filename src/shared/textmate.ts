// Syntax highlighting with VS Code's own TextMate grammars and the active color theme's token colors, so papers
// color code exactly like the text editor. The host reads grammars and themes from installed extensions; the
// webview tokenizes with vscode-textmate (see webview/textmate.ts).

/** A grammar contributed by an extension (`contributes.grammars`). */
export interface GrammarInfo {
  scopeName: string;
  /** VS Code language id, when the grammar is a language's main grammar (not an injection or embedded one). */
  language?: string;
  injectTo?: string[];
  /** Scope name -> VS Code language id of code embedded in this grammar. */
  embeddedLanguages?: Record<string, string>;
  /** Scope name -> 'string' | 'comment' | 'other', overriding the token type derived from the scope name. */
  tokenTypes?: Record<string, string>;
  balancedBracketScopes?: string[];
  unbalancedBracketScopes?: string[];
}

/** One `tokenColors` rule of a theme (the TextMate theme format). */
export interface TokenColorRule {
  name?: string;
  scope?: string | string[];
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

export interface TextmateTheme {
  /** The theme's settings id (`workbench.colorTheme` value). */
  name: string;
  rules: TokenColorRule[];
}

export interface TextmateInit {
  theme: TextmateTheme;
  grammars: GrammarInfo[];
}

export type TextmateRequest = { kind: 'grammar'; scopeName: string } | { kind: 'languageConfiguration'; languageId: string };

/** Grammar file (parsed by vscode-textmate: JSON, or plist when `path` ends in .tmLanguage/.plist), or a raw language-configuration.json object. */
export type TextmateResult = { content: string; path: string } | Record<string, unknown> | null;

// `editor.tokenColorCustomizations` shortcuts, with the scopes VS Code maps them to.
const SHORTCUT_SCOPES: Record<string, string[]> = {
  comments: ['comment', 'punctuation.definition.comment'],
  strings: ['string', 'meta.embedded.assembly'],
  keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
  numbers: ['constant.numeric'],
  types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
  functions: ['entity.name.function', 'support.function'],
  variables: ['variable', 'entity.name.variable'],
};

/**
 * Rules from an `editor.tokenColorCustomizations` value for theme `themeName`: the general entries, then the ones
 * under `[themeName]` (which win, being later).
 */
export function customizationRules(customizations: unknown, themeName: string): TokenColorRule[] {
  if (!customizations || typeof customizations !== 'object') return [];
  const all = customizations as Record<string, unknown>;
  const rules = (c: Record<string, unknown>): TokenColorRule[] => {
    const out: TokenColorRule[] = [];
    for (const [key, scope] of Object.entries(SHORTCUT_SCOPES)) {
      const v = c[key];
      if (typeof v === 'string') out.push({ scope, settings: { foreground: v } });
      else if (v && typeof v === 'object') out.push({ scope, settings: v as TokenColorRule['settings'] });
    }
    if (Array.isArray(c.textMateRules)) out.push(...(c.textMateRules as TokenColorRule[]).filter((r) => r && typeof r === 'object' && r.settings));
    return out;
  };
  const scoped = all[`[${themeName}]`];
  return [...rules(all), ...(scoped && typeof scoped === 'object' ? rules(scoped as Record<string, unknown>) : [])];
}
