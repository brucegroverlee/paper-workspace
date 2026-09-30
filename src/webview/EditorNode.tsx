import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeResizer, useReactFlow, useStore, type NodeProps } from '@xyflow/react';
import { moduleSpecifierAt, quotedStringAt } from '../shared/imports';
import { baseName } from '../shared/paths';
import { DEFAULT_EDITOR_SHOW_TITLE, defaultMinimap, type LineRange } from '../shared/workspace';
import type { EditorSettings } from '../shared/protocol';
import { useDoc, useLocked, useWorkspace, type EditorNodeData, type RFEditorNode } from './context';
import { monaco } from './monaco';
import { ZOOM_LIMITS } from './Toolbar';
import { NodeHandles } from './handles';
import { Annotation, useToggleAnnotation } from './BoardNodes';
import { HeaderMenu, type HeaderMenuItem, type MenuEntries } from './HeaderMenu';
import { NodeTitle, useHeaderColor, useTitleMenuItems } from './NodeTitle';
import { useTagMenuItem } from './Tags';
import { pathMenuItems } from './pathMenu';

/** Below this canvas zoom, editors render as a static preview instead of a live Monaco instance. */
const LIVE_EDITOR_MIN_ZOOM = 0.35;
const LINE_NUMBERS_MIN_CHARS = 4;
const LINE_DECORATIONS_WIDTH = 12;
const READ_ONLY_MESSAGE = { value: 'This paper is locked. Unlock it from its menu to edit the code.' };

const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2];

// ---- module state shared by all editor nodes ----------------------------------------------------------

/** Scroll position per editor node, so an editor unmounted offscreen comes back where it was. */
const scrollMemory = new Map<string, { top: number; left: number }>();
/** Editors that should scroll to their target on (re)mount, e.g. just added or revealed from the host. */
const pendingTargetScroll = new Set<string>();
const liveEditors = new Map<string, monaco.editor.IStandaloneCodeEditor>();
let lastFocusedEditor: string | null = null;

/** Scroll an editor back to its target now, or as soon as it mounts. */
export function requestScrollToTarget(id: string) {
  pendingTargetScroll.add(id);
  scrollMemory.delete(id);
  window.dispatchEvent(new CustomEvent('pw-scroll-to-target', { detail: id }));
}

/** Put the caret back in the last focused editor after the host briefly took focus (Explorer reveal). */
export function focusLastEditor() {
  if (lastFocusedEditor) liveEditors.get(lastFocusedEditor)?.focus();
}

/** Current selection of a live editor as a line range, if it has a non-empty selection. */
export function selectedLines(id: string): LineRange | undefined {
  const sel = liveEditors.get(id)?.getSelection();
  if (!sel || sel.isEmpty()) return undefined;
  const end = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber;
  return { start: sel.startLineNumber, end };
}

/** Whether the caret is currently in one of the live editors. */
export function editorHasFocus() {
  for (const ed of liveEditors.values()) if (ed.hasTextFocus()) return true;
  return false;
}

export function lastFocusedEditorId() {
  return lastFocusedEditor;
}

// ---- go to definition -------------------------------------------------------------------------------

const IS_MAC = /Mac/i.test(navigator.userAgent);

/** Cmd on macOS, Ctrl elsewhere (VS Code's default with `editor.multiCursorModifier: alt`). */
function isGoToModifier(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }) {
  return (IS_MAC ? e.metaKey : e.ctrlKey) && !e.altKey;
}

/** What Ctrl/Cmd+click would follow at the mouse: an import path string, or the word under the pointer. */
function linkRangeAt(model: monaco.editor.ITextModel, e: monaco.editor.IEditorMouseEvent): monaco.Range | null {
  const pos = e.target.position;
  if (!pos || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT) return null;
  const spec = quotedStringAt(model.getLineContent(pos.lineNumber), pos.column);
  if (spec && moduleSpecifierAt(model.getLineContent(pos.lineNumber), pos.column) && spec.end > spec.start) {
    return new monaco.Range(pos.lineNumber, spec.start, pos.lineNumber, spec.end);
  }
  const word = model.getWordAtPosition(pos);
  return word ? new monaco.Range(pos.lineNumber, word.startColumn, pos.lineNumber, word.endColumn) : null;
}

// ---- node -------------------------------------------------------------------------------------------

