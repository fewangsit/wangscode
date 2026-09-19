// Local preview server for docs/ — internal documentation only, never
// published (docs/ is not in package.json's "files"). Plain Bun.serve() +
// Bun.file(): no framework needed for a handful of static HTML pages.
import { extname, join, normalize } from "node:path";

const DOCS_DIR = new URL("../docs/", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 4173);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname === "/" ? "/source-map.html" : url.pathname;
    const filePath = normalize(join(DOCS_DIR, pathname));

    if (!filePath.startsWith(DOCS_DIR)) return new Response("Forbidden", { status: 403 });

    const file = Bun.file(filePath);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    const contentType = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    return new Response(file, { headers: { "content-type": contentType } });
  },
});

console.log(`docs preview → http://localhost:${server.port}/`);
console.log(`serving       ${DOCS_DIR}`);
