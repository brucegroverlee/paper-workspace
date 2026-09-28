import { memo } from 'react';
import { NodeResizer, useStore, type NodeProps } from '@xyflow/react';
import { ANNOTATION_SPACE, FILE_PADDING, FILE_HEADER_HEIGHT } from '../shared/workspace';
import { displayPath } from '../shared/paths';
import { useDoc, useWorkspace, type RFEditorNode, type RFFileNode } from './context';
import { EditorBody, TargetControls, useTargetMenuItems } from './EditorNode';
import { HeaderMenu, type MenuEntries } from './HeaderMenu';
import { languageBadge } from './monaco';
import { NodeHandles } from './handles';
import { Annotation, useToggleAnnotation } from './BoardNodes';

/** Smallest size that still contains every visible child editor, as "WxH" (a string keeps the selector stable). */
function useChildrenExtent(id: string) {
  const extent = useStore((s) => {
    let w = FILE_PADDING * 2;
    let h = FILE_HEADER_HEIGHT + FILE_PADDING;
    for (const n of s.nodes) {
      if (n.parentId !== id || n.hidden) continue;
      w = Math.max(w, n.position.x + (n.width ?? n.measured?.width ?? 0) + FILE_PADDING);
      const caption = (n.data as { annotation?: string }).annotation !== undefined ? ANNOTATION_SPACE : 0;
      h = Math.max(h, n.position.y + (n.height ?? n.measured?.height ?? 0) + caption + FILE_PADDING);
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
  const toggleAnnotation = useToggleAnnotation(id, data.annotation);
  const missing = !!doc?.missing;
  const targetItems = useTargetMenuItems(single);
  const menuItems = (): MenuEntries => [
    ...(missing ? [] : targetItems),
    !missing && { icon: 'add', label: 'Add a snippet editor', onClick: () => ctx.addEditor(id) },
    'separator',
    { icon: 'comment', label: data.annotation !== undefined ? 'Remove annotation' : 'Add annotation', active: data.annotation !== undefined, onClick: toggleAnnotation },
  ];
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.openNodeMenu(id, e.clientX, e.clientY, menuItems());
  };

  return (
    <>
      <div
        className={`pw-file${single ? ' single' : ''}${selected ? ' selected' : ''}${missing ? ' missing' : ''}`}
        // The empty body between snippet editors.
        onDoubleClick={(e) => e.target === e.currentTarget && ctx.focusNode(id)}
        onContextMenu={(e) => e.target === e.currentTarget && openMenu(e)}
      >
        <NodeResizer isVisible={selected} minWidth={minWidth} minHeight={minHeight} lineClassName="pw-resize-line" handleClassName="pw-resize-handle" />
        <NodeHandles />
        <header
          className="pw-file-header"
          onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && ctx.focusNode(id)}
          onContextMenu={openMenu}
        >
          <span className={`pw-badge lang-${doc?.languageId ?? 'unknown'}`}>{languageBadge(doc?.languageId, data.file)}</span>
          {missing && <span className="codicon codicon-warning pw-missing-badge" title="File not found: it was deleted or moved" />}
          <span className="pw-path" title={missing ? `${path} (not found)` : path}>
            {slash >= 0 && <span className="pw-dir">{path.slice(0, slash + 1)}</span>}
            <span className="pw-base">{path.slice(slash + 1)}</span>
          </span>
          {doc?.dirty && <span className="pw-dirty" title="Unsaved changes (Ctrl+S saves all)" />}
          {single && !missing ? <TargetControls id={single.id} data={single.data} /> : <span className="pw-spacer" />}
          {missing ? (
            <button className="pw-icon nodrag" title="Find the file to show instead" onClick={() => ctx.relinkFile(data.file)}>
              <span className="codicon codicon-search" />
            </button>
          ) : (
            <button className="pw-icon nodrag" title="Open in text editor" onClick={() => ctx.openInEditor(data.file, single?.data.target?.start ?? 1)}>
              <span className="codicon codicon-go-to-file" />
            </button>
          )}
          <HeaderMenu items={() => [...menuItems(), 'separator', ...ctx.nodeMenuItems(id)]} />
          <button className="pw-icon nodrag" title="Remove file from canvas" onClick={() => ctx.remove(id)}>
            <span className="codicon codicon-close" />
          </button>
        </header>
        {single && <EditorBody id={single.id} data={single.data} fileNodeId={id} onContextMenu={openMenu} />}
      </div>
      <Annotation id={id} value={data.annotation} />
    </>
  );
});
