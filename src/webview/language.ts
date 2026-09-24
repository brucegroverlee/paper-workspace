// IntelliSense in papers: Monaco providers that forward to VS Code's language services on the host.
import type {
  CompletionItemJson,
  CompletionResult,
  DiagnosticJson,
  HoverResult,
  LanguageRequest,
  LanguageResult,
  ResolvedCompletion,
  SignatureHelpResult,
  Span,
  TextEditJson,
} from '../shared/language';
import type { HostToWebview } from '../shared/protocol';
import { monaco } from './monaco';
import { host } from './vscodeApi';

/** Language servers can be slow on first use (project loading); give up rather than leave a spinner forever. */
const REQUEST_TIMEOUT_MS = 10_000;

// We cannot ask the host which characters its providers trigger on, so use the union of the common ones.
// Providers that don't care return nothing, which is cheap.
const COMPLETION_TRIGGERS = ['.', ':', '<', '"', "'", '/', '@', '#', '$', '`', '>', '\\'];
const SIGNATURE_TRIGGERS = ['(', ','];
const SIGNATURE_RETRIGGERS = [')'];

let nextId = 1;
const pending = new Map<number, (result: LanguageResult) => void>();

/** Files are identified by their model URI (`paper:/<workspace path>`, see DocStore). */
function fileOf(model: monaco.editor.ITextModel): string | undefined {
  return model.uri.scheme === 'paper' ? model.uri.path.replace(/^\//, '') : undefined;
}

function request<T extends LanguageResult>(file: string, req: LanguageRequest, token: monaco.CancellationToken): Promise<T | null> {
  return new Promise((resolve) => {
    const id = nextId++;
    const done = (result: LanguageResult) => {
      pending.delete(id);
      clearTimeout(timer);
      sub.dispose();
      resolve(result as T | null);
    };
    const timer = setTimeout(() => done(null), REQUEST_TIMEOUT_MS);
    const sub = token.onCancellationRequested(() => done(null));
    pending.set(id, done);
    host.postMessage({ type: 'language', id, file, request: req });
  });
}

/** Host answers and pushed diagnostics; returns false for messages that are not ours. */
export function handleLanguageMessage(m: HostToWebview): boolean {
  if (m.type === 'languageResult') {
    pending.get(m.id)?.(m.result);
    return true;
  }
  if (m.type === 'diagnostics') {
    const model = monaco.editor.getModel(monaco.Uri.parse(`paper:/${m.file}`));
    if (model) monaco.editor.setModelMarkers(model, 'vscode', m.diagnostics.map(marker));
    else pendingDiagnostics.set(m.file, m.diagnostics);
    return true;
  }
  return false;
}

/** Diagnostics that arrived before their model was created. */
const pendingDiagnostics = new Map<string, DiagnosticJson[]>();

// ---- providers ------------------------------------------------------------------------------------

let registered = false;

export function registerLanguageBridge() {
  if (registered) return;
  registered = true;
  const selector: monaco.languages.LanguageSelector = { scheme: 'paper' } as monaco.languages.LanguageFilter;

  monaco.editor.onDidCreateModel((model) => {
    const file = fileOf(model);
    const diagnostics = file && pendingDiagnostics.get(file);
    if (!file || !diagnostics) return;
    pendingDiagnostics.delete(file);
    monaco.editor.setModelMarkers(model, 'vscode', diagnostics.map(marker));
  });

  // Completion lists are kept by session so `resolveCompletionItem` can find its item's index.
  const itemInfo = new WeakMap<monaco.languages.CompletionItem, { file: string; session: number; index: number }>();

  monaco.languages.registerCompletionItemProvider(selector, {
    triggerCharacters: COMPLETION_TRIGGERS,
    async provideCompletionItems(model, position, context, token) {
      const file = fileOf(model);
      if (!file) return null;
      const result = await request<CompletionResult>(
        file,
        { kind: 'completion', line: position.lineNumber, column: position.column, triggerCharacter: context.triggerCharacter },
        token,
      );
      if (!result || model.isDisposed()) return null;
      const word = model.getWordUntilPosition(position);
      const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column);
      const suggestions = result.items.map((item, index) => {
        const s = completionItem(item, fallback);
        itemInfo.set(s, { file, session: result.session, index });
        return s;
      });
      return { suggestions, incomplete: result.incomplete };
    },
    async resolveCompletionItem(item, token) {
      const info = itemInfo.get(item);
      if (!info) return item;
      const resolved = await request<ResolvedCompletion>(info.file, { kind: 'resolveCompletion', session: info.session, index: info.index }, token);
      if (!resolved) return item;
      if (resolved.detail !== undefined) item.detail = resolved.detail;
      if (resolved.documentation !== undefined) item.documentation = resolved.documentation;
      if (resolved.additionalTextEdits?.length) item.additionalTextEdits = resolved.additionalTextEdits.map(textEdit);
      return item;
    },
  });

  monaco.languages.registerHoverProvider(selector, {
    async provideHover(model, position, token) {
      const file = fileOf(model);
      if (!file) return null;
      const result = await request<HoverResult>(file, { kind: 'hover', line: position.lineNumber, column: position.column }, token);
      if (!result) return null;
      return { contents: result.contents, range: result.range && range(result.range) };
    },
  });

  monaco.languages.registerSignatureHelpProvider(selector, {
    signatureHelpTriggerCharacters: SIGNATURE_TRIGGERS,
    signatureHelpRetriggerCharacters: SIGNATURE_RETRIGGERS,
    async provideSignatureHelp(model, position, token, context) {
      const file = fileOf(model);
      if (!file) return null;
      const result = await request<SignatureHelpResult>(
        file,
        {
          kind: 'signatureHelp',
          line: position.lineNumber,
          column: position.column,
          triggerCharacter: context.triggerCharacter,
          isRetrigger: context.isRetrigger,
        },
        token,
      );
      if (!result) return null;
      return {
        value: {
          activeSignature: result.activeSignature,
          activeParameter: result.activeParameter,
          signatures: result.signatures.map((s) => ({
            label: s.label,
            documentation: s.documentation,
            activeParameter: s.activeParameter,
            parameters: s.parameters.map((p) => ({ label: p.label, documentation: p.documentation })),
          })),
        },
        dispose() {},
      };
    },
  });
}

