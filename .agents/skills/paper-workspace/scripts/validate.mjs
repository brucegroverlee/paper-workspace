#!/usr/bin/env node
// Checks a .workspace file against the format rules, so an agent doesn't have to verify them by hand.
//
//   node validate.mjs <workspace>
//   node validate.mjs <workspace> --original <copy of the file before editing>   + protected items / lost ids
//   node validate.mjs <workspace> --protect "Label A,Label B"                     extra protection tag labels
//
// Prints ERROR lines (must fix) and WARN lines (check, fix if it's a mistake). Exit code 1 when there are errors.
import fs from 'node:fs';
import path from 'node:path';
import { parseTarget, loadWorkspace, index, readLines, exists, checkAnchor, protectedIds, args } from './lib.mjs';

const SHAPES = new Set(`rectangle rounded square ellipse circle diamond parallelogram hexagon triangle triangle-right
pentagon octagon star plus trapezoid cylinder cloud document multi-document note-shape card callout callout-rounded
cube tape actor terminator predefined-process internal-storage manual-input manual-operation delay stored-data display
loop-limit off-page connector merge sort collate or summing-junction annotation arrow-right arrow-left arrow-up
arrow-down arrow-double arrow-double-vertical chevron pentagon-arrow`.split(/\s+/));
const BOX_TYPES = new Set(['file', 'folder', 'group', 'shape', 'note', 'text', 'media']);
const CONTAINERS = new Set(['group', 'folder']);
const TAGGABLE = new Set(['file', 'editor', 'folder']);
const HEX = /^#[0-9a-fA-F]{6}$/;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z0-9]+$/i;

const { pos, opts } = args(process.argv.slice(2));
const { wsPath, root } = parseTarget(pos[0]);
const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

let ws;
try {
  ws = loadWorkspace(wsPath);
} catch (e) {
  console.log(`ERROR cannot read/parse ${path.relative(process.cwd(), wsPath)}: ${e.message}`);
  process.exit(1);
}
if (ws.version !== 2) err(`version is ${ws.version}, expected 2`);
if (!Array.isArray(ws.nodes) || !Array.isArray(ws.edges)) err('nodes and edges must be arrays');

const { byId, children, tagById } = index(ws);
const at = new Map(ws.nodes.map((n, i) => [n.id, i]));

// ids
const seen = new Set();
for (const n of ws.nodes) {
  if (!n.id) err(`node without id: ${JSON.stringify(n).slice(0, 80)}`);
  else if (seen.has(n.id)) err(`duplicate node id ${n.id}`);
  seen.add(n.id);
}
const seenE = new Set();
for (const e of ws.edges) {
  if (seenE.has(e.id)) err(`duplicate edge id ${e.id}`);
  seenE.add(e.id);
}

// parents, order, cycles
for (const n of ws.nodes) {
  if (n.type === 'editor' && !n.parent) err(`editor ${n.id} has no parent file`);
  if (!n.parent) continue;
  const p = byId.get(n.parent);
  if (!p) { err(`${n.id}: parent ${n.parent} does not exist`); continue; }
  if (at.get(p.id) > at.get(n.id)) err(`${n.id}: comes before its parent ${p.id} in nodes (parents must come first)`);
  if (n.type === 'editor' && p.type !== 'file') err(`editor ${n.id}: parent ${p.id} is a ${p.type}, must be a file`);
  if (n.type !== 'editor' && !CONTAINERS.has(p.type)) err(`${n.type} ${n.id}: parent ${p.id} is a ${p.type}, must be a group or folder`);
  const chain = new Set([n.id]);
  for (let c = p; c; c = c.parent && byId.get(c.parent)) {
    if (chain.has(c.id)) { err(`${n.id}: parent cycle through ${c.id}`); break; }
    chain.add(c.id);
  }
}

// sizes, colors
const color = (n, field, allowNone = false) => {
  const v = n[field];
  if (v === undefined) return;
  if (!(HEX.test(v) || (allowNone && v === 'none'))) err(`${n.id}: ${field} "${v}" is not #rrggbb${allowNone ? ' or "none"' : ''}`);
};
for (const n of ws.nodes) {
  for (const k of ['width', 'height']) {
    if (typeof n[k] !== 'number' || n[k] < 20 || n[k] > 2000) err(`${n.id}: ${k} ${n[k]} outside 20–2000`);
  }
  if (!n.position || typeof n.position.x !== 'number' || typeof n.position.y !== 'number') err(`${n.id}: missing position`);
  color(n, 'color', n.type === 'shape');
  for (const f of ['headerColor', 'textColor', 'strokeColor']) color(n, f);
  if (n.type === 'shape' && n.shape && !SHAPES.has(n.shape)) warn(`${n.id}: unknown shape "${n.shape}" (renders as rectangle)`);
  if (n.tags?.length && !TAGGABLE.has(n.type)) warn(`${n.id}: ${n.type} nodes can't carry tags (ignored)`);
  for (const t of n.tags ?? []) if (!tagById.has(t)) err(`${n.id}: tag ${t} is not defined in tags`);
}

