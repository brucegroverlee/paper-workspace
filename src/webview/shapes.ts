// Shape library for diagram nodes: geometry as SVG path data computed for the node's pixel size, so outlines keep
// their width and corners keep their radius when a shape is resized. Pure (no DOM) so it can be unit tested.

export interface ShapePart {
  d: string;
  /** Filled with the shape's fill (and occludes parts drawn before it); otherwise an outline only. */
  fill: boolean;
}

export interface ShapeDef {
  id: string;
  label: string;
  /** Default size of a new shape. */
  size: { width: number; height: number };
  parts(w: number, h: number): ShapePart[];
  /** Where the label goes, in px (default: the whole shape). */
  textBox?(w: number, h: number): { x: number; y: number; width: number; height: number };
  /** Drawn mostly with lines over the canvas: the default outline follows the canvas, not the fill. */
  outline?: boolean;
  /** Label under the shape instead of inside it (stick figure). */
  labelBelow?: boolean;
}

type P = [number, number];

const r1 = (v: number) => Math.round(v * 10) / 10;
const pt = ([x, y]: P) => `${r1(x)} ${r1(y)}`;
const poly = (...ps: P[]) => `M${ps.map(pt).join('L')}Z`;
const rect = (x: number, y: number, w: number, h: number) => poly([x, y], [x + w, y], [x + w, y + h], [x, y + h]);
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${pt([cx - rx, cy])}A${r1(rx)} ${r1(ry)} 0 1 0 ${pt([cx + rx, cy])}A${r1(rx)} ${r1(ry)} 0 1 0 ${pt([cx - rx, cy])}Z`;
const filled = (d: string): ShapePart => ({ d, fill: true });
const line = (d: string): ShapePart => ({ d, fill: false });
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width: Math.max(0, width), height: Math.max(0, height) });

function roundedRect(w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  return `M${pt([r, 0])}H${r1(w - r)}A${r1(r)} ${r1(r)} 0 0 1 ${pt([w, r])}V${r1(h - r)}A${r1(r)} ${r1(r)} 0 0 1 ${pt([w - r, h])}H${r1(r)}A${r1(r)} ${r1(r)} 0 0 1 ${pt([0, h - r])}V${r1(r)}A${r1(r)} ${r1(r)} 0 0 1 ${pt([r, 0])}Z`;
}

/** Wavy-bottomed page (flowchart "document"). */
function documentPath(x: number, y: number, w: number, h: number) {
  const b = y + h * 0.85;
  return `M${pt([x, y])}H${r1(x + w)}V${r1(b)}C${pt([x + w * 0.75, y + h * 0.68])} ${pt([x + w * 0.25, y + h * 1.02])} ${pt([x, b])}Z`;
}

/** Block arrow along an axis; `dir` is where the (first) head points. `double` adds a head at the other end. */
function blockArrow(w: number, h: number, dir: 'right' | 'left' | 'up' | 'down', double = false): string {
  const horizontal = dir === 'right' || dir === 'left';
  const len = horizontal ? w : h; // along the arrow
  const thick = horizontal ? h : w; // across
  const head = Math.min(len * (double ? 0.3 : 0.4), thick * 0.8);
  const s0 = thick * 0.25;
  const s1 = thick * 0.75;
  // Pointing towards +along, in (along, across) coordinates.
  const ps: P[] = double
    ? [[0, thick / 2], [head, 0], [head, s0], [len - head, s0], [len - head, 0], [len, thick / 2], [len - head, thick], [len - head, s1], [head, s1], [head, thick]]
    : [[0, s0], [len - head, s0], [len - head, 0], [len, thick / 2], [len - head, thick], [len - head, s1], [0, s1]];
  const map = ([a, c]: P): P => {
    switch (dir) {
      case 'right':
        return [a, c];
      case 'left':
        return [len - a, c];
      case 'down':
        return [c, a];
      case 'up':
        return [c, len - a];
    }
  };
  return poly(...ps.map(map));
}

function starPath(w: number, h: number, points = 5, inner = 0.45) {
  const ps: P[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const k = i % 2 ? inner : 1;
    ps.push([w / 2 + (Math.cos(a) * k * w) / 2, h / 2 + (Math.sin(a) * k * h) / 2 + h * 0.05]);
  }
  return poly(...ps);
}

function regular(w: number, h: number, sides: number, rotate = -Math.PI / 2) {
  const ps: P[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotate + (i * 2 * Math.PI) / sides;
    ps.push([w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2]);
  }
  return poly(...ps);
}

const inset = (w: number, h: number, fx: number, fy: number) => box(w * fx, h * fy, w * (1 - 2 * fx), h * (1 - 2 * fy));

const DEFS: ShapeDef[] = [
  // ---- basic ----
  { id: 'rectangle', label: 'Rectangle / Process', size: { width: 160, height: 80 }, parts: (w, h) => [filled(rect(0, 0, w, h))] },
  { id: 'rounded', label: 'Rounded rectangle', size: { width: 160, height: 80 }, parts: (w, h) => [filled(roundedRect(w, h, Math.min(12, w / 6, h / 6)))] },
  { id: 'square', label: 'Square', size: { width: 90, height: 90 }, parts: (w, h) => [filled(rect(0, 0, w, h))] },
  { id: 'ellipse', label: 'Ellipse', size: { width: 160, height: 90 }, parts: (w, h) => [filled(ellipse(w / 2, h / 2, w / 2, h / 2))], textBox: (w, h) => inset(w, h, 0.15, 0.15) },
  { id: 'circle', label: 'Circle', size: { width: 90, height: 90 }, parts: (w, h) => [filled(ellipse(w / 2, h / 2, w / 2, h / 2))], textBox: (w, h) => inset(w, h, 0.15, 0.15) },
  {
    id: 'diamond',
    label: 'Diamond / Decision',
    size: { width: 140, height: 100 },
    parts: (w, h) => [filled(poly([w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]))],
    textBox: (w, h) => inset(w, h, 0.22, 0.22),
  },
  {
    id: 'parallelogram',
    label: 'Parallelogram / Data',
    size: { width: 160, height: 80 },
    parts: (w, h) => {
      const o = Math.min(w * 0.2, h * 0.6);
      return [filled(poly([o, 0], [w, 0], [w - o, h], [0, h]))];
    },
    textBox: (w, h) => box(Math.min(w * 0.2, h * 0.6), 0, w - 2 * Math.min(w * 0.2, h * 0.6), h),
  },
  {
    id: 'hexagon',
    label: 'Hexagon / Preparation',
    size: { width: 160, height: 80 },
    parts: (w, h) => {
      const o = Math.min(w * 0.25, h * 0.5);
      return [filled(poly([o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]))];
    },
    textBox: (w, h) => box(Math.min(w * 0.25, h * 0.5), 0, w - 2 * Math.min(w * 0.25, h * 0.5), h),
  },
  { id: 'triangle', label: 'Triangle / Extract', size: { width: 100, height: 90 }, parts: (w, h) => [filled(poly([w / 2, 0], [w, h], [0, h]))], textBox: (w, h) => box(w * 0.25, h * 0.45, w * 0.5, h * 0.55) },
  { id: 'triangle-right', label: 'Triangle', size: { width: 90, height: 100 }, parts: (w, h) => [filled(poly([0, 0], [w, h / 2], [0, h]))], textBox: (w, h) => box(0, h * 0.25, w * 0.55, h * 0.5) },
  { id: 'pentagon', label: 'Pentagon', size: { width: 100, height: 100 }, parts: (w, h) => [filled(regular(w, h, 5))], textBox: (w, h) => inset(w, h, 0.2, 0.2) },
  { id: 'octagon', label: 'Octagon', size: { width: 100, height: 100 }, parts: (w, h) => [filled(regular(w, h, 8, -Math.PI / 2 + Math.PI / 8))], textBox: (w, h) => inset(w, h, 0.15, 0.15) },
  { id: 'star', label: 'Star', size: { width: 100, height: 100 }, parts: (w, h) => [filled(starPath(w, h))], textBox: (w, h) => inset(w, h, 0.3, 0.32) },
  {
    id: 'plus',
    label: 'Cross',
    size: { width: 90, height: 90 },
    parts: (w, h) => {
      const a = w / 3;
      const b = h / 3;
      return [filled(poly([a, 0], [2 * a, 0], [2 * a, b], [w, b], [w, 2 * b], [2 * a, 2 * b], [2 * a, h], [a, h], [a, 2 * b], [0, 2 * b], [0, b], [a, b]))];
    },
    textBox: (w, h) => inset(w, h, 1 / 3, 1 / 3),
  },
  {
    id: 'cylinder',
    label: 'Cylinder / Database',
    size: { width: 90, height: 110 },
    parts: (w, h) => {
      const rx = w / 2;
      const ry = Math.min(h * 0.15, 16);
      return [
        filled(`M0 ${r1(ry)}A${r1(rx)} ${r1(ry)} 0 0 1 ${pt([w, ry])}V${r1(h - ry)}A${r1(rx)} ${r1(ry)} 0 0 1 ${pt([0, h - ry])}Z`),
        line(`M0 ${r1(ry)}A${r1(rx)} ${r1(ry)} 0 0 0 ${pt([w, ry])}`),
      ];
    },
    textBox: (w, h) => box(0, Math.min(h * 0.15, 16) * 2, w, h - Math.min(h * 0.15, 16) * 3),
  },
  {
    id: 'cloud',
    label: 'Cloud',
    size: { width: 160, height: 100 },
    parts: (w, h) => {
      const s = (x: number, y: number): string => pt([(x / 100) * w, (y / 100) * h]);
      return [
        filled(
          `M${s(25, 85)}C${s(4, 85)} ${s(0, 55)} ${s(20, 50)}C${s(14, 24)} ${s(42, 12)} ${s(54, 28)}C${s(62, 6)} ${s(92, 12)} ${s(88, 40)}C${s(102, 44)} ${s(104, 85)} ${s(80, 85)}Z`,
        ),
      ];
    },
    textBox: (w, h) => box(w * 0.18, h * 0.35, w * 0.66, h * 0.45),
  },
  {
    id: 'document',
    label: 'Document',
    size: { width: 140, height: 90 },
    parts: (w, h) => [filled(documentPath(0, 0, w, h))],
    textBox: (w, h) => box(0, 0, w, h * 0.82),
  },
  {
    id: 'multi-document',
    label: 'Multiple documents',
    size: { width: 150, height: 100 },
    parts: (w, h) => {
      const o = Math.min(8, w * 0.06, h * 0.08);
      return [filled(documentPath(2 * o, 0, w - 2 * o, h - 2 * o)), filled(documentPath(o, o, w - 2 * o, h - 2 * o)), filled(documentPath(0, 2 * o, w - 2 * o, h - 2 * o))];
    },
    textBox: (w, h) => box(0, Math.min(16, h * 0.16), w * 0.92, h * 0.66),
  },
  {
    id: 'note-shape',
    label: 'Note (folded corner)',
    size: { width: 120, height: 100 },
    parts: (w, h) => {
      const f = Math.min(18, w * 0.25, h * 0.25);
      return [filled(poly([0, 0], [w - f, 0], [w, f], [w, h], [0, h])), line(`M${pt([w - f, 0])}V${r1(f)}H${r1(w)}`)];
    },
  },
  {
    id: 'card',
    label: 'Card',
    size: { width: 120, height: 90 },
    parts: (w, h) => {
      const c = Math.min(20, w * 0.25, h * 0.3);
      return [filled(poly([c, 0], [w, 0], [w, h], [0, h], [0, c]))];
    },
  },
  {
    id: 'callout',
    label: 'Callout',
    size: { width: 150, height: 100 },
    parts: (w, h) => [filled(poly([0, 0], [w, 0], [w, h * 0.72], [w * 0.45, h * 0.72], [w * 0.22, h], [w * 0.25, h * 0.72], [0, h * 0.72]))],
    textBox: (w, h) => box(0, 0, w, h * 0.72),
  },
  {
    id: 'callout-rounded',
    label: 'Speech bubble',
    size: { width: 150, height: 100 },
    parts: (w, h) => {
      const b = h * 0.72;
      const r = Math.min(12, w / 6, b / 4);
      return [
        filled(
          `M${pt([r, 0])}H${r1(w - r)}A${r} ${r} 0 0 1 ${pt([w, r])}V${r1(b - r)}A${r} ${r} 0 0 1 ${pt([w - r, b])}H${r1(w * 0.45)}L${pt([w * 0.22, h])}L${pt([w * 0.25, b])}H${r1(r)}A${r} ${r} 0 0 1 ${pt([0, b - r])}V${r1(r)}A${r} ${r} 0 0 1 ${pt([r, 0])}Z`,
        ),
      ];
    },
    textBox: (w, h) => box(0, 0, w, h * 0.72),
  },
  {
    id: 'cube',
    label: 'Cube',
    size: { width: 120, height: 100 },
    parts: (w, h) => {
      const d = Math.min(18, w * 0.2, h * 0.2);
      return [filled(poly([0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h])), line(`M0 ${r1(d)}H${r1(w - d)}V${r1(h)}M${pt([w - d, d])}L${pt([w, 0])}`)];
    },
    textBox: (w, h) => box(0, Math.min(18, w * 0.2, h * 0.2), w - Math.min(18, w * 0.2, h * 0.2), h - Math.min(18, w * 0.2, h * 0.2)),
  },
  {
    id: 'tape',
    label: 'Tape / Punched tape',
    size: { width: 150, height: 90 },
    parts: (w, h) => {
      const a = h * 0.1;
      return [filled(`M0 ${r1(a)}Q${pt([w / 4, a * 3])} ${pt([w / 2, a])}T${pt([w, a])}V${r1(h - a)}Q${pt([w * 0.75, h - a * 3])} ${pt([w / 2, h - a])}T${pt([0, h - a])}Z`)];
    },
    textBox: (w, h) => box(0, h * 0.2, w, h * 0.6),
  },
  {
    id: 'actor',
    label: 'Actor',
    size: { width: 50, height: 90 },
    labelBelow: true,
    outline: true,
    parts: (w, h) => {
      const s = (x: number, y: number): string => pt([(x / 100) * w, (y / 100) * h]);
      return [
        filled(ellipse(w / 2, h * 0.13, w * 0.24, h * 0.12)),
        line(`M${s(50, 25)}L${s(50, 62)}M${s(5, 38)}L${s(95, 38)}M${s(50, 62)}L${s(8, 100)}M${s(50, 62)}L${s(92, 100)}`),
      ];
    },
  },

  // ---- flowchart ----
  { id: 'terminator', label: 'Terminator (start / end)', size: { width: 160, height: 60 }, parts: (w, h) => [filled(roundedRect(w, h, h / 2))], textBox: (w, h) => box(Math.min(w, h) / 4, 0, w - Math.min(w, h) / 2, h) },
  {
    id: 'predefined-process',
    label: 'Predefined process / Subroutine',
    size: { width: 160, height: 80 },
    parts: (w, h) => {
      const b = Math.min(14, w * 0.1);
      return [filled(rect(0, 0, w, h)), line(`M${r1(b)} 0V${r1(h)}M${r1(w - b)} 0V${r1(h)}`)];
    },
    textBox: (w, h) => box(Math.min(14, w * 0.1), 0, w - 2 * Math.min(14, w * 0.1), h),
  },
  {
    id: 'internal-storage',
    label: 'Internal storage',
    size: { width: 120, height: 90 },
    parts: (w, h) => {
      const d = Math.min(16, w * 0.15, h * 0.2);
      return [filled(rect(0, 0, w, h)), line(`M${r1(d)} 0V${r1(h)}M0 ${r1(d)}H${r1(w)}`)];
    },
    textBox: (w, h) => box(Math.min(16, w * 0.15, h * 0.2), Math.min(16, w * 0.15, h * 0.2), w - Math.min(16, w * 0.15, h * 0.2), h - Math.min(16, w * 0.15, h * 0.2)),
  },
  { id: 'manual-input', label: 'Manual input', size: { width: 150, height: 80 }, parts: (w, h) => [filled(poly([0, h * 0.3], [w, 0], [w, h], [0, h]))], textBox: (w, h) => box(0, h * 0.25, w, h * 0.75) },
  {
    id: 'manual-operation',
    label: 'Manual operation',
    size: { width: 160, height: 80 },
    parts: (w, h) => {
      const o = Math.min(w * 0.2, h * 0.6);
      return [filled(poly([0, 0], [w, 0], [w - o, h], [o, h]))];
    },
    textBox: (w, h) => box(Math.min(w * 0.2, h * 0.6), 0, w - 2 * Math.min(w * 0.2, h * 0.6), h),
  },
  {
    id: 'trapezoid',
    label: 'Trapezoid',
    size: { width: 160, height: 80 },
    parts: (w, h) => {
      const o = Math.min(w * 0.2, h * 0.6);
      return [filled(poly([o, 0], [w - o, 0], [w, h], [0, h]))];
    },
    textBox: (w, h) => box(Math.min(w * 0.2, h * 0.6), 0, w - 2 * Math.min(w * 0.2, h * 0.6), h),
  },
  {
    id: 'delay',
    label: 'Delay',
    size: { width: 140, height: 80 },
    parts: (w, h) => {
      const r = Math.min(w / 2, h / 2);
      return [filled(`M0 0H${r1(w - r)}A${r1(r)} ${r1(h / 2)} 0 0 1 ${pt([w - r, h])}H0Z`)];
    },
  },
  {
    id: 'stored-data',
    label: 'Stored data',
    size: { width: 150, height: 80 },
    parts: (w, h) => {
      const r = Math.min(w * 0.15, h * 0.3);
      return [filled(`M${pt([r, 0])}H${r1(w)}A${r1(r)} ${r1(h / 2)} 0 0 0 ${pt([w, h])}H${r1(r)}A${r1(r)} ${r1(h / 2)} 0 0 1 ${pt([r, 0])}Z`)];
    },
    textBox: (w, h) => box(Math.min(w * 0.15, h * 0.3) * 0.6, 0, w - Math.min(w * 0.15, h * 0.3) * 1.6, h),
  },
  {
    id: 'display',
    label: 'Display',
    size: { width: 150, height: 80 },
    parts: (w, h) => {
      const r = Math.min(w * 0.18, h / 2);
      return [filled(`M${pt([0, h / 2])}L${pt([r, 0])}H${r1(w - r)}A${r1(r)} ${r1(h / 2)} 0 0 1 ${pt([w - r, h])}H${r1(r)}Z`)];
    },
  },
  {
    id: 'loop-limit',
    label: 'Loop limit',
    size: { width: 150, height: 80 },
    parts: (w, h) => {
      const c = Math.min(20, w * 0.2, h * 0.4);
      return [filled(poly([c, 0], [w - c, 0], [w, c], [w, h], [0, h], [0, c]))];
    },
  },
  {
    id: 'off-page',
    label: 'Off-page reference',
    size: { width: 90, height: 90 },
    parts: (w, h) => [filled(poly([0, 0], [w, 0], [w, h * 0.62], [w / 2, h], [0, h * 0.62]))],
    textBox: (w, h) => box(0, 0, w, h * 0.65),
  },
  { id: 'connector', label: 'On-page connector', size: { width: 60, height: 60 }, parts: (w, h) => [filled(ellipse(w / 2, h / 2, w / 2, h / 2))], textBox: (w, h) => inset(w, h, 0.12, 0.12) },
  { id: 'merge', label: 'Merge', size: { width: 100, height: 90 }, parts: (w, h) => [filled(poly([0, 0], [w, 0], [w / 2, h]))], textBox: (w, h) => box(w * 0.25, 0, w * 0.5, h * 0.55) },
  {
    id: 'sort',
    label: 'Sort',
    size: { width: 100, height: 100 },
    parts: (w, h) => [filled(poly([w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2])), line(`M0 ${r1(h / 2)}H${r1(w)}`)],
    textBox: (w, h) => inset(w, h, 0.22, 0.22),
  },
  { id: 'collate', label: 'Collate', size: { width: 90, height: 100 }, parts: (w, h) => [filled(poly([0, 0], [w, 0], [0, h], [w, h]))] },
  {
    id: 'or',
    label: 'Or',
    size: { width: 70, height: 70 },
    parts: (w, h) => [filled(ellipse(w / 2, h / 2, w / 2, h / 2)), line(`M${r1(w / 2)} 0V${r1(h)}M0 ${r1(h / 2)}H${r1(w)}`)],
  },
  {
    id: 'summing-junction',
    label: 'Summing junction',
    size: { width: 70, height: 70 },
    parts: (w, h) => {
      const k = Math.SQRT1_2 / 2;
      const [x0, x1, y0, y1] = [w / 2 - w * k, w / 2 + w * k, h / 2 - h * k, h / 2 + h * k];
      return [filled(ellipse(w / 2, h / 2, w / 2, h / 2)), line(`M${pt([x0, y0])}L${pt([x1, y1])}M${pt([x1, y0])}L${pt([x0, y1])}`)];
    },
  },
  {
    id: 'annotation',
    outline: true,
    label: 'Annotation (comment)',
    size: { width: 120, height: 80 },
    parts: (w, h) => [line(`M${r1(Math.min(24, w * 0.3))} 0H0V${r1(h)}H${r1(Math.min(24, w * 0.3))}`)],
    textBox: (w, h) => box(8, 0, w - 8, h),
  },

  // ---- arrows ----
  { id: 'arrow-right', label: 'Arrow right', size: { width: 140, height: 70 }, parts: (w, h) => [filled(blockArrow(w, h, 'right'))], textBox: (w, h) => box(0, h * 0.25, w * 0.8, h * 0.5) },
  { id: 'arrow-left', label: 'Arrow left', size: { width: 140, height: 70 }, parts: (w, h) => [filled(blockArrow(w, h, 'left'))], textBox: (w, h) => box(w * 0.2, h * 0.25, w * 0.8, h * 0.5) },
  { id: 'arrow-up', label: 'Arrow up', size: { width: 70, height: 140 }, parts: (w, h) => [filled(blockArrow(w, h, 'up'))] },
  { id: 'arrow-down', label: 'Arrow down', size: { width: 70, height: 140 }, parts: (w, h) => [filled(blockArrow(w, h, 'down'))] },
  { id: 'arrow-double', label: 'Double arrow', size: { width: 160, height: 70 }, parts: (w, h) => [filled(blockArrow(w, h, 'right', true))], textBox: (w, h) => box(w * 0.2, h * 0.25, w * 0.6, h * 0.5) },
  { id: 'arrow-double-vertical', label: 'Double arrow (vertical)', size: { width: 70, height: 160 }, parts: (w, h) => [filled(blockArrow(w, h, 'down', true))] },
  {
    id: 'chevron',
    label: 'Step / Chevron',
    size: { width: 140, height: 70 },
    parts: (w, h) => {
      const o = Math.min(w * 0.25, h * 0.5);
      return [filled(poly([0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]))];
    },
    textBox: (w, h) => box(Math.min(w * 0.25, h * 0.5), 0, w - 2 * Math.min(w * 0.25, h * 0.5), h),
  },
  {
    id: 'pentagon-arrow',
    label: 'Pentagon arrow',
    size: { width: 140, height: 70 },
    parts: (w, h) => {
      const o = Math.min(w * 0.25, h * 0.5);
      return [filled(poly([0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]))];
    },
    textBox: (w, h) => box(0, 0, w - Math.min(w * 0.25, h * 0.5), h),
  },
];

const BY_ID = new Map(DEFS.map((d) => [d.id, d]));

/** The definition of a shape kind; unknown kinds (from newer files) fall back to a rectangle. */
export function shapeDef(id: string): ShapeDef {
  return BY_ID.get(id) ?? BY_ID.get('rectangle')!;
}

export const isKnownShape = (id: string) => BY_ID.has(id);

/** Panel sections, in the order they are shown; a shape may appear in several. */
export const SHAPE_SECTIONS: { id: string; title: string; shapes: string[] }[] = [
  {
    id: 'general',
    title: 'General',
    shapes: [
      'rectangle', 'rounded', 'ellipse', 'square', 'circle',
      'diamond', 'parallelogram', 'hexagon', 'triangle', 'triangle-right',
      'cylinder', 'cloud', 'document', 'note-shape', 'card',
      'callout', 'callout-rounded', 'cube', 'tape', 'actor',
    ],
  },
  {
    id: 'basic',
    title: 'Basic',
    shapes: ['pentagon', 'octagon', 'star', 'plus', 'trapezoid'],
  },
  {
    id: 'flowchart',
    title: 'Flowchart',
    shapes: [
      'terminator', 'rectangle', 'diamond', 'parallelogram', 'predefined-process',
      'document', 'multi-document', 'cylinder', 'internal-storage', 'manual-input',
      'manual-operation', 'hexagon', 'delay', 'stored-data', 'display',
      'loop-limit', 'off-page', 'connector', 'merge', 'triangle',
      'sort', 'collate', 'or', 'summing-junction', 'annotation',
    ],
  },
  {
    id: 'arrows',
    title: 'Arrows',
    shapes: ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-double', 'arrow-double-vertical', 'chevron', 'pentagon-arrow'],
  },
];

/** Label area of a shape, in px relative to its top-left corner. */
export function textBoxOf(def: ShapeDef, w: number, h: number) {
  return def.textBox?.(w, h) ?? box(0, 0, w, h);
}

/** Drag data type for shapes dragged from the panel onto the canvas. */
export const SHAPE_DRAG_TYPE = 'application/x-paperworkspace-shape';