export const EditorNode = memo(function EditorNode({ id, data, selected, parentId, width, deletable }: NodeProps<RFEditorNode>) {
  const ctx = useWorkspace();
  const locked = useLocked(id) !== '';
  const doc = useDoc(data.file);
  const missing = !!doc?.missing;
  // Default title: the first highlighted line, live from the model (the saved anchor until it loads).
  const firstLine = data.target && (doc?.model && data.target.start <= doc.model.getLineCount() ? doc.model.getLineContent(data.target.start).trim() : data.anchor);
  const titleFallback = firstLine || baseName(data.file);
  const toggleAnnotation = useToggleAnnotation(id, data.annotation);
  const targetItems = useTargetMenuItems({ id, data });
  const titleItems = useTitleMenuItems(id, data, DEFAULT_EDITOR_SHOW_TITLE);
  const tagItem = useTagMenuItem(id, data);
  const headerColor = useHeaderColor(id, data);
  // A locked snippet keeps only the entries that change nothing (and Unlock, from nodeMenuItems).
  const menuItems = (): MenuEntries => [
    ...(locked ? [] : [
      ...(missing ? [] : targetItems),
      'separator',
      { icon: 'comment', label: data.annotation !== undefined ? 'Remove annotation' : 'Add annotation', active: data.annotation !== undefined, onClick: toggleAnnotation },
      tagItem,
      ...titleItems,
      headerColor.item,
    ] satisfies MenuEntries),
    'separator',
    ...pathMenuItems(ctx, data.file, data.target),
  ];
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.openNodeMenu(id, e.clientX, e.clientY, menuItems());
  };
  return (
    <>
      <div className={`pw-editor${selected ? ' selected' : ''}`}>
        <NodeResizer isVisible={selected && !locked} minWidth={ctx.config.minNodeWidth} minHeight={ctx.config.minNodeHeight} lineClassName="pw-resize-line" handleClassName="pw-resize-handle" />
        <NodeHandles />
        <header
          ref={headerColor.header.ref}
          className={`pw-editor-header${headerColor.header.className}`}
          style={headerColor.header.style}
          onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && ctx.focusNode(id)}
          onContextMenu={openMenu}
        >
          <span className="codicon codicon-symbol-snippet pw-editor-icon" />
          {missing ? <span className="pw-spacer" /> : <TargetControls id={id} data={data} />}
          {!missing && (
            <button className="pw-icon nodrag" title="Open in text editor" onClick={() => ctx.openInEditor(data.file, data.target?.start ?? 1)}>
              <span className="codicon codicon-go-to-file" />
            </button>
          )}
          <HeaderMenu items={() => [...menuItems(), 'separator', ...ctx.nodeMenuItems(id)]} />
          {deletable !== false && (
            <button className="pw-icon nodrag" title="Remove this snippet" onClick={() => ctx.remove(id)}>
              <span className="codicon codicon-close" />
            </button>
          )}
        </header>
        <EditorBody id={id} data={data} fileNodeId={parentId!} onContextMenu={openMenu} />
      </div>
      <NodeTitle id={id} data={data} fallback={titleFallback} width={width ?? 0} defaultShown={DEFAULT_EDITOR_SHOW_TITLE} />
      {headerColor.picker}
      <Annotation id={id} value={data.annotation} />
    </>
  );
});

/** Target label and the jump back to it. Shared by snippet headers and combined file headers. */
export function TargetControls({ id, data }: { id: string; data: EditorNodeData }) {
  const { target } = data;
  return (
    <>
      <span className="pw-target-label" title={target ? 'Target lines of this snippet' : 'No target: a plain view of the file'}>
        {target ? `L${target.start}–${target.end}` : 'Whole file'}
      </span>
      <span className="pw-spacer" />
      {target && (
        <button className="pw-icon nodrag" title="Scroll back to the target" onClick={() => requestScrollToTarget(id)}>
          <span className="codicon codicon-target" />
        </button>
      )}
    </>
  );
}

