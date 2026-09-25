// Connection points: every node has one on each side, and a link can join any side of one node to any side of another.
import { memo } from 'react';
import { Handle, Position, type NodeHandle } from '@xyflow/react';
import { SIDES, type Side, type XY } from '../shared/workspace';

/** Size of a handle's hit area (px); styles.css draws it at this size, centered on the node's border. */
export const HANDLE_SIZE = 10;

export const SIDE_POSITION: Record<Side, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

/** The four handles of a node. All are sources: the canvas connects in loose mode, so any handle joins any other. */
export const NodeHandles = memo(function NodeHandles() {
  return (
    <>
      {SIDES.map((side) => (
        <Handle key={side} id={side} type="source" position={SIDE_POSITION[side]} className="pw-handle" />
      ))}
    </>
  );
});

/**
 * The same handles as data, matching what the DOM measures (HANDLE_SIZE boxes centered on each side). React Flow
 * uses them for nodes that are not mounted (offscreen with onlyRenderVisibleElements), so links to them still draw.
 */
export function nodeHandles(width: number, height: number): NodeHandle[] {
  const s = HANDLE_SIZE;
  const at = (side: Side, x: number, y: number): NodeHandle => ({ id: side, type: 'source', position: SIDE_POSITION[side], x: x - s / 2, y: y - s / 2, width: s, height: s });
  return [at('top', width / 2, 0), at('right', width, height / 2), at('bottom', width / 2, height), at('left', 0, height / 2)];
}

type Rect = { x: number; y: number; width: number; height: number };

/** The side of `rect` facing `p` (by the diagonals, so a wide node's top covers more than its narrow ends). */
export function nearestSide(rect: Rect, p: XY): Side {
  const rx = (p.x - (rect.x + rect.width / 2)) / Math.max(1, rect.width);
  const ry = (p.y - (rect.y + rect.height / 2)) / Math.max(1, rect.height);
  if (Math.abs(rx) > Math.abs(ry)) return rx > 0 ? 'right' : 'left';
  return ry > 0 ? 'bottom' : 'top';
}

/** Sides for a link whose sides were not chosen: the ones facing each other. */
export function facingSides(a: Rect, b: Rect): { source: Side; target: Side } {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' };
  return dy >= 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' };
}
