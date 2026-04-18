import { Request, Response, Router } from "express";
import crypto from "crypto";
import { AuthDatabase } from "./AuthDatabase";
import { verifyAuthToken } from "./AuthJwt";
import {
  normalizeCustomMapKey,
  writeCustomMapBundle,
} from "./CustomMapStorage";
import { logger } from "./Logger";

const log = logger.child({ comp: "admin" });

const OWNER_ADMIN_EMAILS = new Set(
  [
    "ludovickjeux@gmail.com",
    ...(process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  ],
);

type MapValidationResult =
  | {
      ok: true;
      normalizedBaseUrl: string;
      manifestUrl: string;
      files: {
        manifest: string;
        mapBin: string;
        map4xBin: string;
        map16xBin: string;
      };
    }
  | {
      ok: false;
      error: string;
      manifestUrl?: string;
    };

function requestOrigin(req: Request): string {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "http";
  const host = req.get("host") || "localhost";
  return `${protocol}://${host}`;
}

function normalizeMapBaseUrl(rawMapUrl: string, req: Request): string {
  const trimmed = rawMapUrl.trim().replace(/\/+$/, "");
  const withoutManifest = trimmed.endsWith("/manifest.json")
    ? trimmed.slice(0, -"/manifest.json".length)
    : trimmed;

  const absolute = new URL(withoutManifest, requestOrigin(req));
  return absolute.toString().replace(/\/+$/, "");
}

async function checkUrlReachable(url: string): Promise<globalThis.Response> {
  const head = await fetchWithTimeout(url, { method: "HEAD" }, 8000);
  if (head.status !== 405) {
    return head;
  }
  return fetchWithTimeout(url, { method: "GET" }, 8000);
}

function isAbortError(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && (error as { name?: string }).name === "AbortError";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function validateMapDataUrl(
  mapUrl: string,
  req: Request,
): Promise<MapValidationResult> {
  const normalizedBaseUrl = normalizeMapBaseUrl(mapUrl, req);
  const manifestUrl = `${normalizedBaseUrl}/manifest.json`;

  let manifestResponse: globalThis.Response;
  try {
    manifestResponse = await fetchWithTimeout(manifestUrl, {
      headers: { Accept: "application/json" },
    }, 10000);
  } catch (error) {
    if (isAbortError(error)) {
      return {
        ok: false,
        manifestUrl,
        error: `Timed out while reaching manifest URL: ${manifestUrl}`,
      };
    }
    return {
      ok: false,
      manifestUrl,
      error: `Could not reach manifest URL: ${manifestUrl}`,
    };
  }

  if (!manifestResponse.ok) {
    return {
      ok: false,
      manifestUrl,
      error: `Manifest request failed (${manifestResponse.status}) at ${manifestUrl}`,
    };
  }

  const contentType = (
    manifestResponse.headers.get("content-type") || ""
  ).toLowerCase();
  const manifestText = await manifestResponse.text();
  if (
    contentType.includes("text/html") ||
    manifestText.trimStart().startsWith("<!doctype") ||
    manifestText.trimStart().startsWith("<html")
  ) {
    return {
      ok: false,
      manifestUrl,
      error:
        "Manifest URL returned HTML instead of JSON. Use a map folder URL that contains manifest.json and map binaries.",
    };
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestText) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      manifestUrl,
      error: `Manifest JSON is invalid at ${manifestUrl}`,
    };
  }

  const hasMeta =
    manifest &&
    typeof manifest === "object" &&
    manifest.map &&
    manifest.map4x &&
    manifest.map16x;
  if (!hasMeta) {
    return {
      ok: false,
      manifestUrl,
      error:
        "Manifest JSON is missing required map metadata (map, map4x, map16x).",
    };
  }

  const files = {
    manifest: manifestUrl,
    mapBin: `${normalizedBaseUrl}/map.bin`,
    map4xBin: `${normalizedBaseUrl}/map4x.bin`,
    map16xBin: `${normalizedBaseUrl}/map16x.bin`,
  };

  let binaryChecks: globalThis.Response[];
  try {
    binaryChecks = await Promise.all([
      checkUrlReachable(files.mapBin),
      checkUrlReachable(files.map4xBin),
      checkUrlReachable(files.map16xBin),
    ]);
  } catch (error) {
    if (isAbortError(error)) {
      return {
        ok: false,
        manifestUrl,
        error: "Timed out while checking required map binary files.",
      };
    }
    return {
      ok: false,
      manifestUrl,
      error: "Could not validate one or more required map binary files.",
    };
  }

  if (!binaryChecks[0].ok) {
    return {
      ok: false,
      manifestUrl,
      error: `Missing required file map.bin (${binaryChecks[0].status}) at ${files.mapBin}`,
    };
  }
  if (!binaryChecks[1].ok) {
    return {
      ok: false,
      manifestUrl,
      error: `Missing required file map4x.bin (${binaryChecks[1].status}) at ${files.map4xBin}`,
    };
  }
  if (!binaryChecks[2].ok) {
    return {
      ok: false,
      manifestUrl,
      error: `Missing required file map16x.bin (${binaryChecks[2].status}) at ${files.map16xBin}`,
    };
  }

  return {
    ok: true,
    normalizedBaseUrl,
    manifestUrl,
    files,
  };
}

