#!/usr/bin/env node
// Prints a compact outline of a .workspace file, so an agent doesn't have to read the raw JSON.
//
//   node outline.mjs <workspace | paperworkspace:ref>            tree, tags, edges, anchor drift
//   node outline.mjs <workspace> --code                          + the target lines of every editor
//   node outline.mjs <workspace> --node <id>                     one item: context, edges, code
//   node outline.mjs "paperworkspace:<path>#<type>/<id>"         same as --node
//   options: --context <n> lines around targets (default 2), --max <n> lines of code per snippet (default 60)
import path from 'node:path';
import { parseTarget, loadWorkspace, index, readLines, checkAnchor, protectedIds, args } from './lib.mjs';

const { pos, opts } = args(process.argv.slice(2));
const { wsPath, root, ref } = parseTarget(pos[0]);
const ws = loadWorkspace(wsPath);
const rel = (p) => path.relative(process.cwd(), p) || '.';
const { byId, children, tagById } = index(ws);
const prot = protectedIds(ws);
const ctx = Number(opts.context ?? 2);
const max = Number(opts.max ?? 60);

const q = (s, n = 70) => {
  const one = String(s).replace(/\n/g, ' / ');
  return JSON.stringify(one.length > n ? `${one.slice(0, n - 1)}…` : one);
};
const tagNames = (n) => (n.tags ?? []).map((t) => tagById.get(t)?.label ?? `?${t}`).join(', ');

function fileOf(n) {
  return n.type === 'editor' ? byId.get(n.parent)?.file : n.file;
}

function anchorNote(n) {
  const file = fileOf(n);
  if (!file) return '';
  const r = checkAnchor(root, file, n);
  switch (r.status) {
    case 'ok': return '';
    case 'drift': return ` DRIFT→L${r.line}`;
    case 'lost': return ' ANCHOR-LOST';
    case 'missing-file': return ' FILE-MISSING';
    case 'out-of-range': return ` OUT-OF-RANGE(file has ${r.count})`;
    case 'no-anchor': return ' no-anchor';
    default: return '';
  }
}

function line(n) {
  const p = `@${Math.round(n.position?.x)},${Math.round(n.position?.y)} ${n.width}x${n.height}`;
  const bits = [n.type, n.id];
  switch (n.type) {
    case 'file': bits.push(n.file); if (n.title) bits.push(`title=${q(n.title, 40)}`); break;
    case 'folder': bits.push(`${n.folder || '(root)'}/`); if (n.title) bits.push(`title=${q(n.title, 40)}`); break;
    case 'editor':
      bits.push(n.target ? `L${n.target.start}-${n.target.end}` : 'whole-file');
      if (n.title) bits.push(`title=${q(n.title, 40)}`);
      break;
    case 'group': bits.push(q(n.title ?? '', 50)); break;
    case 'shape': bits.push(n.shape, q(n.text ?? '')); break;
    case 'note': case 'text': bits.push(q(n.text ?? '', n.type === 'note' ? 90 : 70)); break;
    case 'media': bits.push(n.src); break;
  }
  if (n.annotation) bits.push(`ann=${q(n.annotation, 60)}`);
  if (n.tags?.length) bits.push(`tags[${tagNames(n)}]`);
  if (n.headerColor) bits.push(`hdr=${n.headerColor}`);
  if (n.color && n.type !== 'text') bits.push(`color=${n.color}`);
  if (n.locked) bits.push('LOCKED');
  else if (prot.has(n.id)) bits.push('PROTECTED');
  let s = `${bits.join(' ')} ${p}`;
  if (n.type === 'editor') s += anchorNote(n);
  return s;
}

function code(n, indent) {
  const file = fileOf(n);
  if (!file || !n.target) return [];
  const lines = readLines(root, file);
  if (!lines) return [`${indent}  (file missing)`];
  const r = checkAnchor(root, file, n);
  const shift = r.status === 'drift' ? r.line - n.target.start : 0;
  const s = Math.max(1, n.target.start + shift - ctx);
  const e = Math.min(lines.length, n.target.end + shift + ctx, s + max - 1);
  const out = [];
  for (let i = s; i <= e; i++) {
    const mark = i >= n.target.start + shift && i <= n.target.end + shift ? '>' : ' ';
    out.push(`${indent}  ${mark}${String(i).padStart(5)}| ${lines[i - 1]}`);
  }
  if (e < n.target.end + shift) out.push(`${indent}  … (truncated, --max ${max})`);
  return out;
}