/** Set / clear target and minimap entries for a header's "more actions" menu (none without an editor). */
export function useTargetMenuItems(editor: { id: string; data: EditorNodeData } | undefined): HeaderMenuItem[] {
  const ctx = useWorkspace();
  if (!editor) return [];
  const { id, data } = editor;
  const minimap = data.minimap ?? defaultMinimap(data.target);
  const pinTarget = () => {
    const ed = liveEditors.get(id);
    let next = selectedLines(id);
    if (!next && ed) {
      // No selection: pin what is currently visible.
      const visible = ed.getVisibleRanges();
      if (visible.length) next = { start: visible[0].startLineNumber, end: visible[visible.length - 1].endLineNumber };
    }
    if (next) ctx.setTarget(id, next);
  };
  return [
    { icon: 'pinned', label: 'Set target to selection (or visible lines)', onClick: pinTarget },
    ...(data.target ? [{ icon: 'pin', label: 'Clear target', onClick: () => ctx.setTarget(id, undefined) }] : []),
    { icon: 'layout-sidebar-right', label: 'Show minimap', active: minimap, onClick: () => ctx.setMinimap(id, !minimap) },
  ];
}

/**
 * The code area of an editor: a live Monaco editor, or a static preview when zoomed far out. Right-click opens the
 * paper's menu (`onContextMenu`) everywhere but over Monaco, which keeps its own.
 */
export function EditorBody(props: { id: string; data: EditorNodeData; fileNodeId: string; onContextMenu(e: React.MouseEvent): void }) {
  const { id, data, fileNodeId } = props;
  const ctx = useWorkspace();
  const doc = useDoc(data.file);
  const zoom = useStore(zoomSelector);
  const live = zoom >= LIVE_EDITOR_MIN_ZOOM;
  // The code of a locked snippet (or of one in a locked file, folder or group) is read-only.
  const readOnly = useLocked(id) !== '';
  const body = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();

  // Ctrl/Cmd+wheel over code zooms the canvas (like everywhere else) instead of being swallowed by Monaco or
  // ignored because of `nowheel`. Lives on the body so it works for both the live editor and the preview.
  useEffect(() => {
    const el = body.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const { x, y, zoom } = rf.getViewport();
      // Same step as React Flow's pane wheelDelta (x10 only for macOS trackpad pinch), so zoom speed is identical.
      const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002;
      const factor = e.ctrlKey && /Mac/i.test(navigator.userAgent) ? 10 : 1;
      const next = Math.min(ZOOM_LIMITS.max, Math.max(ZOOM_LIMITS.min, zoom * Math.pow(2, -e.deltaY * unit * factor)));
      const pane = document.querySelector('.react-flow')!.getBoundingClientRect();
      const px = e.clientX - pane.left;
      const py = e.clientY - pane.top;
      rf.setViewport({ x: px - ((px - x) / zoom) * next, y: py - ((py - y) / zoom) * next, zoom: next });
    };
    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [rf]);

  return (
    // The preview is static (no editing or scrolling), so it drags the node like the rest of the paper.
    <div
      ref={body}
      className={`pw-editor-body ${live ? 'nodrag nopan nowheel' : 'preview'}`}
      // focusNode maps the hidden editor of a combined file node to the file node.
      onDoubleClick={live ? undefined : () => ctx.focusNode(id)}
      onContextMenu={(e) => !(e.target as HTMLElement).closest('.monaco-editor') && props.onContextMenu(e)}
    >
      {doc?.missing ? (
        <MissingFile file={data.file} fileNodeId={fileNodeId} />
      ) : doc?.error ? (
        <div className="pw-error">{doc.error}</div>
      ) : !doc?.model ? (
        <div className="pw-loading">Loading…</div>
      ) : live ? (
        <LiveEditor
          id={id}
          model={doc.model}
          target={data.target}
          minimap={data.minimap ?? defaultMinimap(data.target)}
          settings={ctx.settings}
          readOnly={readOnly}
          onFocus={() => ctx.focusEditor(id)}
          onGoToDefinition={(line, column) => ctx.goToDefinition(data.file, line, column)}
        />
      ) : (
        <Preview id={id} model={doc.model} version={doc.version} target={data.target} settings={ctx.settings} />
      )}
    </div>
  );
}

/** Shown instead of the code when the file was deleted or moved: find it again, or drop it from the canvas. */
function MissingFile({ file, fileNodeId }: { file: string; fileNodeId: string }) {
  const ctx = useWorkspace();
  return (
    <div className="pw-missing">
      <span className="codicon codicon-warning pw-missing-icon" />
      <div className="pw-missing-title">File not found</div>
      <div className="pw-missing-text">
        <code>{file}</code> was deleted or moved. Find the file it should show, or remove it from the canvas.
      </div>
      <div className="pw-missing-actions">
        <button className="pw-button primary nodrag" onClick={() => ctx.relinkFile(file)}>
          <span className="codicon codicon-search" /> Find file…
        </button>
        <button className="pw-button nodrag" onClick={() => ctx.remove(fileNodeId)}>
          <span className="codicon codicon-trash" /> Remove from canvas
        </button>
      </div>
    </div>
  );
}

