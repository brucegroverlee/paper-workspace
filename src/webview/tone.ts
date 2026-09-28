// Text tone for title bars without a color of their own: they show the paper color (or a folder's body color), often
// translucent over the canvas, so the theme's text color alone can be unreadable (light text over a light canvas).

type RGB = [number, number, number];

/** The theme's paper color, resolved once per theme (see resetThemeColors). */
let paper: RGB | undefined;

/** The host theme changed: resolve theme colors again. */
export function resetThemeColors() {
  paper = undefined;
}

function hexToRgb(c: string): RGB | undefined {
  if (!/^#[0-9a-f]{6}$/i.test(c)) return undefined;
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** A CSS variable's color as RGB (theme variables may be in any CSS color format). */
function resolveVar(name: string, fallback: RGB): RGB {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(getComputedStyle(probe).color);
  probe.remove();
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : fallback;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: RGB) {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * `on-light` (dark text) or `on-dark` (light text), whichever contrasts more with what shows behind a title bar: `color`
 * (undefined = the theme's paper color) at `alpha` over the canvas background.
 */
export function toneOver(surface: { color?: string; alpha: number }, canvas: string): 'on-light' | 'on-dark' {
  const top = (surface.color && hexToRgb(surface.color)) || (paper ??= resolveVar('--pw-paper-bg', [42, 47, 58]));
  const base = hexToRgb(canvas) ?? [228, 229, 232];
  const a = Math.min(1, Math.max(0, surface.alpha));
  const L = luminance(top.map((t, i) => t * a + base[i] * (1 - a)) as RGB);
  // Contrast with black text vs. with white text.
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? 'on-light' : 'on-dark';
}