function edgeLine(e, from) {
  const other = (id) => {
    const n = byId.get(id);
    return n ? `${id}(${n.type}${n.type === 'file' ? ` ${n.file}` : ''})` : `${id}(MISSING)`;
  };
  const style = [e.dash && e.dash !== 'solid' ? e.dash : '', e.endMarker === 'none' ? 'no-arrow' : '', e.color ?? '']
    .filter(Boolean).join(',');
  const label = e.label ? ` ${q(e.label, 50)}` : '';
  if (from === undefined) return `${e.id}: ${e.source} -> ${e.target}${label}${style ? ` [${style}]` : ''}`;
  return from
    ? `  out ${e.id} -> ${other(e.target)}${label}${style ? ` [${style}]` : ''}`
    : `  in  ${e.id} <- ${other(e.source)}${label}${style ? ` [${style}]` : ''}`;
}

const out = [];
const nodeId = opts.node ?? ref?.id;

if (nodeId) {
  const n = byId.get(nodeId);
  if (!n) {
    out.push(`Node "${nodeId}" not found in ${rel(wsPath)}.`);
    const needle = nodeId.toLowerCase().replace(/^[a-z]_/, '');
    const near = ws.nodes.filter((m) =>
      [m.id, m.title, m.annotation, m.text, m.file, m.folder].some((v) => v && String(v).toLowerCase().includes(needle)));
    if (near.length) out.push('Closest candidates:', ...near.slice(0, 8).map((m) => `  ${line(m)}`));
  } else {
    if (ref && ref.type !== n.type) out.push(`Note: reference says ${ref.type}, node is ${n.type} (trusting the id).`);
    const chain = [];
    for (let p = n.parent && byId.get(n.parent); p; p = p.parent && byId.get(p.parent)) chain.unshift(line(p));
    if (chain.length) out.push('Inside:', ...chain.map((c, i) => `${'  '.repeat(i + 1)}${c}`));
    out.push(`Item: ${line(n)}`);
    const kids = children.get(n.id) ?? [];
    for (const k of kids) out.push(`  child ${line(k)}`);
    const ids = new Set([n.id, ...kids.map((k) => k.id)]);
    if (n.type === 'editor') ids.add(n.parent);
    const es = ws.edges.filter((e) => ids.has(e.source) || ids.has(e.target));
    if (es.length) out.push('Edges:', ...es.map((e) => edgeLine(e, ids.has(e.source))));
    const editors = n.type === 'editor' ? [n] : n.type === 'file' ? kids : [];
    for (const ed of editors) {
      out.push(`Code ${fileOf(ed)} (${ed.id}):`, ...code(ed, ''));
    }
  }
} else {
  const counts = {};
  for (const n of ws.nodes) counts[n.type] = (counts[n.type] ?? 0) + 1;
  out.push(`Workspace ${rel(wsPath)} · root ${rel(root)}`);
  out.push(`${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')} · ${ws.edges.length} edges` +
    (ws.tagPlacement ? ` · tagPlacement=${ws.tagPlacement}` : '') + (ws.showTags === false ? ' · tags hidden' : ''));
  if (ws.tags.length) {
    const used = new Map();
    for (const n of ws.nodes) for (const t of n.tags ?? []) used.set(t, (used.get(t) ?? 0) + 1);
    out.push('Tags:', ...ws.tags.map((t) => `  ${t.id} ${q(t.label, 40)} ${t.color ?? ''} ×${used.get(t.id) ?? 0}`));
  }
  if (prot.size) out.push(`Protected: ${[...prot].join(', ')}`);
  out.push('Nodes (positions relative to parent):');
  const walk = (n, depth) => {
    const ind = '  '.repeat(depth + 1);
    out.push(`${ind}${line(n)}`);
    if (opts.code && n.type === 'editor') out.push(...code(n, ind));
    for (const c of children.get(n.id) ?? []) walk(c, depth + 1);
  };
  for (const n of ws.nodes) if (!n.parent || !byId.has(n.parent)) walk(n, 0);
  if (ws.edges.length) out.push('Edges:', ...ws.edges.map((e) => `  ${edgeLine(e)}`));
}

console.log(out.join('\n'));