// ---- live editor ----------------------------------------------------------------------------------------

function LiveEditor(props: {
  id: string;
  model: monaco.editor.ITextModel;
  target: LineRange | undefined;
  minimap: boolean;
  settings: EditorSettings;
  readOnly: boolean;
  onFocus(): void;
  onGoToDefinition(line: number, column: number): void;
}) {
  const { id, model, target, minimap, settings, readOnly } = props;
  const container = useRef<HTMLDivElement>(null);
  const overflow = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const onFocusRef = useRef(props.onFocus);
  onFocusRef.current = props.onFocus;
  const onGoToDefinitionRef = useRef(props.onGoToDefinition);
  onGoToDefinitionRef.current = props.onGoToDefinition;
  const [offTarget, setOffTarget] = useState<'above' | 'below' | null>(null);

  const updateOffTarget = () => {
    const ed = editor.current;
    const t = targetRef.current;
    if (!ed || !t) return setOffTarget(null);
    const visible = ed.getVisibleRanges();
    if (!visible.length) return setOffTarget(null);
    const first = visible[0].startLineNumber;
    const last = visible[visible.length - 1].endLineNumber;
    setOffTarget(t.end < first ? 'above' : t.start > last ? 'below' : null);
  };

  const scrollToTarget = (smooth: boolean) => {
    const ed = editor.current;
    const t = targetRef.current;
    if (!ed) return;
    const top = t ? Math.max(0, ed.getTopForLineNumber(t.start) - settings.lineHeight) : 0;
    ed.setScrollPosition({ scrollTop: top, scrollLeft: 0 }, smooth ? monaco.editor.ScrollType.Smooth : monaco.editor.ScrollType.Immediate);
  };

  useLayoutEffect(() => {
    const el = container.current!;
    const ed = monaco.editor.create(el, {
      model,
      automaticLayout: false,
      minimap: { enabled: minimap },
      scrollBeyondLastLine: false,
      scrollbar: { vertical: 'auto', horizontal: 'auto', alwaysConsumeMouseWheel: true, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      lineNumbersMinChars: LINE_NUMBERS_MIN_CHARS,
      lineDecorationsWidth: LINE_DECORATIONS_WIDTH,
      glyphMargin: false,
      folding: true,
      overviewRulerLanes: 2,
      overviewRulerBorder: false,
      stickyScroll: { enabled: false },
      renderLineHighlight: 'line',
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      tabSize: settings.tabSize,
      padding: { top: 4, bottom: 4 },
      wordWrap: 'off',
      fixedOverflowWidgets: false,
      // Same origin as the editor but outside its clipping, so suggestions can extend past small papers.
      overflowWidgetsDomNode: overflow.current!,
      // The classic hidden-textarea input path works in every host (older Electron in forks, automation).
      editContext: false,
      readOnly,
      readOnlyMessage: READ_ONLY_MESSAGE,
    });
    editor.current = ed;
    liveEditors.set(id, ed);
    decorations.current = ed.createDecorationsCollection();
    ed.layout({ width: el.clientWidth, height: el.clientHeight });

    const remembered = scrollMemory.get(id);
    if (remembered && !pendingTargetScroll.has(id)) ed.setScrollPosition({ scrollTop: remembered.top, scrollLeft: remembered.left });
    else scrollToTarget(false);
    pendingTargetScroll.delete(id);

    const subs = [
      ed.onDidScrollChange((e) => {
        scrollMemory.set(id, { top: e.scrollTop, left: e.scrollLeft });
        updateOffTarget();
      }),
      ed.onDidLayoutChange(updateOffTarget),
      ed.onDidFocusEditorText(() => {
        lastFocusedEditor = id;
        onFocusRef.current();
      }),
    ];
    updateOffTarget();

    const onRequest = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return;
      pendingTargetScroll.delete(id);
      scrollToTarget(true);
    };
    window.addEventListener('pw-scroll-to-target', onRequest);

    // Ctrl/Cmd+click goes to the definition (the host asks VS Code's language service); holding the modifier
    // underlines what would be followed, like VS Code. Monaco's own multi-cursor modifier stays Alt.
    const link = ed.createDecorationsCollection();
    let hover: monaco.editor.IEditorMouseEvent | null = null;
    const updateLink = (modifier: boolean) => {
      const range = modifier && hover ? linkRangeAt(model, hover) : null;
      link.set(range ? [{ range, options: { inlineClassName: 'pw-goto-link' } }] : []);
    };
    const onKey = (e: KeyboardEvent) => updateLink(isGoToModifier(e));
    subs.push(
      ed.onMouseMove((e) => {
        hover = e;
        updateLink(isGoToModifier(e.event));
      }),
      ed.onMouseLeave(() => {
        hover = null;
        updateLink(false);
      }),
      ed.onMouseDown((e) => {
        if (!e.event.leftButton || !isGoToModifier(e.event)) return;
        const range = linkRangeAt(model, e);
        if (!range) return;
        e.event.preventDefault();
        updateLink(false);
        onGoToDefinitionRef.current(e.target.position!.lineNumber, e.target.position!.column);
      }),
    );
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      subs.forEach((s) => s.dispose());
      window.removeEventListener('pw-scroll-to-target', onRequest);
      ed.dispose();
      if (liveEditors.get(id) === ed) liveEditors.delete(id);
      editor.current = null;
    };
    // Recreate only when the model changes; target/settings updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, id]);

  useLayoutEffect(() => {
    editor.current?.updateOptions({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      tabSize: settings.tabSize,
    });
  }, [settings]);

  useLayoutEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly]);

  useLayoutEffect(() => {
    editor.current?.updateOptions({ minimap: { enabled: minimap } });
  }, [minimap]);

  // Target highlight: owned by this editor, so other editors of the same file don't show it.
  useEffect(() => {
    decorations.current?.set(
      target
        ? [
            {
              range: new monaco.Range(target.start, 1, target.end, 1),
              options: {
                isWholeLine: true,
                className: 'pw-target-line',
                linesDecorationsClassName: 'pw-target-gutter',
                // Right lane (Git marks use the left one); the yellow of --pw-highlight (styles.css).
                overviewRuler: { color: 'rgba(232, 197, 71, 0.8)', position: monaco.editor.OverviewRulerLane.Right },
              },
            },
          ]
        : [],
    );
    updateOffTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.start, target?.end]);

  useEffect(() => {
    const el = container.current!;
    const ro = new ResizeObserver(() => editor.current?.layout({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div ref={container} className="pw-monaco" />
      <div ref={overflow} className="pw-monaco-overflow monaco-editor" />
      {offTarget && target && (
        <button
          className={`pw-back-pill ${offTarget}`}
          title="Scroll back to the target"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => scrollToTarget(true)}
        >
          <span className={`codicon codicon-arrow-${offTarget === 'above' ? 'up' : 'down'}`} />
          Back to L{target.start}–{target.end}
        </button>
      )}
    </>
  );
}

// ---- low-zoom preview ------------------------------------------------------------------------------------

/** Static, highlighted rendering used when the canvas is zoomed out too far for live editors to be useful. */
function Preview(props: {
  id: string;
  model: monaco.editor.ITextModel;
  version: number;
  target: LineRange | undefined;
  settings: EditorSettings;
}) {
  const { model, target, settings } = props;
  const [html, setHtml] = useState<string | null>(null);
  const remembered = scrollMemory.get(props.id);
  const first = remembered
    ? Math.max(1, Math.floor(remembered.top / settings.lineHeight) + 1)
    : Math.max(1, (target?.start ?? 1) - 1);
  const count = 80; // plenty for any node height at preview zoom levels; clipped by CSS
  const last = Math.min(model.getLineCount(), first + count - 1);

  useEffect(() => {
    let cancelled = false;
    const text = model.getLinesContent().slice(first - 1, last).join('\n');
    monaco.editor
      .colorize(text, model.getLanguageId(), { tabSize: settings.tabSize })
      .then((h) => !cancelled && setHtml(h))
      .catch(() => !cancelled && setHtml(null));
    return () => {
      cancelled = true;
    };
  }, [model, props.version, first, last, settings.tabSize]);

  return (
    <div className="pw-preview" style={{ fontFamily: settings.fontFamily, fontSize: settings.fontSize, lineHeight: `${settings.lineHeight}px` }}>
      {html !== null && <div className="pw-lines" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}
