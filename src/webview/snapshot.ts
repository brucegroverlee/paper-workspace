// Snapshots: renders the canvas (what is on screen, or every paper) to a PNG the host saves where the user picks.
//
// VS Code gives extensions no way to screenshot a webview, so the canvas is drawn by the browser itself: the DOM is
// cloned (a native, fast copy), wrapped with the page's stylesheets in an SVG <foreignObject>, and that SVG is drawn
// onto a canvas. Nothing reads computed styles element by element, which is what makes DOM-to-image libraries slow.
import type { Rect, Viewport } from '@xyflow/react';

export type SnapshotScope = 'view' | 'workspace';

/** Room around the papers in a workspace snapshot, for titles and tags drawn outside a node's box. */
const WORKSPACE_PADDING = 64;
/** Longest side of a snapshot in device pixels; browsers refuse canvases much larger than this. */
const MAX_SIDE = 8192;
/** Sharpness of a snapshot: the screen's, at most 2 (a larger canvas costs more to draw and encode). */
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);

/** Editing chrome left out of snapshots: resize and connection handles, node toolbars, the selection box, panels. */
const EXCLUDED = [
  '.react-flow__panel',
  '.react-flow__minimap',
  '.react-flow__handle',
  '.react-flow__resize-control',
  '.react-flow__node-toolbar',
  '.react-flow__nodesselection',
  '.react-flow__selection',
].join(',');

/** The canvas as it is on screen (dot grid included), without the toolbar, minimap or editing handles. */
export async function captureView(background: string): Promise<string> {
  const pane = canvasElement();
  const { width, height } = pane.getBoundingClientRect();
  return render(pane, Math.round(width), Math.round(height), background, pixelRatio());
}

/** Titles and side tags: counter-scaled by `1 / zoom` (see NodeTitle) so they keep their size on screen. */
const ZOOM_FREE_LABELS = '.pw-node-label-row, .pw-side-tags';

/**
 * Every paper at zoom 1 (scaled down when the image would be too large). Only the copy's viewport is moved, so the
 * canvas on screen does not change; offscreen papers must already be rendered (see `onlyRenderVisibleElements`).
 * `bounds` are the papers' boxes; the image also takes in their titles and tags, which lie outside them.
 */
export async function captureWorkspace(bounds: Rect, viewport: Viewport, background: string, onCopied?: () => void): Promise<string> {
  const area = withLabels(bounds, viewport);
  const width = Math.ceil(area.width + WORKSPACE_PADDING * 2);
  const height = Math.ceil(area.height + WORKSPACE_PADDING * 2);
  const transform = `translate(${WORKSPACE_PADDING - area.x}px, ${WORKSPACE_PADDING - area.y}px) scale(1)`;
  return render(canvasElement(), width, height, background, Math.min(pixelRatio(), MAX_SIDE / Math.max(width, height)), (copy) => {
    const view = copy.querySelector<HTMLElement>('.react-flow__viewport');
    if (view) view.style.transform = transform;
    // Labels as they are at zoom 1: not counter-scaled, and as wide as their paper (their width is set in screen px).
    copy.style.setProperty('--pw-zoom', '1');
    for (const label of copy.querySelectorAll<HTMLElement>(ZOOM_FREE_LABELS)) {
      label.style.transform = 'none';
      if (label.style.width) label.style.width = `${parseFloat(label.style.width) / viewport.zoom}px`;
    }
    // The dot grid follows the on-screen pan and zoom, so it would not line up with the moved papers.
    copy.querySelector('.react-flow__background')?.remove();
    onCopied?.();
  });
}

/**
 * `bounds` grown to take in every title and side tag list as drawn at zoom 1. On screen such a label is scaled by
 * `1 / zoom` around its transform origin (the corner that touches its paper); at zoom 1 it is its layout size, so its
 * canvas box grows by `zoom` around that corner. A width set on it (the paper's width) stays the same in canvas units.
 */
