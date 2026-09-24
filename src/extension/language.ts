import * as vscode from 'vscode';
import {
  COMPLETION_KINDS,
  PASSTHROUGH_COMMANDS,
  type CompletionItemJson,
  type CompletionResult,
  type DiagnosticJson,
  type DiagnosticSeverityName,
  type Documentation,
  type HoverResult,
  type LanguageRequest,
  type LanguageResult,
  type Markdown,
  type ResolvedCompletion,
  type SignatureHelpResult,
  type Span,
  type TextEditJson,
} from '../shared/language';

/** Items past this index are never resolved (the user would have to scroll far down the list). */
const MAX_RESOLVE_INDEX = 200;
/** Resolving re-runs the providers, so items are resolved in batches rather than one call per item. */
const RESOLVE_BATCH = 25;

interface CompletionSession {
  id: number;
  uri: vscode.Uri;
  position: vscode.Position;
  triggerCharacter?: string;
  items: vscode.CompletionItem[];
  resolved: vscode.CompletionItem[];
}

/**
 * Runs VS Code's language providers (the same ones the native editor uses: TS server, Pylance, rust-analyzer...)
 * for a paper and converts the answers to JSON for Monaco.
 */
export class LanguageBridge {
  private nextSession = 1;
  /** Only the latest completion list can be resolved; Monaco discards older ones anyway. */
  private session: CompletionSession | undefined;

  async handle(doc: vscode.TextDocument, request: LanguageRequest): Promise<LanguageResult> {
    try {
      switch (request.kind) {
        case 'completion':
          return await this.completion(doc, position(doc, request.line, request.column), request.triggerCharacter);
        case 'resolveCompletion':
          return await this.resolve(request.session, request.index);
        case 'hover':
          return await hover(doc, position(doc, request.line, request.column));
        case 'signatureHelp':
          return await signatureHelp(doc, position(doc, request.line, request.column), request.triggerCharacter);
      }
    } catch (e) {
      console.warn(`[paper-workspace] ${request.kind} failed`, e);
      return null;
    }
  }

  private async completion(doc: vscode.TextDocument, pos: vscode.Position, triggerCharacter: string | undefined): Promise<CompletionResult | null> {
    const list = await vscode.commands.executeCommand<vscode.CompletionList | undefined>(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      pos,
      triggerCharacter,
    );
    if (!list?.items.length) return null;
    const id = this.nextSession++;
    this.session = { id, uri: doc.uri, position: pos, triggerCharacter, items: list.items, resolved: [] };
    return { session: id, incomplete: !!list.isIncomplete, items: list.items.map(completionItem) };
  }

  /**
   * The command API cannot resolve a single item, only "the first N" of a fresh request. So re-run the request at
   * the original position asking for a batch of resolved items, and match the item back by index and label.
   */
  private async resolve(sessionId: number, index: number): Promise<ResolvedCompletion | null> {
    const s = this.session;
    if (!s || s.id !== sessionId || index >= MAX_RESOLVE_INDEX) return null;
    const original = s.items[index];
    if (!original) return null;
    if (index >= s.resolved.length) {
      const count = Math.min(MAX_RESOLVE_INDEX, Math.ceil((index + 1) / RESOLVE_BATCH) * RESOLVE_BATCH);
      const list = await vscode.commands.executeCommand<vscode.CompletionList | undefined>(
        'vscode.executeCompletionItemProvider',
        s.uri,
        s.position,
        s.triggerCharacter,
        count,
      );
      if (this.session !== s) return null;
      s.resolved = list?.items.slice(0, count) ?? [];
    }
    const label = labelText(original.label);
    const item = labelText(s.resolved[index]?.label ?? '') === label ? s.resolved[index] : s.resolved.find((i) => labelText(i.label) === label);
    if (!item) return null;
    return {
      detail: item.detail,
      documentation: documentation(item.documentation),
      additionalTextEdits: item.additionalTextEdits?.map(textEdit),
    };
  }
}

async function hover(doc: vscode.TextDocument, pos: vscode.Position): Promise<HoverResult | null> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[] | undefined>('vscode.executeHoverProvider', doc.uri, pos);
  const contents = (hovers ?? []).flatMap((h) => h.contents.map(markedString)).filter((m) => m.value.trim());
  if (!contents.length) return null;
  const range = hovers?.find((h) => h.range)?.range;
  return { contents, range: range && span(range) };
}

