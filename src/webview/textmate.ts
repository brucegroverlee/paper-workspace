// VS Code-identical syntax highlighting: the extensions' TextMate grammars, tokenized by vscode-textmate (the same
// engine VS Code uses) and colored with the active theme's token colors. Replaces Monaco's Monarch tokenizers when
// the host sends grammars (`init.textmate`); without them, or if the regex engine fails to load, Monarch stays.
import { INITIAL, Registry, parseRawGrammar, type IGrammar, type IGrammarConfiguration, type IRawTheme, type StateStack } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices.js';
import { ILanguageService } from 'monaco-editor/editor/common/languages/language.js';
import type { HostToWebview } from '../shared/protocol';
import type { GrammarInfo, TextmateInit, TextmateRequest, TextmateResult, TextmateTheme } from '../shared/textmate';
import { monaco, toHex } from './monaco';
import { host } from './vscodeApi';

/** Like VS Code's `editor.maxTokenizationLineLength`: longer lines are left uncolored. */
const MAX_LINE_LENGTH = 20_000;
/** Per-line budget; a line that takes longer is finished uncolored and the next one continues from its state. */
const LINE_TIME_LIMIT_MS = 500;
const REQUEST_TIMEOUT_MS = 10_000;

/** VS Code language id -> its main grammar. */
const byLanguage = new Map<string, GrammarInfo>();
const byScope = new Map<string, GrammarInfo>();
let theme: TextmateTheme | undefined;
let registry: Promise<Registry | null> | undefined;
/** Languages whose tokenizer was replaced (or is being replaced). */
const installed = new Set<string>();

// ---- host requests --------------------------------------------------------------------------------

let nextId = 1;
const pending = new Map<number, (result: TextmateResult) => void>();

function request(req: TextmateRequest): Promise<TextmateResult> {
  return new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => done(null), REQUEST_TIMEOUT_MS);
    const done = (result: TextmateResult) => {
      pending.delete(id);
      clearTimeout(timer);
      resolve(result);
    };
    pending.set(id, done);
    host.postMessage({ type: 'textmate', id, request: req });
  });
}

/** Host answers and theme changes; returns false for messages that are not ours. */
export function handleTextmateMessage(m: HostToWebview): boolean {
  if (m.type === 'textmateResult') {
    pending.get(m.id)?.(m.result);
    return true;
  }
  if (m.type === 'textmateTheme') {
    theme = m.theme;
    void registry?.then((r) => r && applyTheme(r));
    return true;
  }
  return false;
}

// ---- setup ----------------------------------------------------------------------------------------

/** Called with `init.textmate`, before any model is created. */
export function initTextmate(init: TextmateInit | undefined) {
  if (!init || registry) return;
  theme = init.theme;
  for (const g of init.grammars) {
    byScope.set(g.scopeName, g);
    if (g.language && !byLanguage.has(g.language)) byLanguage.set(g.language, g);
  }
  registry = createRegistry().catch((e) => {
    console.warn('[paper-workspace] TextMate highlighting unavailable; using Monaco tokenizers', e);
    return null;
  });
  void registry.then((r) => {
    if (!r) return;
    applyTheme(r);
    // Every language Monaco knows gets VS Code's grammar (or no colors, like VS Code without a grammar):
    // Monarch tokens would be meaningless with the theme's color map. Covers code blocks in hovers too.
    for (const { id } of monaco.languages.getLanguages()) install(id);
  });
}

async function createRegistry() {
  const url = document.querySelector<HTMLMetaElement>('meta[name="pw-onig"]')?.content;
  if (!url) throw new Error('no onig.wasm URL');
  await loadWASM(await (await fetch(url)).arrayBuffer());
  return new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    async loadGrammar(scopeName) {
      const r = await request({ kind: 'grammar', scopeName });
      return r && typeof r.content === 'string' && typeof r.path === 'string' ? parseRawGrammar(r.content, r.path) : null;
    },
    getInjections: (scopeName) => [...byScope.values()].filter((g) => g.injectTo?.includes(scopeName)).map((g) => g.scopeName),
  });
}