function withLabels(bounds: Rect, vp: Viewport): Rect {
  const pane = canvasElement().getBoundingClientRect();
  let x0 = bounds.x;
  let y0 = bounds.y;
  let x1 = bounds.x + bounds.width;
  let y1 = bounds.y + bounds.height;
  for (const label of document.querySelectorAll<HTMLElement>(`.react-flow__viewport :is(${ZOOM_FREE_LABELS})`)) {
    const r = label.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    // Its box on the canvas now, and the corner it is anchored to.
    const left = (r.left - pane.left - vp.x) / vp.zoom;
    const top = (r.top - pane.top - vp.y) / vp.zoom;
    const [ox, oy] = getComputedStyle(label).transformOrigin.split(' ').map(parseFloat);
    const ax = left + ox / vp.zoom;
    const ay = top + oy / vp.zoom;
    const fx = label.style.width ? 1 : vp.zoom;
    const fy = vp.zoom;
    x0 = Math.min(x0, ax + (left - ax) * fx);
    y0 = Math.min(y0, ay + (top - ay) * fy);
    x1 = Math.max(x1, ax + (left + r.width / vp.zoom - ax) * fx);
    y1 = Math.max(y1, ay + (top + r.height / vp.zoom - ay) * fy);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Waits until React has rendered and Monaco has laid out editors that were just mounted. */
export async function settle(ms = 600) {
  // Frames do not come while the webview is not painted, so each is only waited for a moment.
  const frame = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
      setTimeout(resolve, 100);
    });
  await frame();
  await frame();
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function canvasElement() {
  const pane = document.querySelector<HTMLElement>('.react-flow');
  if (!pane) throw new Error('the canvas is not ready');
  return pane;
}

// ---- rendering -------------------------------------------------------------------------------------

async function render(
  root: HTMLElement,
  width: number,
  height: number,
  background: string,
  pixelRatio: number,
  adjust?: (copy: HTMLElement) => void,
): Promise<string> {
  const copy = root.cloneNode(true) as HTMLElement;
  copyLiveState(root, copy);
  copy.querySelectorAll(EXCLUDED).forEach((el) => el.remove());
  adjust?.(copy);
  await inlineImages(copy);
  Object.assign(copy.style, { width: `${width}px`, height: `${height}px`, position: 'relative', inset: 'auto' });

  // Stylesheets match through ancestors (`body.vscode-dark ...`, `.pw-canvas ...`) and VS Code's theme variables live
  // on <html>, so the copy is nested in shallow copies of its ancestors, each sized to the image.
  let tree: Element = copy;
  for (let el = root.parentElement; el; el = el.parentElement) {
    const shell = el.cloneNode(false) as HTMLElement;
    Object.assign(shell.style, { width: `${width}px`, height: `${height}px`, margin: '0', padding: '0', position: 'relative', overflow: 'hidden' });
    shell.appendChild(tree);
    tree = shell;
  }
  const style = document.createElement('style');
  style.textContent = await pageCss();
  tree.insertBefore(style, tree.firstChild);

  const xhtml = new XMLSerializer().serializeToString(tree);
  // Sized in device pixels with a viewBox in CSS pixels, so the browser rasterizes it sharp at that size.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * pixelRatio)}" height="${Math.round(height * pixelRatio)}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  // Drawn here: an SVG with a <foreignObject> may only be drawn from an <img>; anything else taints the canvas.
  return encodePng(drawn(img, background));
}

/**
 * What cloneNode does not copy: canvas pixels, video frames, form values and scroll offsets. Runs before anything is
 * removed from the copy, while both trees still match element for element.
 */
function copyLiveState(root: HTMLElement, copy: HTMLElement) {
  // Both trees match element for element, so a selector lists the same elements in the same order in each.
  const pairs = (selector: string) => {
    const clones = copy.querySelectorAll<HTMLElement>(selector);
    return [...root.querySelectorAll<HTMLElement>(selector)].map((original, i) => [original, clones[i]] as const);
  };
  const replaced: [HTMLElement, HTMLElement][] = [];
  for (const [original, clone] of pairs('canvas, video, input, textarea')) {
    if (original instanceof HTMLCanvasElement || original instanceof HTMLVideoElement) {
      const img = frameOf(original);
      if (img) replaced.push([clone, img]);
    } else if (original instanceof HTMLInputElement) {
      if (original.type === 'checkbox' || original.type === 'radio') clone.toggleAttribute('checked', original.checked);
      else clone.setAttribute('value', original.value);
    } else if (original instanceof HTMLTextAreaElement) {
      clone.textContent = original.value;
    }
  }
  // A scrolled box shows its content from the top in the copy; shifting the children puts it back. Monaco (most of
  // the elements) scrolls with offsets of its own, which the copy keeps, so its elements are not looked at.
  for (const [original, clone] of pairs(':not(.monaco-editor, .monaco-editor *)')) {
    if (!original.scrollTop && !original.scrollLeft) continue;
    for (const child of clone.children) (child as HTMLElement).style.translate = `${-original.scrollLeft}px ${-original.scrollTop}px`;
  }
  // Replaced last, so the pairing above still sees the original trees.
  for (const [clone, img] of replaced) clone.replaceWith(img);
}

/** A still of a canvas or video as an <img> with the same box, or null when the pixels cannot be read. */
function frameOf(el: HTMLCanvasElement | HTMLVideoElement) {
  try {
    let url: string;
    if (el instanceof HTMLCanvasElement) url = el.toDataURL();
    else {
      if (!el.videoWidth) return null;
      const c = document.createElement('canvas');
      c.width = el.videoWidth;
      c.height = el.videoHeight;
      c.getContext('2d')!.drawImage(el, 0, 0);
      url = c.toDataURL();
    }
    const img = document.createElement('img');
    img.src = url;
    img.className = el.className;
    img.setAttribute('style', el.getAttribute('style') ?? '');
    const r = el.getBoundingClientRect();
    const zoom = el.offsetWidth ? r.width / el.offsetWidth : 1;
    if (!img.style.width) img.style.width = `${r.width / zoom}px`;
    if (!img.style.height) img.style.height = `${r.height / zoom}px`;
    if (el instanceof HTMLVideoElement) img.style.objectFit = getComputedStyle(el).objectFit;
    return img;
  } catch {
    return null; // a cross-origin frame taints the canvas
  }
}

/** An SVG image cannot load anything itself, so pictures (media papers) are embedded. */
async function inlineImages(copy: HTMLElement) {
  const imgs = [...copy.querySelectorAll('img')].filter((img) => img.src && !img.src.startsWith('data:'));
  await Promise.all(
    imgs.map(async (img) => {
      const url = await toDataUrl(img.src);
      img.removeAttribute('srcset');
      if (url) img.src = url;
      else img.remove();
    }),
  );
}

// ---- encoding --------------------------------------------------------------------------------------

/** The image on a background, as a bitmap that can be handed to a worker without copying it. */
function drawn(img: HTMLImageElement, background: string) {
  const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  return canvas.transferToImageBitmap();
}

/** Encoding a large image as PNG takes the main thread for up to a second, so a worker does it. */
const ENCODER = `onmessage = async ({ data: bitmap }) => {
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('bitmaprenderer').transferFromImageBitmap(bitmap);
    const url = new FileReaderSync().readAsDataURL(await canvas.convertToBlob({ type: 'image/png' }));
    postMessage({ data: url.slice(url.indexOf(',') + 1) });
  } catch (e) {
    postMessage({ error: String(e) });
  }
};`;

let encoder: Worker | null | undefined;
function encoderWorker() {
  if (encoder === undefined) {
    try {
      encoder = new Worker(URL.createObjectURL(new Blob([ENCODER], { type: 'text/javascript' })));
    } catch {
      encoder = null; // e.g. a stricter CSP
    }
  }
  return encoder;
}

async function encodePng(bitmap: ImageBitmap): Promise<string> {
  const worker = encoderWorker();
  if (worker) {
    return new Promise<string>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<{ data?: string; error?: string }>) => (data.data ? resolve(data.data) : reject(new Error(data.error)));
      worker.onerror = (e) => reject(new Error(e.message || 'the image could not be encoded'));
      worker.postMessage(bitmap, [bitmap]);
    });
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('bitmaprenderer')!.transferFromImageBitmap(bitmap);
  return blobToBase64(await canvas.convertToBlob({ type: 'image/png' }));
}

