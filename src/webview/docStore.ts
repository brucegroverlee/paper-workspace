import { LineRange, clampRange, relocateRange } from '../shared/workspace';
import type { HostToWebview, TextChange } from '../shared/protocol';
import { monaco, monacoLanguage } from './monaco';
import { textmateLanguage } from './textmate';
import { host } from './vscodeApi';

export interface DocEntry {
  file: string;
  model?: monaco.editor.ITextModel;
  languageId?: string;
  error?: string;
  /** The file was deleted or moved away; the last known text stays in `model` until it comes back. */
  missing?: boolean;
  dirty: boolean;
  /** Bumped on every content/state change so React can subscribe cheaply. */
  version: number;
}

interface Tracker {
  file: string;
  range: LineRange;
  anchor?: string;
  decorationId?: string;
}

export interface RangeUpdate {
  id: string;
  range: LineRange;
  anchor: string;
}

/**
 * One Monaco model per source file, shared by every node that shows part of it.
 * Node ranges are tracked with sticky decorations, so they follow edits made anywhere
 * (in a node, in the native editor, by git...) and grow when typing at their edges.
 */
export class DocStore {
  private readonly docs = new Map<string, DocEntry & { pendingLocal: number; applyingRemote: boolean }>();
  private readonly trackers = new Map<string, Tracker>();
  private readonly listeners = new Set<() => void>();
  onRangesChanged: (updates: RangeUpdate[]) => void = () => {};

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(file: string): DocEntry | undefined {
    return this.docs.get(file);
  }

  private notify(entry: { version: number }) {
    entry.version++;
    this.listeners.forEach((l) => l());
  }

  /** Request a file from the host the first time a node references it. */
  ensure(file: string) {
    if (this.docs.has(file)) return;
    this.docs.set(file, { file, dirty: false, version: 0, pendingLocal: 0, applyingRemote: false });
    host.postMessage({ type: 'openDoc', file });
  }

  track(id: string, file: string, range: LineRange, anchor?: string) {
    const existing = this.trackers.get(id);
    if (existing && existing.file === file && sameRange(existing.range, range)) return;
    if (existing && existing.file !== file) this.untrack(id);
    const t: Tracker = this.trackers.get(id) ?? { file, range, anchor };
    t.range = range;
    t.anchor = anchor ?? t.anchor;
    this.trackers.set(id, t);
    this.ensure(file);
    const model = this.docs.get(file)?.model;
    if (model) this.decorate(model, t);
  }

  untrack(id: string) {
    const t = this.trackers.get(id);
    if (!t) return;
    const model = this.docs.get(t.file)?.model;
    if (model && t.decorationId) model.deltaDecorations([t.decorationId], []);
    this.trackers.delete(id);
  }

  lineCount(file: string) {
    return this.docs.get(file)?.model?.getLineCount() ?? 1;
  }

  private decorate(model: monaco.editor.ITextModel, t: Tracker) {
    const r = clampRange(t.range, model.getLineCount());
    t.range = r;
    const [id] = model.deltaDecorations(t.decorationId ? [t.decorationId] : [], [
      {
        range: new monaco.Range(r.start, 1, r.end, model.getLineMaxColumn(r.end)),
        options: { stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges },
      },
    ]);
    t.decorationId = id;
  }

  handleHost(m: HostToWebview) {
    switch (m.type) {
      case 'doc':
        return this.onDoc(m);
      case 'docChanged':
        return this.onRemoteChange(m.file, m.changes, m.length, m.dirty);
      case 'docState': {
        const entry = this.docs.get(m.file);
        if (!entry) return;
        entry.dirty = m.dirty;
        if (m.ack) {
          entry.pendingLocal = Math.max(0, entry.pendingLocal - 1);
          if (entry.pendingLocal === 0 && m.length !== undefined && entry.model && entry.model.getValueLength() !== m.length) {
            this.resync(m.file);
          }
        }
        this.notify(entry);
        return;
      }
    }
  }

  private resync(file: string) {
    console.warn(`[paper-workspace] ${file} drifted from the host document; reloading it`);
    host.postMessage({ type: 'openDoc', file });
  }

