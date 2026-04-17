import { Request, Response, Router } from "express";
import crypto from "crypto";
import { AuthDatabase } from "./AuthDatabase";
import { verifyAuthToken } from "./AuthJwt";

const OWNER_ADMIN_EMAILS = new Set(
  [
    "ludovickjeux@gmail.com",
    ...(process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  ],
);

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

async function requireAdmin(
  req: Request,
  res: Response,
  next: () => void,
): Promise<void> {
  const token = parseBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const payload = await verifyAuthToken(token, req);
    if (!isAdminPayload(payload)) {
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
        isAdmin: isAdminPayload(payload),
        email,
        roles,
      });
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  });

  router.use(requireAdmin);

  router.get("/admins", (_req, res) => {
    const admins = db.getUsersByRole("admin").map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      createdAt: user.createdAt,
    }));
    return res.json({ admins });
  });

  router.post("/admins/grant", (req, res) => {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!email) {
      return res.status(400).json({ error: "Missing user email" });
    }

    const updated = db.grantRoleByEmail(email, "admin");
    if (!updated) {
      return res.status(404).json({
        error: "User not found. Ask them to sign up first, then grant admin.",
      });
    }

    return res.json({
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        roles: updated.roles,
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
    db.createFlag(name, description, imageUrl);
    return res.json({ success: true });
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
    db.createSkin(name, description, imageUrl);
    return res.json({ success: true });
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

  router.post("/maps", (req, res) => {
    const { key, name, description, imageUrl, mapUrl, enabled } = req.body;
    if (!key || !name) {
      return res.status(400).json({ error: "Missing map key or name" });
    }
    db.createAdminMap({
      key: String(key),
      name: String(name),
      description: description ? String(description) : "",
      imageUrl: imageUrl ? String(imageUrl) : undefined,
      mapUrl: mapUrl ? String(mapUrl) : undefined,
      enabled: enabled !== false,
    });
    return res.json({ success: true });
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
