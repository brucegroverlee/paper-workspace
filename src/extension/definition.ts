import * as vscode from 'vscode';
import type { LineRange } from '../shared/workspace';
import { candidatePaths, moduleSpecifierAt } from '../shared/imports';
import { rangeFromSelection } from './takeover';

/** Declarations longer than this get a window at their start instead of a target covering all of them. */
const MAX_DECLARATION_TARGET = 80;

export interface Definition {
  uri: vscode.Uri;
  /** undefined = the whole file (e.g. clicking a module path). */
  target: LineRange | undefined;
}

/**
 * Where Ctrl/Cmd+click at a position should go, like VS Code's "Go to Definition": ask the language service first
 * (handles path aliases, re-exports, JSX components), then fall back to resolving a relative import path ourselves.
 */
export async function findDefinition(doc: vscode.TextDocument, pos: vscode.Position): Promise<Definition | undefined> {
  const fromProvider = await definitionFromProvider(doc, pos);
  if (fromProvider) return fromProvider;
  const uri = await resolveImportAt(doc, pos);
  return uri && { uri, target: undefined };
}

async function definitionFromProvider(doc: vscode.TextDocument, pos: vscode.Position): Promise<Definition | undefined> {
  let results: (vscode.Location | vscode.LocationLink)[] | undefined;
  try {
    results = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', doc.uri, pos);
  } catch {
    return undefined;
  }
  for (const r of results ?? []) {
    const uri = 'targetUri' in r ? r.targetUri : r.uri;
    const at = 'targetUri' in r ? (r.targetSelectionRange ?? r.targetRange) : r.range;
    // Clicking a declaration itself returns that declaration; VS Code would show references, we do nothing.
    if (uri.toString() === doc.uri.toString() && at.contains(pos)) continue;
    const full = 'targetUri' in r ? r.targetRange : r.range;
    return { uri, target: targetFor(at, full) };
  }
  return undefined;
}

/** The declaration's lines when it is short, otherwise a window starting just above it; whole file at 0:0. */
export function targetFor(at: vscode.Range, full: vscode.Range): LineRange | undefined {
  if (at.start.line === 0 && at.start.character === 0 && full.isEmpty) return undefined;
  const lines = full.end.line - full.start.line + 1;
  if (full.contains(at) && lines > 1 && lines <= MAX_DECLARATION_TARGET) {
    return { start: full.start.line + 1, end: full.end.line + 1 };
  }
  const start = new vscode.Position(Math.max(at.start.line, 1), 0);
  return rangeFromSelection(new vscode.Selection(start, start));
}

async function resolveImportAt(doc: vscode.TextDocument, pos: vscode.Position): Promise<vscode.Uri | undefined> {
  const spec = moduleSpecifierAt(doc.lineAt(pos.line).text, pos.character + 1);
  if (!spec) return undefined;
  const dir = vscode.Uri.joinPath(doc.uri, '..');
  for (const rel of candidatePaths(spec.text)) {
    const uri = vscode.Uri.joinPath(dir, ...rel.split('/'));
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.File) return uri;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}
