// Path helpers for `file` entries in a `.workspace` document. Pure string logic so it can be unit tested.
// Paths are stored relative to the workspace folder that owns the `.paperworkspace` directory,
// using POSIX separators, so papers can be committed and shared across machines/OSes.

/** Is `p` an absolute path or URI (i.e. not relative to the workspace root)? */
export function isAbsoluteWorkspacePath(p: string): boolean {
  return /^[a-zA-Z][\w+.-]+:\/\//.test(p) || p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * Convert a file path (URI path component, POSIX) to the form stored in the workspace file.
 * `rootPath` and `filePath` are URI `path`s (always '/'-separated).
 */
export function toWorkspacePath(rootPath: string, filePath: string): string | undefined {
  const root = rootPath.replace(/\/+$/, '');
  if (filePath.startsWith(root + '/')) return filePath.slice(root.length + 1);
  // Case-insensitive match for Windows drive letters / paths.
  if (filePath.toLowerCase().startsWith(root.toLowerCase() + '/')) return filePath.slice(root.length + 1);
  return undefined;
}

/** Display label for a node header, e.g. `src/pages/Foo.tsx`. */
export function displayPath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function baseName(p: string): string {
  const parts = displayPath(p).split('/');
  return parts[parts.length - 1] || p;
}

export function sanitizeWorkspaceName(name: string): string {
  return name
    .trim()
    .replace(/.workspace$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}
