import { memo, type CSSProperties } from 'react';
import { NodeResizer, useStore, type NodeProps } from '@xyflow/react';
import { DEFAULT_FOLDER_SHOW_TITLE } from '../shared/workspace';
import { baseName, displayPath } from '../shared/paths';
import { useLocked, useWorkspace, type RFFolderNode } from './context';
import { HeaderMenu, type MenuEntries } from './HeaderMenu';
import { NodeHandles } from './handles';
import { Annotation, useChildrenExtent, useToggleAnnotation } from './BoardNodes';
import { NodeTitle, useBodyColor, useHeaderColor, useTitleMenuItems } from './NodeTitle';
import { useTagMenuItem } from './Tags';
import { useFolderMissing } from './folderStore';
import { toneOver } from './tone';

/**
 * A project folder: a container like a group (any box can sit in it, new files from the folder are added to it) with a
 * file's title bar, title label, tags and annotation. Its body color is picked from its menu.
 */
export const FolderNode = memo(function FolderNode({ id, data, selected, width, deletable }: NodeProps<RFFolderNode>) {
  const ctx = useWorkspace();
  const locked = useLocked(id) !== '';
  const extent = useChildrenExtent(id);
  const missing = useFolderMissing(data.folder);
  const empty = useStore((s) => !s.nodes.some((n) => n.parentId === id));
  const path = displayPath(data.folder);
  const slash = path.lastIndexOf('/');
  const name = data.folder ? baseName(data.folder) : 'Workspace folder';
  const toggleAnnotation = useToggleAnnotation(id, data.annotation);
  const titleItems = useTitleMenuItems(id, data, DEFAULT_FOLDER_SHOW_TITLE);
  const tagItem = useTagMenuItem(id, data);
  // The header shows the body (see .pw-folder): the body color at 60% or the paper at 45%, over the canvas.
  const body = { color: data.color, alpha: data.color ? 0.6 : 0.45 };
  const headerColor = useHeaderColor(id, data, body);
  const bodyColor = useBodyColor(id, data.color, headerColor.header.ref);
  // A locked folder keeps only the entries that change nothing (and Unlock, from nodeMenuItems).
  const menuItems = (): MenuEntries => locked ? [] : [
    { icon: 'comment', label: data.annotation !== undefined ? 'Remove annotation' : 'Add annotation', active: data.annotation !== undefined, onClick: toggleAnnotation },
    tagItem,
    ...titleItems,
    headerColor.item,
    ...bodyColor.items,
  ];
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ctx.openNodeMenu(id, e.clientX, e.clientY, menuItems());
  };
  const style = (data.color ? { '--pw-group-color': data.color } : {}) as CSSProperties;

  return (
    <>
      <div
        className={`pw-folder${selected ? ' selected' : ''}${data.color ? ' colored' : ''}${missing ? ' missing' : ''}`}
        style={style}
        // The empty body (not a child or the header).
        onDoubleClick={(e) => e.target === e.currentTarget && ctx.focusNode(id)}
        onContextMenu={(e) => e.target === e.currentTarget && openMenu(e)}
      >
        <NodeResizer
          isVisible={selected && !locked}
          minWidth={Math.max(ctx.config.minNodeWidth, extent.w)}
          minHeight={Math.max(ctx.config.minNodeHeight, extent.h)}
          lineClassName="pw-resize-line"
          handleClassName="pw-resize-handle"
        />
        <NodeHandles />
        <header
          ref={headerColor.header.ref}
          className={`pw-file-header pw-folder-header${headerColor.header.className}`}
          style={headerColor.header.style}
          onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && ctx.focusNode(id)}
          onContextMenu={openMenu}
        >
          <span className="codicon codicon-folder pw-folder-icon" />
          {missing && <span className="codicon codicon-warning pw-missing-badge" title="Folder not found: it was deleted or moved" />}
          <span className="pw-path" title={missing ? `${path || name} (not found)` : path || name}>
            {slash >= 0 && <span className="pw-dir">{path.slice(0, slash + 1)}</span>}
            <span className="pw-base">{data.folder ? path.slice(slash + 1) : name}</span>
          </span>
          <span className="pw-spacer" />
          {missing ? (
            <button className="pw-icon nodrag" title="Find the folder to show instead" onClick={() => ctx.relinkFolder(data.folder)}>
              <span className="codicon codicon-search" />
            </button>
          ) : (
            <button className="pw-icon nodrag" title="Reveal in Explorer" onClick={() => ctx.revealInExplorer(data.folder)}>
              <span className="codicon codicon-go-to-file" />
            </button>
          )}
          <HeaderMenu items={() => [...menuItems(), 'separator', ...ctx.nodeMenuItems(id)]} />
          {deletable !== false && (
            <button className="pw-icon nodrag" title="Remove folder and its content from canvas" onClick={() => ctx.remove(id)}>
              <span className="codicon codicon-close" />
            </button>
          )}
        </header>
        {/* Like a missing file's body; with content inside, the header alone shows the state (the notice would cover it). */}
        {missing && empty && (
          <div className={`pw-missing pw-folder-missing ${toneOver(body, ctx.config.canvasBackground)}`}>
            <span className="codicon codicon-warning pw-missing-icon" />
            <div className="pw-missing-title">Folder not found</div>
            <div className="pw-missing-text">
              <code>{path || name}</code> was deleted or moved. Find the folder it should show, or remove it from the canvas.
            </div>
            <div className="pw-missing-actions">
              <button className="pw-button primary nodrag" onClick={() => ctx.relinkFolder(data.folder)}>
                <span className="codicon codicon-search" /> Find folder…
              </button>
              <button className="pw-button nodrag" onClick={() => ctx.remove(id)}>
                <span className="codicon codicon-trash" /> Remove from canvas
              </button>
            </div>
          </div>
        )}
      </div>
      <NodeTitle id={id} data={data} fallback={name} width={width ?? 0} defaultShown={DEFAULT_FOLDER_SHOW_TITLE} />
      {headerColor.picker}
      {bodyColor.picker}
      <Annotation id={id} value={data.annotation} />
    </>
  );
});
