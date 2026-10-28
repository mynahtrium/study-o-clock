import { defineConfig, type Plugin } from 'vite';
import { createReadStream, statSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * Serves the gitignored textbook PDFs from the repo root at /books/<id>.pdf.
 *
 * They are never copied or bundled — this streams them straight off disk with
 * range support, so PDF.js can lazily fetch single pages instead of pulling
 * a 390 MB file into memory.
 */
function serveBooks(): Plugin {
  const root = process.cwd();

  const middleware = (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
    next: () => void,
  ): void => {
    const url = req.url ?? '';
    if (!url.startsWith('/books/')) return next();

    const rawName = decodeURIComponent(url.slice('/books/'.length).split('?')[0] ?? '');
    // Only a bare filename, always .pdf — no traversal, no directories.
    const safe = basename(rawName);
    if (!safe.endsWith('.pdf') || safe !== rawName) {
      res.statusCode = 400;
      res.end('bad book id');
      return;
    }

    const filePath = join(root, safe);
    let size: number;
    try {
      size = statSync(filePath).size;
    } catch {
      res.statusCode = 404;
      res.end('book not found');
      return;
    }

    const range = req.headers.range;
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match?.[1] ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : size - 1;
      if (start >= size || end >= size || start > end) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', String(end - start + 1));
      res.setHeader('Content-Type', 'application/pdf');
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  };

  return {
    name: 'serve-books',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [serveBooks()],
  server: { port: 5173 },
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