/** Load the theme into the registry and hand its color map to Monaco (it replaces the Monarch theme's token colors). */
function applyTheme(r: Registry) {
  if (!theme) return;
  const css = getComputedStyle(document.body);
  const raw: IRawTheme = {
    name: theme.name,
    settings: [
      // Defaults for text no rule matches, as VS Code does: the editor's own colors.
      { settings: { foreground: toHex(css.getPropertyValue('--vscode-editor-foreground').trim(), '#d4d4d4'), background: toHex(css.getPropertyValue('--vscode-editor-background').trim(), '#1e1e1e') } },
      ...(theme.rules as IRawTheme['settings']),
    ],
  };
  r.setTheme(raw);
  monaco.languages.setColorMap(r.getColorMap());
}

// ---- languages --------------------------------------------------------------------------------------

/**
 * The Monaco language id a model of VS Code language `languageId` should use, when TextMate highlighting is on:
 * the VS Code id itself (registered in Monaco if needed, with the language's own configuration). Undefined
 * otherwise, so callers fall back to Monaco's own languages.
 */
export function textmateLanguage(languageId: string | undefined): string | undefined {
  if (!registry || !languageId) return undefined;
  if (!monaco.languages.getLanguages().some((l) => l.id === languageId)) {
    monaco.languages.register({ id: languageId });
    // Brackets, comments, auto-closing, indentation... from the extension that defines the language.
    void request({ kind: 'languageConfiguration', languageId }).then((c) => {
      if (c && !('content' in c)) monaco.languages.setLanguageConfiguration(languageId, languageConfiguration(c));
    });
  }
  install(languageId);
  return languageId;
}

function install(languageId: string) {
  if (installed.has(languageId) || !registry) return;
  installed.add(languageId);
  const provider = registry.then((r) => (r ? tokensProvider(r, languageId) : null));
  // The factory supersedes a Monarch factory that hasn't run yet; setTokensProvider replaces one that already
  // did (models then re-tokenize).
  monaco.languages.registerTokensProviderFactory(languageId, { create: () => provider });
  void provider.then((p) => p && monaco.languages.setTokensProvider(languageId, p));
}

async function tokensProvider(r: Registry, languageId: string): Promise<monaco.languages.EncodedTokensProvider> {
  const codec = StandaloneServices.get(ILanguageService).languageIdCodec;
  const info = byLanguage.get(languageId);
  let grammar: IGrammar | null = null;
  if (info) {
    try {
      grammar = await r.loadGrammarWithConfiguration(info.scopeName, codec.encodeLanguageId(languageId), grammarConfiguration(info, codec));
    } catch (e) {
      console.warn(`[paper-workspace] could not load the ${info.scopeName} grammar`, e);
    }
  }
  const plain = new Uint32Array([0, codec.encodeLanguageId(languageId) | (1 << 15) | (2 << 24)]); // default fg/bg
  return {
    getInitialState: () => new TmState(INITIAL),
    tokenizeEncoded(line, state) {
      const s = state as TmState;
      if (!grammar || line.length > MAX_LINE_LENGTH) return { tokens: plain, endState: s };
      const result = grammar.tokenizeLine2(line, s.stack, LINE_TIME_LIMIT_MS);
      return { tokens: result.tokens, endState: new TmState(result.ruleStack) };
    },
  };
}

class TmState implements monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return this; // StateStack is immutable
  }
  equals(other: monaco.languages.IState) {
    return other instanceof TmState && other.stack.equals(this.stack);
  }
}

const TOKEN_TYPES: Record<string, number> = { other: 0, comment: 1, string: 2, regex: 3 };

