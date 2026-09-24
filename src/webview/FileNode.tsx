import { memo } from 'react';
import { NodeResizer, useStore, type NodeProps } from '@xyflow/react';
import { FILE_PADDING, FILE_HEADER_HEIGHT } from '../shared/workspace';
import { displayPath } from '../shared/paths';
import { useDoc, useWorkspace, type RFEditorNode, type RFFileNode } from './context';
import { EditorBody, TargetControls } from './EditorNode';
import { languageBadge } from './monaco';

/** Smallest size that still contains every visible child editor, as "WxH" (a string keeps the selector stable). */
function useChildrenExtent(id: string) {
  const extent = useStore((s) => {
    let w = FILE_PADDING * 2;
    let h = FILE_HEADER_HEIGHT + FILE_PADDING;
    for (const n of s.nodes) {
      if (n.parentId !== id || n.hidden) continue;
      w = Math.max(w, n.position.x + (n.width ?? n.measured?.width ?? 0) + FILE_PADDING);
      h = Math.max(h, n.position.y + (n.height ?? n.measured?.height ?? 0) + FILE_PADDING);
    }
    return `${Math.round(w)}x${Math.round(h)}`;
  });
  const [w, h] = extent.split('x').map(Number);
  return { w, h };
}

/**
 * One source file. With a single editor it is a combined node (the editor is embedded and its React Flow node
 * hidden); with several editors it is a group whose editors are separate, movable child nodes.
 */
export const FileNode = memo(function FileNode({ id, data, selected }: NodeProps<RFFileNode>) {
  const ctx = useWorkspace();
  const doc = useDoc(data.file);
  // The embedded editor of a combined node (App hides the only child of a file).
  const single = useStore((s) => s.nodes.find((n) => n.parentId === id && n.hidden) as RFEditorNode | undefined);
  const extent = useChildrenExtent(id);
  const path = displayPath(data.file);
  const slash = path.lastIndexOf('/');
  const { minNodeWidth, minNodeHeight } = ctx.config;
  const minWidth = single ? minNodeWidth : Math.max(minNodeWidth, extent.w);
  const minHeight = single ? minNodeHeight : Math.max(minNodeHeight, extent.h);

  return (
    <div className={`pw-file${single ? ' single' : ''}${selected ? ' selected' : ''}`}>
      <NodeResizer isVisible={selected} minWidth={minWidth} minHeight={minHeight} lineClassName="pw-resize-line" handleClassName="pw-resize-handle" />
      <header
        className="pw-file-header"
        onDoubleClick={() => ctx.openInEditor(data.file, single?.data.target?.start ?? 1)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.openNodeMenu(id, e.clientX, e.clientY);
        }}
      >
        <span className={`pw-badge lang-${doc?.languageId ?? 'unknown'}`}>{languageBadge(doc?.languageId, data.file)}</span>
        <span className="pw-path" title={path}>
          {slash >= 0 && <span className="pw-dir">{path.slice(0, slash + 1)}</span>}
          <span className="pw-base">{path.slice(slash + 1)}</span>
        </span>
        {doc?.dirty && <span className="pw-dirty" title="Unsaved changes (Ctrl+S saves all)" />}
        {single ? <TargetControls id={single.id} data={single.data} /> : <span className="pw-spacer" />}
        <button className="pw-icon nodrag" title="Add a snippet editor for this file" onClick={() => ctx.addEditor(id)}>
          <span className="codicon codicon-add" />
        </button>
        <button className="pw-icon nodrag" title="Focus on this paper" onClick={() => ctx.focusNode(id)}>
          <span className="codicon codicon-zoom-in" />
        </button>
        <button className="pw-icon nodrag" title="Open in text editor" onClick={() => ctx.openInEditor(data.file, single?.data.target?.start ?? 1)}>
          <span className="codicon codicon-go-to-file" />
        </button>
        <button className="pw-icon nodrag" title="Remove file from canvas" onClick={() => ctx.remove(id)}>
          <span className="codicon codicon-close" />
        </button>
      </header>
      {single && <EditorBody id={single.id} data={single.data} />}
    </div>
  );
});
