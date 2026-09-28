import * as monaco from './monacoCore';
import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices.js';
import { IStandaloneThemeService } from 'monaco-editor/editor/standalone/common/standaloneTheme.js';

export { monaco };

// The `.codicon-*` glyph rules live in the theme service's stylesheet, which Monaco only attaches to the
// page when the first editor registers its container. Attach it now so the toolbar and other UI codicons
// render on a canvas that has no editors yet.
StandaloneServices.initialize({});
StandaloneServices.get(IStandaloneThemeService).registerEditorContainer(document.body);

// Monaco's editor worker (links, word completions, diffing). Webviews can't construct a Worker from a
// vscode-webview:// URL directly, so fetch the script and start it from a blob: URL instead.
const workerUrl = document.querySelector<HTMLMetaElement>('meta[name="pw-worker"]')?.content;
let workerSource: Promise<string> | undefined;
(self as any).MonacoEnvironment = {
  async getWorker() {
    if (!workerUrl) throw new Error('No worker URL');
    workerSource ??= fetch(workerUrl).then((r) => r.text());
    const blob = new Blob([await workerSource], { type: 'text/javascript' });
    return new Worker(URL.createObjectURL(blob));
  },
};

/** Map VS Code language ids to the Monarch grammar ids Monaco ships. */
const LANGUAGE_ALIASES: Record<string, string> = {
  typescriptreact: 'typescript',
  javascriptreact: 'javascript',
  jsonc: 'json',
  json5: 'json',
  shellscript: 'shell',
  dockercompose: 'yaml',
  'github-actions-workflow': 'yaml',
  vue: 'html',
  svelte: 'html',
  razor: 'razor',
  plaintext: 'plaintext',
};

export function monacoLanguage(vscodeLanguageId: string | undefined): string {
  if (!vscodeLanguageId) return 'plaintext';
  const id = LANGUAGE_ALIASES[vscodeLanguageId] ?? vscodeLanguageId;
  return monaco.languages.getLanguages().some((l) => l.id === id) ? id : 'plaintext';
}

/** Short badge shown in node headers ("TS", "PY", ...). */
export function languageBadge(vscodeLanguageId: string | undefined, file: string): string {
  const byId: Record<string, string> = {
    typescript: 'TS',
    typescriptreact: 'TSX',
    javascript: 'JS',
    javascriptreact: 'JSX',
    python: 'PY',
    csharp: 'C#',
    cpp: 'C++',
    markdown: 'MD',
    shellscript: 'SH',
  };
  if (vscodeLanguageId && byId[vscodeLanguageId]) return byId[vscodeLanguageId];
  const ext = file.split('.').pop() ?? '';
  return ext.slice(0, 4).toUpperCase() || 'TXT';
}

// ---- theme --------------------------------------------------------------------------------------

const THEME = 'paper-workspace';

function cssVar(name: string, fallback: string) {
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v || fallback;
}

function toHex(color: string, fallback: string): string {
  // Monaco only accepts #rrggbb[aa]; VS Code variables are usually hex already.
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color.length === 4 ? '#' + [...color.slice(1)].map((c) => c + c).join('') : color;
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return fallback;
  const [r, g, b, a] = m[1].split(',').map((s) => parseFloat(s));
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a !== undefined && a < 1 ? hex(a * 255) : ''}`;
}

/** Build a Monaco theme from the host's CSS variables so papers match the user's editor colors. */
export function applyHostTheme() {
  const cls = document.body.classList;
  const base: monaco.editor.BuiltinTheme = cls.contains('vscode-high-contrast')
    ? 'hc-black'
    : cls.contains('vscode-high-contrast-light')
      ? 'hc-light'
      : cls.contains('vscode-light')
        ? 'vs'
        : 'vs-dark';
  const dark = base === 'vs-dark' || base === 'hc-black';
  const c = (name: string, fallback: string) => toHex(cssVar(name, fallback), fallback);
  monaco.editor.defineTheme(THEME, {
    base,
    inherit: true,
    rules: [],
    colors: {
      'editor.background': c('--vscode-editor-background', dark ? '#1e1e1e' : '#ffffff'),
      'editor.foreground': c('--vscode-editor-foreground', dark ? '#d4d4d4' : '#000000'),
      'editorLineNumber.foreground': c('--vscode-editorLineNumber-foreground', dark ? '#858585' : '#237893'),
      'editorLineNumber.activeForeground': c('--vscode-editorLineNumber-activeForeground', dark ? '#c6c6c6' : '#0b216f'),
      'editor.selectionBackground': c('--vscode-editor-selectionBackground', dark ? '#264f78' : '#add6ff'),
      'editor.lineHighlightBackground': c('--vscode-editor-lineHighlightBackground', dark ? '#ffffff0a' : '#0000000a'),
      'editorCursor.foreground': c('--vscode-editorCursor-foreground', dark ? '#aeafad' : '#000000'),
      'editorWidget.background': c('--vscode-editorWidget-background', dark ? '#252526' : '#f3f3f3'),
    },
  });
  monaco.editor.setTheme(THEME);
}

export function watchHostTheme(onChange: () => void) {
  applyHostTheme();
  const obs = new MutationObserver(() => {
    applyHostTheme();
    onChange();
  });
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => obs.disconnect();
}