// files, editors, folders
const filePaths = new Map();
const folderPaths = new Map();
for (const n of ws.nodes) {
  if (n.type === 'file') {
    if (filePaths.has(n.file)) err(`path ${n.file} is in two file nodes: ${filePaths.get(n.file)} and ${n.id}`);
    filePaths.set(n.file, n.id);
    if (!exists(root, n.file, 'file')) err(`${n.id}: file ${n.file} does not exist`);
    const eds = (children.get(n.id) ?? []).filter((c) => c.type === 'editor');
    if (!eds.length) err(`${n.id}: file node has no editor`);
    if (eds.length === 1) {
      const e = eds[0];
      if (e.position?.x !== 0 || e.position?.y !== 40 || e.width !== n.width || e.height !== n.height - 40) {
        err(`${e.id}: single editor must be at {0,40}, ${n.width}x${n.height - 40} (file ${n.width}x${n.height})`);
      }
      if (e.tags?.length && !n.tags?.length) warn(`${e.id}: tags on the only editor are not shown; put them on ${n.id}`);
    } else if (eds.length > 1) {
      for (const e of eds) {
        const right = e.position.x + e.width + 12;
        const bottom = e.position.y + e.height + (e.annotation !== undefined ? 30 : 0) + 12;
        if (right > n.width || bottom > n.height) err(`${e.id}: doesn't fit in ${n.id} (needs ${right}x${bottom}, file is ${n.width}x${n.height})`);
      }
    }
    const p = n.parent && byId.get(n.parent);
    if (p?.type === 'folder' && p.folder && !n.file.startsWith(`${p.folder}/`)) warn(`${n.id}: ${n.file} is not under its folder ${p.folder}/`);
  }
  if (n.type === 'editor') {
    const f = byId.get(n.parent);
    if (!f?.file) continue;
    const r = checkAnchor(root, f.file, n);
    if (r.status === 'out-of-range') err(`${n.id}: target ${n.target.start}-${n.target.end} outside ${f.file} (${r.count} lines)`);
    if (r.status === 'no-anchor') err(`${n.id}: target set but no anchor`);
    if (r.status === 'drift') err(`${n.id}: anchor is at line ${r.line}, not ${n.target.start} (shift the target)`);
    if (r.status === 'lost') err(`${n.id}: anchor text not found in ${f.file}`);
    if (r.status === 'ok' || r.status === 'drift') {
      const line = readLines(root, f.file)[(r.line ?? n.target.start) - 1];
      if (line.trim() !== n.anchor) warn(`${n.id}: anchor has surrounding whitespace; use the trimmed line`);
    }
  }
  if (n.type === 'folder') {
    if (folderPaths.has(n.folder)) err(`directory "${n.folder}" is in two folder nodes: ${folderPaths.get(n.folder)} and ${n.id}`);
    folderPaths.set(n.folder, n.id);
    if (n.folder && !exists(root, n.folder, 'dir')) err(`${n.id}: folder ${n.folder} is not a directory`);
  }
  if (n.type === 'media' && n.src && !exists(root, n.src, 'file')) err(`${n.id}: media ${n.src} does not exist`);
}

// containers: fit, location-vs-meaning, tests
const filesUnder = (id) => {
  const out = [];
  for (const c of children.get(id) ?? []) {
    if (c.type === 'file') out.push(c.file);
    if (CONTAINERS.has(c.type)) out.push(...filesUnder(c.id));
  }
  return out;
};
for (const n of ws.nodes) {
  if (!CONTAINERS.has(n.type)) continue;
  const pad = 16;
  for (const c of children.get(n.id) ?? []) {
    const top = n.type === 'folder' ? 40 : 0;
    const right = c.position.x + c.width + pad;
    const bottom = c.position.y + c.height + (c.annotation !== undefined ? 30 : 0) + pad;
    if (c.position.x < 0 || c.position.y < top) warn(`${c.id}: starts outside ${n.id}'s content area`);
    if (right > n.width || bottom > n.height) err(`${c.id}: doesn't fit in ${n.id} (needs ${right}x${bottom}, is ${n.width}x${n.height})`);
  }
  const files = filesUnder(n.id);
  if (n.type === 'group') {
    const dirs = new Set(files.map((f) => path.posix.dirname(f)));
    if (files.length > 1 && dirs.size === 1) warn(`group ${n.id} "${n.title}" holds only files of ${[...dirs][0]}/ — make it a folder`);
    if (n.title && exists(root, n.title, 'dir')) warn(`group ${n.id} is titled like the directory "${n.title}" — make it a folder`);
  }
  if (files.length && files.every((f) => TEST_PATH.test(f))) warn(`${n.id} holds only test files — put each test next to its subject instead`);
}