function grammarConfiguration(info: GrammarInfo, codec: { encodeLanguageId(id: string): number }): IGrammarConfiguration {
  const known = new Set(monaco.languages.getLanguages().map((l) => l.id));
  const embeddedLanguages: Record<string, number> = {};
  for (const [scope, language] of Object.entries(info.embeddedLanguages ?? {})) {
    if (known.has(language)) embeddedLanguages[scope] = codec.encodeLanguageId(language);
  }
  const tokenTypes: Record<string, number> = {};
  for (const [scope, type] of Object.entries(info.tokenTypes ?? {})) if (type in TOKEN_TYPES) tokenTypes[scope] = TOKEN_TYPES[type];
  return {
    embeddedLanguages,
    tokenTypes: tokenTypes as IGrammarConfiguration['tokenTypes'],
    // As VS Code: brackets count for bracket-pair colorization everywhere except where the grammar says not.
    balancedBracketSelectors: info.balancedBracketScopes ?? ['*'],
    unbalancedBracketSelectors: info.unbalancedBracketScopes ?? [],
  };
}

// ---- language-configuration.json -> Monaco -----------------------------------------------------------

type RegexLike = string | { pattern: string; flags?: string } | undefined;

function regex(v: RegexLike): RegExp | undefined {
  try {
    if (typeof v === 'string') return new RegExp(v);
    if (v && typeof v.pattern === 'string') return new RegExp(v.pattern, v.flags);
  } catch {
    /* a pattern JavaScript can't compile; skip it */
  }
  return undefined;
}

const INDENT_ACTIONS: Record<string, monaco.languages.IndentAction> = {
  none: monaco.languages.IndentAction.None,
  indent: monaco.languages.IndentAction.Indent,
  indentOutdent: monaco.languages.IndentAction.IndentOutdent,
  outdent: monaco.languages.IndentAction.Outdent,
};

/** VS Code's language configuration format (strings for regexes, pairs as arrays) in Monaco's shape. */
export function languageConfiguration(c: Record<string, any>): monaco.languages.LanguageConfiguration {
  const pair = (p: any) => (Array.isArray(p) ? { open: p[0], close: p[1] } : p);
  const lineComment = typeof c.comments?.lineComment === 'object' ? c.comments.lineComment?.comment : c.comments?.lineComment;
  const conf: monaco.languages.LanguageConfiguration = {
    comments: c.comments ? { lineComment, blockComment: c.comments.blockComment } : undefined,
    brackets: c.brackets,
    colorizedBracketPairs: c.colorizedBracketPairs,
    autoClosingPairs: Array.isArray(c.autoClosingPairs) ? c.autoClosingPairs.map(pair) : undefined,
    surroundingPairs: Array.isArray(c.surroundingPairs) ? c.surroundingPairs.map(pair) : undefined,
    autoCloseBefore: c.autoCloseBefore,
    wordPattern: regex(c.wordPattern),
  };
  const ir = c.indentationRules;
  const increase = regex(ir?.increaseIndentPattern);
  const decrease = regex(ir?.decreaseIndentPattern);
  if (increase && decrease) {
    conf.indentationRules = {
      increaseIndentPattern: increase,
      decreaseIndentPattern: decrease,
      indentNextLinePattern: regex(ir.indentNextLinePattern),
      unIndentedLinePattern: regex(ir.unIndentedLinePattern),
    };
  }
  const start = regex(c.folding?.markers?.start);
  const end = regex(c.folding?.markers?.end);
  if (c.folding) conf.folding = { offSide: c.folding.offSide, markers: start && end ? { start, end } : undefined };
  if (Array.isArray(c.onEnterRules)) {
    conf.onEnterRules = c.onEnterRules.flatMap((r: any) => {
      const beforeText = regex(r.beforeText);
      const action = r.action && INDENT_ACTIONS[r.action.indent];
      if (!beforeText || action === undefined) return [];
      return [
        {
          beforeText,
          afterText: regex(r.afterText),
          previousLineText: regex(r.previousLineText),
          action: { indentAction: action, appendText: r.action.appendText, removeText: r.action.removeText },
        },
      ];
    });
  }
  return conf;
}
