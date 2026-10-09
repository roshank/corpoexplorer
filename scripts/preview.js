// Serve the site locally, the same way GitHub Pages does: node scripts/preview.js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path));
  const body = file.startsWith(ROOT) ? await readFile(file).catch(() => null) : null;
  res.writeHead(body ? 200 : 404, { 'Content-Type': TYPES[extname(file)] || 'text/plain' });
  res.end(body ?? 'Not found');
}).listen(PORT, () => console.log(`Previewing at http://localhost:${PORT}`));