// overlaps between siblings (top-level boxes and boxes in the same container)
const box = (n) => ({ x: n.position.x, y: n.position.y, r: n.position.x + n.width, b: n.position.y + n.height + (n.annotation !== undefined ? 30 : 0) });
const siblings = new Map();
for (const n of ws.nodes) {
  if (n.type === 'editor' || !BOX_TYPES.has(n.type) || !n.position) continue;
  const k = n.parent ?? '';
  if (!siblings.has(k)) siblings.set(k, []);
  siblings.get(k).push(n);
}
for (const list of siblings.values()) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = box(list[i]);
      const b = box(list[j]);
      if (a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b) warn(`${list[i].id} and ${list[j].id} overlap`);
    }
  }
}

// tags
const labels = new Map();
const used = new Set(ws.nodes.flatMap((n) => n.tags ?? []));
for (const t of ws.tags) {
  const k = String(t.label ?? '').toLowerCase();
  if (labels.has(k)) err(`tag label "${t.label}" defined twice (${labels.get(k)}, ${t.id})`);
  labels.set(k, t.id);
  if ((t.label ?? '').length > 40) err(`tag ${t.id}: label longer than 40 characters`);
  if (t.color !== undefined && !HEX.test(t.color)) err(`tag ${t.id}: color "${t.color}" is not #rrggbb`);
  if (!used.has(t.id)) warn(`tag ${t.id} "${t.label}" is defined but unused`);
}

// edges
for (const e of ws.edges) {
  if (!byId.has(e.source)) err(`edge ${e.id}: source ${e.source} does not exist`);
  if (!byId.has(e.target)) err(`edge ${e.id}: target ${e.target} does not exist`);
  for (const f of ['color', 'labelColor']) if (e[f] !== undefined && !HEX.test(e[f])) err(`edge ${e.id}: ${f} "${e[f]}" is not #rrggbb`);
  if (e.labelBackground !== undefined && !(HEX.test(e.labelBackground) || e.labelBackground === 'none')) err(`edge ${e.id}: bad labelBackground`);
  if (e.points !== undefined && !(Array.isArray(e.points) && e.points.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))))
    err(`edge ${e.id}: points must be an array of { x, y } numbers`);
  if (e.labelAt !== undefined && !(Number.isFinite(e.labelAt) && e.labelAt >= 0 && e.labelAt <= 1)) err(`edge ${e.id}: labelAt must be a number from 0 to 1`);
  if (e.labelOffset !== undefined && !(Number.isFinite(e.labelOffset?.x) && Number.isFinite(e.labelOffset?.y))) err(`edge ${e.id}: labelOffset must be { x, y } numbers`);
}

// against the original (edits in place)
if (opts.original) {
  const orig = JSON.parse(fs.readFileSync(path.resolve(opts.original), 'utf8'));
  orig.nodes ??= [];
  orig.edges ??= [];
  orig.tags ??= [];
  const extra = typeof opts.protect === 'string' ? opts.protect.split(',').map((s) => s.trim()) : [];
  const prot = protectedIds(orig, extra);
  const protOrder = (list) => list.filter((n) => prot.has(n.id)).map((n) => n.id).join(',');
  for (const n of orig.nodes) {
    const now = byId.get(n.id);
    if (!now) { (prot.has(n.id) ? err : warn)(`node ${n.id} (${n.type}) was removed${prot.has(n.id) ? ' but is PROTECTED' : ' — only OK if the user approved'}`); continue; }
    if (prot.has(n.id) && JSON.stringify(now) !== JSON.stringify(n)) err(`protected node ${n.id} was changed`);
  }
  if (protOrder(orig.nodes) !== protOrder(ws.nodes)) warn('protected nodes changed relative order in nodes');
  for (const n of ws.nodes) if (n.parent && prot.has(n.parent) && !orig.nodes.some((o) => o.id === n.id)) err(`new node ${n.id} was put inside protected ${n.parent}`);
  for (const e of orig.edges) if (!seenE.has(e.id)) warn(`edge ${e.id} was removed — only OK if you created it or the user approved`);
  for (const t of orig.tags) if (!tagById.has(t.id) && used.has(t.id)) err(`tag ${t.id} was removed but is still used`);
}

for (const m of errors) console.log(`ERROR ${m}`);
for (const m of warns) console.log(`WARN  ${m}`);
console.log(`${errors.length ? 'FAILED' : 'OK'}: ${errors.length} error(s), ${warns.length} warning(s) · ${ws.nodes.length} nodes, ${ws.edges.length} edges`);
process.exit(errors.length ? 1 : 0);
