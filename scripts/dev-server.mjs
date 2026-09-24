// Static server for the webview harness: http://localhost:5199/harness/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = join(process.cwd(), 'dist');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};
const port = Number(process.env.PORT) || 5199;

createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/harness') {
    res.writeHead(302, { location: '/harness/' }).end();
    return;
  }
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
  if (path === '' || path === 'harness' || /[/\\]$/.test(path)) path = join(path || 'harness', 'index.html');
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, () => console.log(`Harness: http://localhost:${port}/harness/`));