async function signatureHelp(doc: vscode.TextDocument, pos: vscode.Position, triggerCharacter: string | undefined): Promise<SignatureHelpResult | null> {
  const help = await vscode.commands.executeCommand<vscode.SignatureHelp | undefined>(
    'vscode.executeSignatureHelpProvider',
    doc.uri,
    pos,
    triggerCharacter,
  );
  if (!help?.signatures.length) return null;
  return {
    activeSignature: help.activeSignature,
    activeParameter: help.activeParameter,
    signatures: help.signatures.map((s) => ({
      label: s.label,
      documentation: documentation(s.documentation),
      activeParameter: s.activeParameter,
      parameters: s.parameters.map((p) => ({ label: p.label, documentation: documentation(p.documentation) })),
    })),
  };
}

// ---- diagnostics ----------------------------------------------------------------------------------

const SEVERITIES: DiagnosticSeverityName[] = ['error', 'warning', 'info', 'hint'];

export function diagnosticsFor(uri: vscode.Uri): DiagnosticJson[] {
  return vscode.languages.getDiagnostics(uri).map((d) => ({
    range: span(d.range),
    message: d.message,
    severity: SEVERITIES[d.severity] ?? 'error',
    source: d.source,
    code: d.code === undefined ? undefined : typeof d.code === 'object' ? String(d.code.value) : String(d.code),
    unnecessary: d.tags?.includes(vscode.DiagnosticTag.Unnecessary),
    deprecated: d.tags?.includes(vscode.DiagnosticTag.Deprecated),
  }));
}

// ---- conversions ----------------------------------------------------------------------------------

function position(doc: vscode.TextDocument, line: number, column: number) {
  return doc.validatePosition(new vscode.Position(line - 1, column - 1));
}

function span(r: vscode.Range): Span {
  return { startLine: r.start.line + 1, startColumn: r.start.character + 1, endLine: r.end.line + 1, endColumn: r.end.character + 1 };
}

function textEdit(e: vscode.TextEdit): TextEditJson {
  return { range: span(e.range), text: e.newText };
}

function labelText(label: string | vscode.CompletionItemLabel) {
  return typeof label === 'string' ? label : label.label;
}

function markdown(m: vscode.MarkdownString): Markdown {
  // Not trusted: `command:` links cannot run from the webview anyway.
  return { value: m.value, supportThemeIcons: m.supportThemeIcons, supportHtml: m.supportHtml };
}

function documentation(d: string | vscode.MarkdownString | undefined): Documentation | undefined {
  if (d === undefined) return undefined;
  return typeof d === 'string' ? d : markdown(d);
}

function markedString(m: vscode.MarkdownString | vscode.MarkedString): Markdown {
  if (typeof m === 'string') return { value: m };
  if (m instanceof vscode.MarkdownString) return markdown(m);
  if ('language' in m) return { value: '```' + m.language + '\n' + m.value + '\n```' };
  return markdown(m as vscode.MarkdownString);
}

function completionItem(item: vscode.CompletionItem): CompletionItemJson {
  const label = typeof item.label === 'string' ? item.label : { label: item.label.label, detail: item.label.detail, description: item.label.description };
  const insert = item.insertText ?? labelText(item.label);
  const range = item.range
    ? item.range instanceof vscode.Range
      ? span(item.range)
      : { insert: span(item.range.inserting), replace: span(item.range.replacing) }
    : undefined;
  return {
    label,
    kind: COMPLETION_KINDS[item.kind ?? vscode.CompletionItemKind.Property] ?? 'Property',
    detail: item.detail,
    documentation: documentation(item.documentation),
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    insertText: typeof insert === 'string' ? insert : insert.value,
    snippet: typeof insert !== 'string',
    range,
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map(textEdit),
    deprecated: item.tags?.includes(vscode.CompletionItemTag.Deprecated),
    command: item.command && PASSTHROUGH_COMMANDS.has(item.command.command) ? item.command.command : undefined,
  };
}