// ---- conversions ----------------------------------------------------------------------------------

function range(s: Span) {
  return new monaco.Range(s.startLine, s.startColumn, s.endLine, s.endColumn);
}

function textEdit(e: TextEditJson): monaco.languages.TextEdit {
  return { range: range(e.range), text: e.text };
}

function completionItem(item: CompletionItemJson, fallback: monaco.IRange): monaco.languages.CompletionItem {
  const r = item.range;
  return {
    label: item.label,
    kind: monaco.languages.CompletionItemKind[item.kind] ?? monaco.languages.CompletionItemKind.Property,
    detail: item.detail,
    documentation: item.documentation,
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    insertText: item.insertText,
    insertTextRules: item.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range: !r ? fallback : 'insert' in r ? { insert: range(r.insert), replace: range(r.replace) } : range(r),
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map(textEdit),
    tags: item.deprecated ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
    command: item.command ? { id: item.command, title: '' } : undefined,
  };
}

const SEVERITY: Record<DiagnosticJson['severity'], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
  hint: monaco.MarkerSeverity.Hint,
};

function marker(d: DiagnosticJson): monaco.editor.IMarkerData {
  const tags: monaco.MarkerTag[] = [];
  if (d.unnecessary) tags.push(monaco.MarkerTag.Unnecessary);
  if (d.deprecated) tags.push(monaco.MarkerTag.Deprecated);
  return {
    startLineNumber: d.range.startLine,
    startColumn: d.range.startColumn,
    endLineNumber: d.range.endLine,
    endColumn: d.range.endColumn,
    message: d.message,
    severity: SEVERITY[d.severity],
    source: d.source,
    code: d.code,
    tags,
  };
}
