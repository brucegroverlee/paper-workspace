// A link's path through its bend points (dragged out of the line, like draw.io's waypoints): straight lines join
// them, curves pass through them smoothly, and elbows reach each one with right angles.
import type { EdgePath, XY } from '../shared/workspace';

/** The SVG path, where the label sits, and the middle of each stretch between two consecutive points of the route. */
export interface Route {
  path: string;
  label: XY;
  /** `mids[i]` lies between point i - 1 (or the start) and point i (or the end): pulling it out adds point i. */
  mids: XY[];
}

/** How far an elbow runs straight out of (and into) a node before it may turn. */
const STUB = 20;

const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: XY, d: XY, k = 1): XY => ({ x: a.x + d.x * k, y: a.y + d.y * k });
const dot = (a: XY, b: XY) => a.x * b.x + a.y * b.y;
const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: XY, b: XY) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
const fmt = (p: XY) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`;

/**
 * Route from `s` (leaving along `sOut`, the outward direction of its side) to `t` (entering against `tOut`) through
 * `points`. `radius` rounds elbow corners.
 */
export function routeLink(kind: EdgePath, s: XY, sOut: XY, t: XY, tOut: XY, points: XY[], radius = 0): Route {
  if (kind === 'curve') {
    const beziers = curve(s, sOut, t, tOut, points);
    return measure(beziers.map(sample), curvePath(beziers));
  }
  const { line, anchors } =
    kind === 'straight' ? { line: [s, ...points, t], anchors: [0, ...points.map((_, i) => i + 1), points.length + 1] } : orthogonal(s, sOut, t, tOut, points);
  const legs = anchors.slice(1).map((end, i) => line.slice(anchors[i], end + 1));
  return measure(legs, polylinePath(line, kind === 'rounded' ? radius : 0));
}

// ---- elbows -------------------------------------------------------------------------------------------

/**
 * Right-angled polyline through the points: each stretch keeps going the way the line was heading and then turns
 * (or turns first, rather than doubling back). `anchors` are the indices of the start, each point and the end.
 */
export function orthogonal(s: XY, sOut: XY, t: XY, tOut: XY, points: XY[]) {
  const line: XY[] = [s];
  const anchors = [0];
  let cur = s;
  let dir = sOut;
  const go = (p: XY) => {
    if (same(p, cur)) return;
    const d = sub(p, cur);
    const len = Math.hypot(d.x, d.y);
    dir = { x: d.x / len, y: d.y / len };
    line.push(p);
    cur = p;
  };
  const horizontal = (d: XY) => Math.abs(d.x) > Math.abs(d.y);

  // Leave the node before turning back or sideways, so the line doesn't run along its border.
  if (points.length && dot(sub(points[0], s), sOut) < STUB) go(add(s, sOut, STUB));
  for (const p of points) {
    const ahead = dot(sub(p, cur), dir) >= 0;
    const horizontalFirst = horizontal(dir) === ahead;
    go(horizontalFirst ? { x: p.x, y: cur.y } : { x: cur.x, y: p.y });
    go(p);
    anchors.push(line.length - 1);
  }

  // Arrive straight into the target: reach a point just outside it, last stretch heading into it.
  const into = { x: -tOut.x, y: -tOut.y };
  const e = add(t, tOut, STUB);
  const corner = horizontal(into) ? { x: cur.x, y: e.y } : { x: e.x, y: cur.y };
  if (dot(sub(corner, cur), dir) < -0.01) {
    // Turning there would double back over the last stretch: step across halfway instead.
    const mid = horizontal(into) ? { x: (cur.x + e.x) / 2, y: cur.y } : { x: cur.x, y: (cur.y + e.y) / 2 };
    go(mid);
    go(horizontal(into) ? { x: mid.x, y: e.y } : { x: e.x, y: mid.y });
  } else go(corner);
  go(e);
  go(t);
  anchors.push(line.length - 1);
  return { line, anchors };
}

/** Polyline path; corners rounded by up to `radius` (less on short stretches), straight-through points dropped. */
function polylinePath(line: XY[], radius: number) {
  const pts: XY[] = [];
  for (const p of line) if (!pts.length || !same(p, pts[pts.length - 1])) pts.push(p);
  const kept = pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = sub(p, pts[i - 1]);
    const b = sub(pts[i + 1], p);
    return Math.abs(a.x * b.y - a.y * b.x) > 0.01 || dot(a, b) < 0;
  });
  let d = `M${fmt(kept[0])}`;
  for (let i = 1; i < kept.length - 1; i++) {
    const [a, p, b] = [kept[i - 1], kept[i], kept[i + 1]];
    const r = Math.min(radius, dist(a, p) / 2, dist(p, b) / 2);
    if (r <= 0.5) {
      d += ` L${fmt(p)}`;
      continue;
    }
    d += ` L${fmt(add(p, sub(a, p), r / dist(a, p)))} Q${fmt(p)} ${fmt(add(p, sub(b, p), r / dist(p, b)))}`;
  }
  return `${d} L${fmt(kept[kept.length - 1])}`;
}

// ---- curves -------------------------------------------------------------------------------------------

type Bezier = [XY, XY, XY, XY];

/** Smooth curve through the points (Catmull-Rom), leaving and entering the nodes square to their sides. */
function curve(s: XY, sOut: XY, t: XY, tOut: XY, points: XY[]) {
  const p = [s, ...points, t];
  const n = p.length - 1;
  const tangent = (i: number): XY => {
    if (i === 0) return add({ x: 0, y: 0 }, sOut, dist(p[0], p[1]) * 1.2);
    if (i === n) return add({ x: 0, y: 0 }, tOut, -dist(p[n - 1], p[n]) * 1.2);
    return add({ x: 0, y: 0 }, sub(p[i + 1], p[i - 1]), 0.5);
  };
  const beziers: Bezier[] = [];
  for (let i = 0; i < n; i++) beziers.push([p[i], add(p[i], tangent(i), 1 / 3), add(p[i + 1], tangent(i + 1), -1 / 3), p[i + 1]]);
  return beziers;
}

function at(b: Bezier, u: number): XY {
  const v = 1 - u;
  const [k0, k1, k2, k3] = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
  return { x: k0 * b[0].x + k1 * b[1].x + k2 * b[2].x + k3 * b[3].x, y: k0 * b[0].y + k1 * b[1].y + k2 * b[2].y + k3 * b[3].y };
}

function sample(b: Bezier): XY[] {
  return Array.from({ length: 25 }, (_, i) => at(b, i / 24));
}

function curvePath(beziers: Bezier[]) {
  return `M${fmt(beziers[0][0])}` + beziers.map((b) => ` C${fmt(b[1])} ${fmt(b[2])} ${fmt(b[3])}`).join('');
}

// ---- measuring ----------------------------------------------------------------------------------------

/** The point halfway along a polyline. */
function halfway(line: XY[]): XY {
  const total = line.slice(1).reduce((sum, p, i) => sum + dist(line[i], p), 0);
  let left = total / 2;
  for (let i = 1; i < line.length; i++) {
    const len = dist(line[i - 1], line[i]);
    if (len >= left && len > 0) return add(line[i - 1], sub(line[i], line[i - 1]), left / len);
    left -= len;
  }
  return line[line.length - 1];
}

/** `legs` = the route between consecutive points, as polylines. */
function measure(legs: XY[][], path: string): Route {
  const whole = legs.flatMap((leg, i) => (i ? leg.slice(1) : leg));
  return { path, label: halfway(whole), mids: legs.map(halfway) };
}

/** A path as points evenly spaced along its length (first = start, last = end), and that length. */
export interface PathSamples {
  pts: XY[];
  total: number;
}

/** The point `at` (0 = start, 1 = end) of the way along a sampled path. */
export function pointAt(line: PathSamples, at: number): XY {
  const n = line.pts.length - 1;
  const f = Math.min(1, Math.max(0, at)) * n;
  const i = Math.min(n - 1, Math.floor(f));
  return n < 1 ? line.pts[0] : add(line.pts[i], sub(line.pts[i + 1], line.pts[i]), f - i);
}

/** The point of a sampled path closest to `p`, and how far along the path it is (0–1). */
export function nearestOnPath(line: PathSamples, p: XY): { at: number; point: XY } {
  const n = line.pts.length - 1;
  let best = { at: 0.5, point: line.pts[0], gap: Infinity };
  for (let i = 0; i < n; i++) {
    const a = line.pts[i];
    const d = sub(line.pts[i + 1], a);
    const len2 = dot(d, d);
    const u = len2 ? Math.min(1, Math.max(0, dot(sub(p, a), d) / len2)) : 0;
    const q = add(a, d, u);
    const gap = dist(p, q);
    if (gap < best.gap) best = { at: (i + u) / n, point: q, gap };
  }
  return { at: best.at, point: best.point };
}

/** Snap `p` onto the x or y of a neighbor within `tolerance`, so lines between them come out straight. */
export function snapPoint(p: XY, neighbors: XY[], tolerance: number): XY {
  const pick = (v: number, key: 'x' | 'y') => {
    let best = v;
    let gap = tolerance;
    for (const n of neighbors) {
      if (Math.abs(n[key] - v) <= gap) {
        gap = Math.abs(n[key] - v);
        best = n[key];
      }
    }
    return best;
  };
  return { x: pick(p.x, 'x'), y: pick(p.y, 'y') };
}
