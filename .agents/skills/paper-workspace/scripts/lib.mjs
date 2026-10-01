// Shared helpers for outline.mjs and validate.mjs. Node 18+, no dependencies.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Accepts a workspace path or a `paperworkspace:<path>[#<type>/<id>]` reference.
 * Returns { wsPath (absolute), root (project root), ref: { type, id } | null }.
 */
export function parseTarget(arg) {
  if (!arg) throw new Error('missing workspace path or paperworkspace: reference');
  let p = arg.trim();
  let ref = null;
  if (p.startsWith('paperworkspace:')) {
    p = p.slice('paperworkspace:'.length);
    const hash = p.lastIndexOf('#');
    if (hash >= 0) {
      const [type, ...rest] = p.slice(hash + 1).split('/');
      ref = { type, id: rest.join('/') };
      p = p.slice(0, hash);
    }
  }
  let wsPath = path.resolve(p);
  if (!fs.existsSync(wsPath) && !p.includes('.paperworkspace')) {
    const alt = path.resolve('.paperworkspace', p.endsWith('.workspace') ? p : `${p}.workspace`);
    if (fs.existsSync(alt)) wsPath = alt;
  }
  // The project root is the folder that contains `.paperworkspace/`.
  const dir = path.dirname(wsPath);
  const root = path.basename(dir) === '.paperworkspace' ? path.dirname(dir) : process.cwd();
  return { wsPath, root, ref };
}

export function loadWorkspace(wsPath) {
  const raw = fs.readFileSync(wsPath, 'utf8');
  const ws = JSON.parse(raw);
  ws.nodes ??= [];
  ws.edges ??= [];
  ws.tags ??= [];
  return ws;
}

export function index(ws) {
  const byId = new Map();
  const children = new Map();
  for (const n of ws.nodes) {
    byId.set(n.id, n);
    if (n.parent) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(n);
    }
  }
  const tagById = new Map(ws.tags.map((t) => [t.id, t]));
  return { byId, children, tagById };
}

const fileCache = new Map();
/** Lines of a project file (1-based access via lines[n - 1]), or null if missing. */
export function readLines(root, rel) {
  const abs = path.isAbsolute(rel) ? rel : path.resolve(root, rel);
  if (fileCache.has(abs)) return fileCache.get(abs);
  let lines = null;
  try {
    const text = fs.readFileSync(abs, 'utf8');
    lines = text.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  } catch {
    lines = null;
  }
  fileCache.set(abs, lines);
  return lines;
}

export function exists(root, rel, kind) {
  const abs = path.isAbsolute(rel) ? rel : path.resolve(root, rel);
  try {
    const st = fs.statSync(abs);
    return kind === 'dir' ? st.isDirectory() : kind === 'file' ? st.isFile() : true;
  } catch {
    return false;
  }
}

/**
 * Checks an editor's anchor against its file.
 * Returns { status: 'ok' | 'drift' | 'lost' | 'no-anchor' | 'no-target' | 'missing-file' | 'out-of-range', line? }.
 */
export function checkAnchor(root, file, editor) {
  const lines = readLines(root, file);
  if (!lines) return { status: 'missing-file' };
  const t = editor.target;
  if (!t) return { status: 'no-target' };
  if (t.start < 1 || t.end < t.start || t.end > lines.length) return { status: 'out-of-range', count: lines.length };
  if (!editor.anchor) return { status: 'no-anchor' };
  const want = editor.anchor.trim();
  if (lines[t.start - 1].trim() === want) return { status: 'ok' };
  let best = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === want && (best < 0 || Math.abs(i + 1 - t.start) < Math.abs(best - t.start))) best = i + 1;
  }
  return best > 0 ? { status: 'drift', line: best } : { status: 'lost' };
}

export const PROTECT_LABELS = [
  'do not touch', "don't touch", 'do not change', "don't change", 'do not modify', 'keep', 'keep as is',
  'read only', 'frozen', 'reference', 'baseline',
];
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Ids of protected nodes: locked, carrying a protection tag, or inside a protected container. */
export function protectedIds(ws, extraLabels = []) {
  const { byId, tagById } = index(ws);
  const labels = new Set([...PROTECT_LABELS, ...extraLabels].map(norm));
  const direct = (n) =>
    n.locked === true || (n.tags ?? []).some((t) => tagById.has(t) && labels.has(norm(tagById.get(t).label)));
  const out = new Set();
  for (const n of ws.nodes) {
    let cur = n;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (direct(cur)) {
        out.add(n.id);
        break;
      }
      cur = cur.parent ? byId.get(cur.parent) : null;
    }
  }
  return out;
}

export function args(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        opts[key] = next;
        i++;
      } else opts[key] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}
