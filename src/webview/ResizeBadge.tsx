import { ViewportPortal, useInternalNode, useStore } from '@xyflow/react';

/** Live "width × height" readout under the node being resized, kept at a constant screen size whatever the zoom. */
export function ResizeBadge({ id }: { id: string }) {
  const node = useInternalNode(id);
  const zoom = useStore((s) => s.transform[2]);
  if (!node) return null;
  const w = Math.round(node.width ?? node.measured.width ?? 0);
  const h = Math.round(node.height ?? node.measured.height ?? 0);
  const { x, y } = node.internals.positionAbsolute;
  return (
    <ViewportPortal>
      <div
        className="pw-resize-badge"
        style={{ transform: `translate(${x + w / 2}px, ${y + h}px) scale(${1 / zoom}) translate(-50%, 8px)` }}
      >
        {w} × {h}
      </div>
    </ViewportPortal>
  );
}
