// Git gutter marks in papers: each model is diffed against the git versions the host sends, live as it is edited.
// Unstaged changes (against the index) are drawn in full color; staged ones (against `gitDiffBase`, HEAD by
// default, and not unstaged) are drawn faded, as Windsurf / VS Code do.
import { diffLines, gitMarks, splitLines, subtractMarks, type GitMark } from '../shared/lineDiff';
import type { HostToWebview } from '../shared/protocol';
import { monaco, toHex } from './monaco';
import { fileOf } from './language';

/** Edits come keystroke by keystroke; diff once typing pauses. */
const DIFF_DELAY_MS = 150;

/** workspace file -> lines of its git versions (null: nothing to compare with). */
const bases = new Map<string, { index: string[] | null; ref: string[] | null }>();

interface Watched {
  decorations: string[];
  timer?: ReturnType<typeof setTimeout>;
  sub: monaco.IDisposable;
}
const watched = new WeakMap<monaco.editor.ITextModel, Watched>();

/** Host messages about git; returns false for messages that are not ours. */
export function handleGitMessage(m: HostToWebview): boolean {
  if (m.type !== 'gitBase') return false;
  // '' is no lines at all (a new file), not one empty line that would match a blank line of the current text.
  const lines = (text: string | null) => (text === null ? null : text === '' ? [] : splitLines(text));
  bases.set(m.file, { index: lines(m.index), ref: lines(m.ref) });
  const model = monaco.editor.getModel(monaco.Uri.parse(`paper:/${m.file}`));
  if (model) watch(model);
  return true;
}

let registered = false;

/** Picks up models created after their base arrived. */
export function registerGitGutter() {
  if (registered) return;
  registered = true;
  monaco.editor.onDidCreateModel((model) => {
    const file = fileOf(model);
    if (file && bases.has(file)) watch(model);
  });
}

function watch(model: monaco.editor.ITextModel) {
  let w = watched.get(model);
  if (!w) {
    const state: Watched = {
      decorations: [],
      sub: model.onDidChangeContent(() => {
        clearTimeout(state.timer);
        state.timer = setTimeout(() => update(model, state), DIFF_DELAY_MS);
      }),
    };
    model.onWillDispose(() => {
      clearTimeout(state.timer);
      state.sub.dispose();
    });
    watched.set(model, (w = state));
  }
  clearTimeout(w.timer);
  update(model, w);
}

function update(model: monaco.editor.ITextModel, w: Watched) {
  if (model.isDisposed()) return;
  const base = bases.get(fileOf(model) ?? '');
  const lines = model.getLinesContent();
  const unstaged = base?.index ? gitMarks(diffLines(base.index, lines)) : [];
  const staged = base?.ref ? subtractMarks(gitMarks(diffLines(base.ref, lines)), unstaged) : [];
  // Model decorations (owner 0) show in every editor of the file, unlike each paper's own target highlight.
  w.decorations = model.deltaDecorations(w.decorations, [
    ...staged.map((m) => decoration(m, true)),
    ...unstaged.map((m) => decoration(m, false)),
  ]);
}

// Same theme colors as VS Code's own gutter, read once they are needed (fallbacks for the browser harness).
let rulerColors: Record<GitMark['kind'], string> | undefined;
function rulerColor(kind: GitMark['kind'], staged: boolean) {
  if (!rulerColors) {
    const css = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => toHex(css.getPropertyValue(`--vscode-editorOverviewRuler-${name}`).trim(), fallback);
    rulerColors = {
      added: color('addedForeground', '#2ea04399'),
      modified: color('modifiedForeground', '#0078d499'),
      deleted: color('deletedForeground', '#f8514999'),
    };
  }
  // Staged: the same hue, mostly transparent.
  return staged ? rulerColors[kind].slice(0, 7) + '40' : rulerColors[kind];
}

const KIND_LABEL: Record<GitMark['kind'], string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted' };

function decoration(mark: GitMark, staged: boolean): monaco.editor.IModelDeltaDecoration {
  const overviewRuler = { color: rulerColor(mark.kind, staged), position: monaco.editor.OverviewRulerLane.Left };
  const common = {
    overviewRuler,
    linesDecorationsTooltip: `${KIND_LABEL[mark.kind]} (${staged ? 'staged' : 'unstaged'})`,
    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
  };
  const cls = `pw-git-gutter${staged ? ' pw-git-staged' : ''}`;
  if (mark.kind === 'deleted') {
    // A triangle on the boundary where lines were removed: below `start`, or above line 1.
    const line = Math.max(1, mark.start);
    return {
      range: new monaco.Range(line, 1, line, 1),
      options: { ...common, linesDecorationsClassName: `${cls} pw-git-deleted${mark.start === 0 ? ' top' : ''}` },
    };
  }
  return {
    range: new monaco.Range(mark.start, 1, mark.end, 1),
    options: { ...common, isWholeLine: true, linesDecorationsClassName: `${cls} pw-git-${mark.kind}` },
  };
}