function parseBearerToken(req: Request) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return null;
  const token = Array.isArray(authHeader)
    ? authHeader[0].replace(/^Bearer\s+/, "")
    : String(authHeader).replace(/^Bearer\s+/, "");
  return token;
}

function isAdminPayload(payload: Record<string, unknown>): boolean {
  const email =
    typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  const roles = Array.isArray(payload.roles)
    ? payload.roles.map((r) => String(r).toLowerCase())
    : [];
  return roles.includes("admin") || OWNER_ADMIN_EMAILS.has(email);
}

function isAdminFromDb(
  payload: Record<string, unknown>,
  db: AuthDatabase,
): boolean {
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!email) return false;
  return db.isAdminEmail(email);
}

async function requireAdmin(
  req: Request,
  res: Response,
  db: AuthDatabase,
  next: () => void,
): Promise<void> {
  const token = parseBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const payload = await verifyAuthToken(token, req);
    if (!isAdminPayload(payload) && !isAdminFromDb(payload, db)) {
      const email = typeof payload.email === "string" ? payload.email : "unknown";
      log.warn(`Admin access denied for ${email} (${req.method} ${req.path})`);
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    (req as Request & { adminPayload?: Record<string, unknown> }).adminPayload =
      payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function registerAdminRoutes(app: Router, db: AuthDatabase) {
  const router = Router();

  router.get("/me", async (req, res) => {
    const token = parseBearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }
    try {
      const payload = await verifyAuthToken(token, req);
      const roles = Array.isArray(payload.roles)
        ? payload.roles.map((r) => String(r))
        : [];
      const email = typeof payload.email === "string" ? payload.email : "";
      return res.json({
        isAdmin: isAdminPayload(payload) || isAdminFromDb(payload, db),
        email,
        roles,
      });
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  });

  router.use((req, res, next) => {
    void requireAdmin(req, res, db, next);
  });

  router.get("/admins", (_req, res) => {
    const existingAdmins = db.getUsersByRole("admin");
    const existingEmails = new Set(existingAdmins.map((u) => u.email.toLowerCase()));

    // Include pre-granted emails that haven't signed up yet
    const allAdminEmails = db.getAdminEmails();
    const pendingAdmins = allAdminEmails
      .filter((email) => !existingEmails.has(email.toLowerCase()))
      .map((email) => ({
        id: null,
        email,
        displayName: null,
        roles: ["admin"],
        createdAt: null,
        pendingSignup: true,
      }));

    const admins = [
      ...existingAdmins.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        createdAt: user.createdAt,
        pendingSignup: false,
      })),
      ...pendingAdmins,
    ];
    return res.json({ admins });
  });

  router.post("/admins/grant", (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!email) {
      return res.status(400).json({ error: "Missing user email" });
    }

    const updated = db.grantAdminByEmail(email);
    const actor = (req as Request & { adminPayload?: Record<string, unknown> }).adminPayload;
    const actorEmail = typeof actor?.email === "string" ? actor.email : "unknown";
    if (updated === null) {
      log.info(`Admin pre-granted (pending signup) for ${email} by ${actorEmail}`);
    } else {
      log.info(`Admin granted to ${email} (id=${updated.id}) by ${actorEmail}`);
    }

    return res.json({
      success: true,
      pendingSignup: updated === null,
      user: {
        id: updated?.id,
        email: updated?.email ?? email,
        displayName: updated?.displayName,
        roles: updated?.roles ?? ["admin"],
      },
    });
  });

  router.post("/admins/revoke", (req, res) => {
    const emailRaw =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const email = emailRaw.toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "Missing user email" });
    }

    if (OWNER_ADMIN_EMAILS.has(email)) {
      return res.status(400).json({
        error: "Cannot revoke owner admin account.",
      });
    }

    const updated = db.revokeAdminByEmail(email);
    const actor = (req as Request & { adminPayload?: Record<string, unknown> }).adminPayload;
    const actorEmail = typeof actor?.email === "string" ? actor.email : "unknown";
    if (updated !== null) {
      log.info(`Admin revoked for ${email} (id=${updated.id}) by ${actorEmail}`);
    } else {
      log.info(`Admin revoke for ${email} (not a user yet / no role) by ${actorEmail}`);
    }

    return res.json({
      success: true,
      removedFromExistingUser: updated !== null,
      user: {
        id: updated?.id,
        email: updated?.email ?? email,
        displayName: updated?.displayName,
        roles: updated?.roles ?? [],
      },
    });
  });

  router.get("/flags", (_req, res) => {
    return res.json({ flags: db.getFlags() });
  });

  router.post("/flags", (req, res) => {
    const { name, description, imageUrl } = req.body;
    if (!name || !description) {
      return res.status(400).json({ error: "Missing flag name or description" });
    }
    const result = db.saveFlag(
      String(name),
      String(description),
      typeof imageUrl === "string" ? imageUrl : undefined,
    );
    const actor = (req as Request & { adminPayload?: Record<string, unknown> }).adminPayload;
    const actorEmail = typeof actor?.email === "string" ? actor.email : "unknown";
    log.info(
      `Flag ${result.created ? "saved" : "updated"} for ${result.record.name} (id=${result.record.id}) by ${actorEmail}`,
    );
    return res.json({ success: true, created: result.created, flag: result.record });
  });

  router.patch("/flags/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid flag id" });
    }
    const { imageUrl } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      return res.status(400).json({ error: "Missing imageUrl" });
    }
    const updated = db.updateFlagImage(id, imageUrl);
    if (!updated) {
      return res.status(404).json({ error: "Flag not found" });
    }
    return res.json({ success: true });
  });

  router.delete("/flags/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid flag id" });
    }

    const deleted = db.deleteFlagById(id);
    if (!deleted) {
      return res.status(404).json({ error: "Flag not found" });
    }
    const actor = (req as Request & { adminPayload?: Record<string, unknown> }).adminPayload;
    const actorEmail = typeof actor?.email === "string" ? actor.email : "unknown";
    log.info(`Flag deleted (id=${id}) by ${actorEmail}`);
    return res.json({ success: true });
  });

  router.get("/skins", (_req, res) => {
    return res.json({ skins: db.getSkins() });
  });

  router.post("/skins", (req, res) => {
    const { name, description, imageUrl } = req.body;
    if (!name || !description) {
      return res.status(400).json({ error: "Missing skin name or description" });
    }
    const result = db.saveSkin(
      String(name),
      String(description),
      typeof imageUrl === "string" ? imageUrl : undefined,
    );
    const actor = (req as Request & { adminPayload?: Record<string, unknown> }).adminPayload;
    const actorEmail = typeof actor?.email === "string" ? actor.email : "unknown";
    log.info(
      `Skin ${result.created ? "saved" : "updated"} for ${result.record.name} (id=${result.record.id}) by ${actorEmail}`,
    );
    return res.json({ success: true, created: result.created, skin: result.record });
  });

  router.patch("/skins/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid skin id" });
    }
    const { imageUrl } = req.body;
    if (!imageUrl || typeof imageUrl !== "string") {
      return res.status(400).json({ error: "Missing imageUrl" });
    }
    const updated = db.updateSkinImage(id, imageUrl);
    if (!updated) {
      return res.status(404).json({ error: "Skin not found" });
    }
    return res.json({ success: true });
  });

  router.delete("/skins/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid skin id" });
    }

    const deleted = db.deleteSkinById(id);
    if (!deleted) {
      return res.status(404).json({ error: "Skin not found" });
    }
    const actor = (req as Request & { adminPayload?: Record<string, unknown> }).adminPayload;
    const actorEmail = typeof actor?.email === "string" ? actor.email : "unknown";
    log.info(`Skin deleted (id=${id}) by ${actorEmail}`);
    return res.json({ success: true });
  });

  router.get("/news", (_req, res) => {
    return res.json({ news: db.getNews() });
  });

  router.post("/news", (req, res) => {
    const { title, description, url, imageUrl } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: "Missing news title or description" });
    }
    db.createNews(title, description, url, imageUrl);
    return res.json({ success: true });
  });

  router.delete("/news/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid news id" });
    }

    const deleted = db.deleteNewsById(id);
    if (!deleted) {
      return res.status(404).json({ error: "News item not found" });
    }
    return res.json({ success: true });
  });

  router.get("/maps", (_req, res) => {
    return res.json({ maps: db.getAdminMaps() });
  });

  router.post("/maps/validate", async (req, res) => {
    const rawMapUrl = typeof req.body?.mapUrl === "string" ? req.body.mapUrl : "";
    const mapUrl = rawMapUrl.trim();
    if (!mapUrl) {
      return res.status(400).json({ ok: false, error: "Map Data URL is required" });
    }

    try {
      const result = await validateMapDataUrl(mapUrl, req);
      if (!result.ok) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Map validation failed";
      return res.status(500).json({ ok: false, error: message });
    }
  });

  router.post("/maps/upload-files", async (req, res) => {
    const keyRaw = typeof req.body?.key === "string" ? req.body.key : "";
    const manifestJson =
      typeof req.body?.manifestJson === "string" ? req.body.manifestJson : "";
    const mapBinBase64 =
      typeof req.body?.mapBinBase64 === "string" ? req.body.mapBinBase64 : "";
    const map4xBinBase64 =
      typeof req.body?.map4xBinBase64 === "string"
        ? req.body.map4xBinBase64
        : "";
    const map16xBinBase64 =
      typeof req.body?.map16xBinBase64 === "string"
        ? req.body.map16xBinBase64
        : "";

    if (!keyRaw.trim()) {
      return res.status(400).json({ error: "Map key is required" });
    }
    if (!manifestJson.trim()) {
      return res.status(400).json({ error: "manifest.json content is required" });
    }
    if (!mapBinBase64 || !map4xBinBase64 || !map16xBinBase64) {
      return res.status(400).json({
        error: "All required files are needed: map.bin, map4x.bin, map16x.bin",
      });
    }

    let key: string;
    try {
      key = normalizeCustomMapKey(keyRaw);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid map key";
      return res.status(400).json({ error: message });
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestJson) as Record<string, unknown>;
    } catch {
      return res.status(400).json({ error: "manifest.json is not valid JSON" });
    }

    const hasManifestMeta =
      manifest &&
      typeof manifest === "object" &&
      manifest.map &&
      manifest.map4x &&
      manifest.map16x;
    if (!hasManifestMeta) {
      return res.status(400).json({
        error: "manifest.json must include map, map4x, and map16x metadata",
      });
    }

    const toBuffer = (value: string) => Buffer.from(value, "base64");
    const mapBin = toBuffer(mapBinBase64);
    const map4xBin = toBuffer(map4xBinBase64);
    const map16xBin = toBuffer(map16xBinBase64);

    if (mapBin.length === 0 || map4xBin.length === 0 || map16xBin.length === 0) {
      return res.status(400).json({
        error: "Uploaded map binary files cannot be empty",
      });
    }

    const MAX_BUNDLE_SIZE = 50 * 1024 * 1024;
    const totalSize =
      Buffer.byteLength(manifestJson, "utf8") +
      mapBin.length +
      map4xBin.length +
      map16xBin.length;
    if (totalSize > MAX_BUNDLE_SIZE) {
      return res.status(413).json({
        error: "Map bundle is too large (max 50 MB)",
      });
    }

    const result = writeCustomMapBundle({
      key,
      manifestJson,
      mapBin,
      map4xBin,
      map16xBin,
    });

    return res.json({
      success: true,
      key,
      mapUrl: result.mapBaseUrl,
    });
  });

  router.post("/maps", async (req, res) => {
    const { key, name, description, imageUrl, mapUrl, enabled } = req.body;
    if (!key || !name) {
      return res.status(400).json({ error: "Missing map key or name" });
    }

    const normalizedMapUrl = typeof mapUrl === "string" ? mapUrl.trim() : "";
    if (!normalizedMapUrl) {
      return res.status(400).json({ error: "Map Data URL is required" });
    }

    const validation = await validateMapDataUrl(normalizedMapUrl, req);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    db.createAdminMap({
      key: String(key),
      name: String(name),
      description: description ? String(description) : "",
      imageUrl: imageUrl ? String(imageUrl) : undefined,
      mapUrl: validation.normalizedBaseUrl,
      enabled: enabled !== false,
    });
    return res.json({
      success: true,
      validated: {
        manifestUrl: validation.manifestUrl,
        files: validation.files,
      },
    });
  });

  router.delete("/maps/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid map id" });
    }

    const deleted = db.deleteAdminMapById(id);
    if (!deleted) {
      return res.status(404).json({ error: "Map not found" });
    }
    return res.json({ success: true });
  });

  router.get("/shop-items", (_req, res) => {
    return res.json({ items: db.getAdminShopItems() });
  });

  router.post("/shop-items", (req, res) => {
    const {
      itemType,
      itemKey,
      title,
      description,
      softPrice,
      hardPrice,
      metadataJson,
      enabled,
    } = req.body;

    if (!itemType || !itemKey || !title) {
      return res.status(400).json({ error: "Missing itemType, itemKey or title" });
    }

    db.upsertAdminShopItem({
      itemType: String(itemType),
      itemKey: String(itemKey),
      title: String(title),
      description: description ? String(description) : "",
      softPrice:
        softPrice === undefined || softPrice === null
          ? null
          : Number(softPrice),
      hardPrice:
        hardPrice === undefined || hardPrice === null
          ? null
          : Number(hardPrice),
      metadataJson: metadataJson ? String(metadataJson) : null,
      enabled: enabled !== false,
    });
    return res.json({ success: true });
  });

  router.delete("/shop-items/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid shop item id" });
    }

    const deleted = db.deleteAdminShopItemById(id);
    if (!deleted) {
      return res.status(404).json({ error: "Shop item not found" });
    }
    return res.json({ success: true });
  });

  // ── Image Upload (admin-only, base64 JSON body) ──────────────────────────
  router.post("/upload-image", (req, res) => {
    const { data, contentType, filename } = req.body as {
      data?: string;
      contentType?: string;
      filename?: string;
    };

    if (!data || typeof data !== "string") {
      return res.status(400).json({ error: "Missing base64 image data" });
    }

    const allowedTypes = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ];
    const ct = allowedTypes.includes(contentType ?? "")
      ? contentType!
      : "image/png";

    // Strip optional data-URL prefix
    const raw = data.replace(/^data:[^;]+;base64,/, "");
    const buf = Buffer.from(raw, "base64");

    const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
    if (buf.length > MAX_SIZE) {
      return res.status(413).json({ error: "Image too large (max 5 MB)" });
    }

    const id = crypto.randomUUID();
    db.saveImage(id, ct, buf);

    const url = `/api/images/${id}`;
    return res.json({ success: true, id, url });
  });

  app.use("/api/admin", router);
}

// ── Public image serving (no auth required) ────────────────────────────────
export function registerImageServeRoutes(app: Router, db: AuthDatabase) {
  app.get("/api/images/:id", (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return res.status(400).json({ error: "Invalid image id" });
    }

    const image = db.getImage(id);
    if (!image) {
      return res.status(404).json({ error: "Image not found" });
    }

    res.setHeader("Content-Type", image.contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    return res.status(200).send(image.data);
  });
}