  private onDoc(m: Extract<HostToWebview, { type: 'doc' }>) {
    const entry = this.docs.get(m.file) ?? { file: m.file, dirty: false, version: 0, pendingLocal: 0, applyingRemote: false };
    this.docs.set(m.file, entry);
    entry.error = m.error;
    entry.missing = !!m.missing;
    if (m.missing) return this.notify(entry); // keep the language badge and last text
    entry.dirty = !!m.dirty;
    entry.languageId = m.languageId;
    if (m.text !== undefined) {
      if (entry.model) {
        // Full resync: replace the text, then restore ranges from their last known values.
        entry.applyingRemote = true;
        entry.model.setValue(m.text);
        entry.applyingRemote = false;
        entry.pendingLocal = 0;
      } else {
        entry.model = monaco.editor.createModel(m.text, textmateLanguage(m.languageId) ?? monacoLanguage(m.languageId), monaco.Uri.parse(`paper:/${m.file}`));
        entry.model.setEOL(m.eol === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
        entry.model.onDidChangeContent((e) => this.onModelChanged(entry, e));
      }
      const lines = entry.model.getLinesContent();
      const updates: RangeUpdate[] = [];
      for (const [id, t] of this.trackers) {
        if (t.file !== m.file) continue;
        const next = relocateRange(lines, t.range, t.anchor);
        const moved = !sameRange(next, t.range);
        t.range = next;
        t.decorationId = undefined; // setValue dropped old decorations
        this.decorate(entry.model, t);
        const anchor = lines[next.start - 1]?.trim() ?? '';
        if (moved || anchor !== t.anchor) {
          t.anchor = anchor;
          updates.push({ id, range: next, anchor });
        }
      }
      if (updates.length) this.onRangesChanged(updates);
    }
    this.notify(entry);
  }

  private onRemoteChange(file: string, changes: TextChange[], length: number, dirty: boolean) {
    const entry = this.docs.get(file);
    if (!entry?.model) return;
    entry.applyingRemote = true;
    try {
      entry.model.pushEditOperations(
        [],
        changes.map((c) => ({
          range: new monaco.Range(c.startLine, c.startColumn, c.endLine, c.endColumn),
          text: c.text,
        })),
        () => null,
      );
    } finally {
      entry.applyingRemote = false;
    }
    entry.dirty = dirty;
    if (entry.pendingLocal === 0 && entry.model.getValueLength() !== length) this.resync(file);
  }

  private onModelChanged(entry: DocEntry & { pendingLocal: number; applyingRemote: boolean }, e: monaco.editor.IModelContentChangedEvent) {
    if (!entry.applyingRemote) {
      entry.pendingLocal++;
      host.postMessage({
        type: 'edit',
        file: entry.file,
        changes: e.changes.map((c) => ({
          startLine: c.range.startLineNumber,
          startColumn: c.range.startColumn,
          endLine: c.range.endLineNumber,
          endColumn: c.range.endColumn,
          text: c.text,
        })),
      });
    }
    this.refreshRanges(entry);
    this.notify(entry);
  }

  /** Read back decoration ranges after an edit and report the ones that moved or grew. */
  private refreshRanges(entry: DocEntry) {
    const model = entry.model;
    if (!model) return;
    const updates: RangeUpdate[] = [];
    for (const [id, t] of this.trackers) {
      if (t.file !== entry.file || !t.decorationId) continue;
      const r = model.getDecorationRange(t.decorationId);
      if (!r) continue;
      const next = { start: r.startLineNumber, end: Math.max(r.startLineNumber, r.endLineNumber) };
      const anchor = model.getLineContent(next.start).trim();
      const changed = !sameRange(next, t.range);
      if (changed) {
        t.range = next;
        this.decorate(model, t); // normalize to whole lines
      }
      if (changed || anchor !== t.anchor) {
        t.anchor = anchor;
        updates.push({ id, range: next, anchor });
      }
    }
    if (updates.length) this.onRangesChanged(updates);
  }
}

function sameRange(a: LineRange, b: LineRange) {
  return a.start === b.start && a.end === b.end;
}

export const docStore = new DocStore();
