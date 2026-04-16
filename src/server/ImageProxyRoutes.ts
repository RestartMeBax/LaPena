import { Router } from "express";

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  if (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1"
  ) {
    return true;
  }

  if (h.startsWith("10.")) return true;
  if (h.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  if (h.endsWith(".local")) return true;

  return false;
}

function parseTargetUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (isBlockedHostname(url.hostname)) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function looksLikeImagePath(pathname: string): boolean {
  return /\.(png|jpg|jpeg|webp|gif|svg|bmp|ico|avif)$/i.test(pathname);
}

function mimeFromPath(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".gif")) return "image/gif";
  if (p.endsWith(".bmp")) return "image/bmp";
  if (p.endsWith(".ico")) return "image/x-icon";
  if (p.endsWith(".avif")) return "image/avif";
  return "image/png";
}

export function registerImageProxyRoutes(app: Router): void {
  const router = Router();

  // GET /api/assets/image-proxy?url=https%3A%2F%2F...
  router.get("/image-proxy", async (req, res) => {
    const target = parseTargetUrl(req.query.url);
    if (!target) {
      return res.status(400).json({ error: "Invalid or blocked image URL" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const upstream = await fetch(target.toString(), {
        signal: controller.signal,
        headers: {
          Accept: "image/*",
        },
      });

      if (!upstream.ok) {
        return res.status(502).json({ error: "Failed to fetch upstream image" });
      }

      const contentType = upstream.headers.get("content-type") ?? "";
      const normalizedType = contentType.toLowerCase();
      const isImageType = normalizedType.startsWith("image/");
      const isOctetStreamImageLike =
        normalizedType.startsWith("application/octet-stream") &&
        looksLikeImagePath(target.pathname);
      if (!isImageType && !isOctetStreamImageLike) {
        return res.status(415).json({ error: "Upstream resource is not an image" });
      }

      const body = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader(
        "Content-Type",
        isImageType ? contentType : mimeFromPath(target.pathname),
      );
      return res.status(200).send(body);
    } catch {
      return res.status(504).json({ error: "Image proxy request failed" });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.use("/api/assets", router);
}
