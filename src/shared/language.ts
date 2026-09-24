// IntelliSense bridge: papers ask the host to run VS Code's language providers on the real file.
// Everything here is plain JSON; positions are 1-based (Monaco), converted on the host.

export interface Span {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Markdown {
  value: string;
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;
}

export type Documentation = string | Markdown;

export type LanguageRequest =
  | { kind: 'completion'; line: number; column: number; triggerCharacter?: string }
  /** Details (docs, auto-import edits) of an item from an earlier completion result. */
  | { kind: 'resolveCompletion'; session: number; index: number }
  | { kind: 'hover'; line: number; column: number }
  | { kind: 'signatureHelp'; line: number; column: number; triggerCharacter?: string; isRetrigger: boolean };

/** VS Code's `CompletionItemKind` names in enum order (index = the VS Code value). */
export const COMPLETION_KINDS = [
  'Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface', 'Module', 'Property',
  'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference', 'Folder', 'EnumMember',
  'Constant', 'Struct', 'Event', 'Operator', 'TypeParameter', 'User', 'Issue',
] as const;

export type CompletionKindName = (typeof COMPLETION_KINDS)[number];

export interface TextEditJson {
  range: Span;
  text: string;
}

export interface CompletionItemJson {
  label: string | { label: string; detail?: string; description?: string };
  kind: CompletionKindName;
  detail?: string;
  documentation?: Documentation;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
  insertText: string;
  /** `insertText` is a snippet (`$1`, `${2:name}`...). */
  snippet: boolean;
  range?: Span | { insert: Span; replace: Span };
  commitCharacters?: string[];
  additionalTextEdits?: TextEditJson[];
  deprecated?: boolean;
  /** Only editor commands Monaco also has (e.g. re-open suggestions or parameter hints) are passed through. */
  command?: string;
}

export interface CompletionResult {
  /** Identifies this result for `resolveCompletion`. */
  session: number;
  incomplete: boolean;
  items: CompletionItemJson[];
}

export interface ResolvedCompletion {
  detail?: string;
  documentation?: Documentation;
  additionalTextEdits?: TextEditJson[];
}

export interface HoverResult {
  contents: Markdown[];
  range?: Span;
}

export interface SignatureHelpResult {
  signatures: {
    label: string;
    documentation?: Documentation;
    parameters: { label: string | [number, number]; documentation?: Documentation }[];
    activeParameter?: number;
  }[];
  activeSignature: number;
  activeParameter: number;
}

export type LanguageResult = CompletionResult | ResolvedCompletion | HoverResult | SignatureHelpResult | null;

export type DiagnosticSeverityName = 'error' | 'warning' | 'info' | 'hint';

export interface DiagnosticJson {
  range: Span;
  message: string;
  severity: DiagnosticSeverityName;
  source?: string;
  code?: string;
  unnecessary?: boolean;
  deprecated?: boolean;
}

/** Editor commands a completion may run after it is accepted that exist in Monaco too. */
export const PASSTHROUGH_COMMANDS = new Set(['editor.action.triggerSuggest', 'editor.action.triggerParameterHints']);
