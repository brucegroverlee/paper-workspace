import type { LineRange } from '../shared/workspace';
import type { WorkspaceActions } from './context';
import type { HeaderMenuItem } from './HeaderMenu';

/**
 * "Copy path" / "Copy relative path" entries of a file, folder or snippet menu, like VS Code's Explorer. A snippet's
 * first target line is appended (`src/a.ts:12`), so VS Code opens the pasted path at it.
 */
export function pathMenuItems(ctx: WorkspaceActions, path: string, lines?: LineRange): HeaderMenuItem[] {
  return [
    { icon: 'clippy', label: 'Copy path', onClick: () => ctx.copyPath(path, false, lines) },
    { icon: 'link', label: 'Copy relative path', onClick: () => ctx.copyPath(path, true, lines) },
  ];
}
