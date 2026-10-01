// Records the webview harness's ?demo scene (scripts/harness/demo.js) into the README GIF.
// Start the harness first (`npm run dev:webview`), then:
//   npm run record:demo [-- <out.gif>]
// Uses an installed Chrome or Edge; set CHROME to its path if it is not found.
import puppeteer from 'puppeteer-core';
import gifenc from 'gifenc';
import pngjs from 'pngjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const { PNG } = pngjs;
const out = process.argv[2] ?? 'docs/images/demo.gif';
const url = `http://localhost:${process.env.PORT || 5199}/harness/?demo`;
const W = 1280;
const H = 720;
const executablePath = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No Chrome or Edge found: set CHROME to its executable.');

const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle0' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = []; // { buf: PNG screenshot, delay: ms shown in the GIF }
const shot = async (delay = 80) => frames.push({ buf: await page.screenshot({ type: 'png' }), delay });
const box = (id) => page.$eval(`.react-flow__node[data-id="${id}"]`, (el) => el.getBoundingClientRect().toJSON());
// Keeps the pointer away from code, where it would open hovers.
const park = () => page.mouse.move(W / 2, H - 20);
async function fit() {
  await page.click('button[title^="Fit all papers"]');
  await sleep(700);
}
// A drag with ease-in-out and a frame per step.
async function drag(from, to, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(16);
    await shot(50);
  }
  await page.mouse.up();
}
async function zoomIn(at, ticks) {
  await page.mouse.move(at.x, at.y);
  for (let i = 0; i < ticks; i++) {
    await page.keyboard.down('Control');
    await page.mouse.wheel({ deltaY: -120 });
    await page.keyboard.up('Control');
    await sleep(60);
    await shot(60);
  }
}

await sleep(2500);

// 1. The whole canvas.
await fit();
await sleep(500);
await shot(1800);

// 2. Move the sticky note below the route.
const note = await box('n1');
const route = await box('fr');
await drag({ x: note.x + note.width / 2, y: note.y + 8 }, { x: note.x + note.width / 2, y: route.bottom + 48 });
await shot(500);

// 3. Zoom into login.ts.
const login = await box('fl');
await zoomIn({ x: login.x + login.width * 0.45, y: login.y + login.height * 0.8 }, 5);
await park();
await shot(500);

// 4. Edit the code: a new line after createSession().
const line = await page.evaluate(() => {
  const node = document.querySelector('.react-flow__node[data-id="fl"]');
  const l = [...node.querySelectorAll('.view-line')].find((el) => el.textContent.includes('createSession(user.id)'));
  const r = l.getBoundingClientRect();
  return { x: l.querySelector('span').getBoundingClientRect().right - 2, y: r.y + r.height / 2 };
});
await page.mouse.click(line.x, line.y);
await park();
await page.keyboard.press('End');
await sleep(200);
await shot(300);
await page.keyboard.press('Enter');
await shot(120);
const typed = "await auditLog('login', user.id);";
for (let i = 0; i < typed.length; i += 2) {
  await page.keyboard.type(typed.slice(i, i + 2));
  await sleep(30);
  await shot(70);
}
await page.keyboard.press('Escape');
await shot(1500);
const text = await page.evaluate(() => window.__mock.files['src/auth/login.ts']);
if (!text.includes(typed)) throw new Error('The typed line did not reach the file; the recording is off.');

// 5. Back to the whole canvas.
await fit();
await shot(2500);
await browser.close();

// One palette per frame keeps the code readable.
const gif = GIFEncoder();
for (const { buf, delay } of frames) {
  const { data, width, height } = PNG.sync.read(buf);
  const palette = quantize(data, 256, { format: 'rgb565' });
  gif.writeFrame(applyPalette(data, palette, 'rgb565'), width, height, { palette, delay });
}
gif.finish();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gif.bytes());
console.log(`${frames.length} frames, ${(gif.bytes().length / 1e6).toFixed(2)} MB -> ${out}`);