// ---- stylesheets -----------------------------------------------------------------------------------

/** Fetched stylesheets and embedded files, kept across snapshots (Monaco's own <style> tags are read every time). */
const fetchedCss = new Map<string, Promise<string>>();
const dataUrls = new Map<string, Promise<string | null>>();

async function pageCss() {
  const parts = await Promise.all(
    [...document.styleSheets].map(async (sheet) => {
      const base = sheet.href ?? document.baseURI;
      let text: string;
      try {
        text = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      } catch {
        // Webview resources are cross-origin, so their rules are not readable; the file itself is.
        if (!sheet.href) return '';
        const href = sheet.href;
        if (!fetchedCss.has(href)) fetchedCss.set(href, fetch(href).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
        text = await fetchedCss.get(href)!;
      }
      return inlineUrls(text, base);
    }),
  );
  return parts.join('\n');
}

/** Replaces `url(...)` references (fonts such as the codicons, background images) with data URLs. */
async function inlineUrls(css: string, base: string) {
  const found = new Map<string, string>();
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const ref = m[2];
    if (ref.startsWith('data:') || ref.startsWith('#')) continue;
    try {
      found.set(ref, new URL(ref, base).href);
    } catch {
      /* not a URL */
    }
  }
  if (!found.size) return css;
  const resolved = new Map<string, string | null>();
  await Promise.all([...found].map(async ([ref, abs]) => resolved.set(ref, await toDataUrl(abs))));
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, _q, ref: string) => {
    const url = resolved.get(ref);
    return url ? `url("${url}")` : all;
  });
}

function toDataUrl(url: string) {
  if (!dataUrls.has(url)) {
    dataUrls.set(
      url,
      fetch(url)
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? blobToDataUrl(b) : null))
        .catch(() => null),
    );
  }
  return dataUrls.get(url)!;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function blobToBase64(blob: Blob) {
  const url = await blobToDataUrl(blob);
  return url.slice(url.indexOf(',') + 1);
}
