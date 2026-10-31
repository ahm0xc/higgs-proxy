/**
 * Minimal production server for the built web app.
 *
 * Serves `dist/` with long-lived caching for hashed assets and an SPA fallback
 * to `index.html` for client-side routes. Intended for self-hosted installs
 * where a separate static host (Nginx, Caddy, ...) is not part of the setup.
 *
 *   bun run scripts/serve.ts
 *
 * Environment:
 *   PORT  Port to listen on (default: 5560)
 *   HOST  Interface to bind (default: 0.0.0.0)
 */
import { resolve, sep } from "node:path";

const distDir = resolve(import.meta.dir, "..", "dist");
const indexFile = Bun.file(resolve(distDir, "index.html"));

const port = Number(process.env.PORT ?? 5560);
const hostname = process.env.HOST ?? "0.0.0.0";

/** Resolve a URL path inside `dist/`, rejecting anything that escapes it. */
function resolveAsset(pathname: string): string | null {
  let decoded: string;

  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const filePath = resolve(distDir, `.${decoded}`);

  if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) {
    return null;
  }

  return filePath;
}

const server = Bun.serve({
  port,
  hostname,
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const url = new URL(request.url);
    const filePath = resolveAsset(url.pathname);

    if (filePath) {
      const file = Bun.file(filePath);

      if (await file.exists()) {
        const headers = new Headers();

        // Vite fingerprints everything under /assets, so it is safe to cache
        // those forever. Public files keep a short cache instead.
        headers.set(
          "cache-control",
          url.pathname.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
        );

        return new Response(request.method === "HEAD" ? null : file, {
          headers,
        });
      }
    }

    if (!(await indexFile.exists())) {
      return new Response(
        "Web build not found. Run `bun run build` before starting the server.",
        { status: 500 },
      );
    }

    return new Response(request.method === "HEAD" ? null : indexFile, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  },
});

console.log(
  `[web] serving ${distDir} on http://${server.hostname}:${server.port}`,
);
