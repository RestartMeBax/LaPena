import { Router } from "express";
import { AuthDatabase } from "./AuthDatabase";
import { verifyAuthToken } from "./AuthJwt";
import { normalizeCosmeticKey } from "./CosmeticKey";

function parseBearerToken(authHeader: string | string[] | undefined): string | null {
  if (!authHeader) return null;
  const raw = Array.isArray(authHeader) ? authHeader[0] : String(authHeader);
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export function registerShopRoutes(app: Router, db: AuthDatabase): void {
  const router = Router();

  /**
   * POST /api/shop/purchase
   * Body: { cosmeticType, cosmeticName, currencyType, colorPaletteName? }
   */
  router.post("/purchase", async (req, res) => {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    let payload: Record<string, unknown>;
    try {
      payload = await verifyAuthToken(token, req);
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const userSub = typeof payload.sub === "string" ? payload.sub : null;
    if (!userSub) {
      return res.status(401).json({ error: "Invalid token: missing sub" });
    }

    const { cosmeticType, cosmeticName, currencyType, colorPaletteName } = req.body as {
      cosmeticType?: string;
      cosmeticName?: string;
      currencyType?: string;
      colorPaletteName?: string;
    };

    if (
      !cosmeticType ||
      !cosmeticName ||
      (currencyType !== "soft" && currencyType !== "hard")
    ) {
      return res.status(400).json({ error: "Missing cosmeticType, cosmeticName or currencyType" });
    }

    if (
      cosmeticType !== "flag" &&
      cosmeticType !== "skin" &&
      cosmeticType !== "pattern"
    ) {
      return res.status(400).json({ error: "cosmeticType must be flag, skin, or pattern" });
    }

    const key = normalizeCosmeticKey(cosmeticName);

    // Look up price from active shop items.
    // Skins are displayed as patterns client-side, so pattern purchases
    // should match either `pattern` or legacy/admin `skin` item types.
    const allowedItemTypes =
      cosmeticType === "flag"
        ? ["flag"]
        : cosmeticType === "skin"
          ? ["skin", "pattern"]
          : ["pattern", "skin"];
    const shopItems = db.getAdminShopItems().filter((i) => i.enabled);
    const shopItem = shopItems.find(
      (i) =>
        allowedItemTypes.includes(i.itemType) &&
        normalizeCosmeticKey(i.itemKey) === key,
    );

    if (!shopItem) {
      return res.status(404).json({ error: "Item not found in shop" });
    }

    const price =
      currencyType === "soft"
        ? (shopItem.softPrice ?? 0)
        : (shopItem.hardPrice ?? 0);

    if (price < 0) {
      return res
        .status(400)
        .json({ error: `Item cannot be purchased with ${currencyType} currency` });
    }

    // Determine which flare to grant.
    // Patterns/skins can be palette-specific in join validation.
    const normalizedPaletteName =
      typeof colorPaletteName === "string" && colorPaletteName.trim().length > 0
        ? colorPaletteName.trim()
        : null;
    const flareName =
      cosmeticType === "flag"
        ? `flag:${key}`
        : normalizedPaletteName
          ? `pattern:${key}:${normalizedPaletteName}`
          : `pattern:${key}`;
    const ownershipCandidates =
      cosmeticType === "flag"
        ? [flareName]
        : normalizedPaletteName
          ? [flareName, `pattern:${key}`]
          : [flareName];

    // Already owned?
    if (ownershipCandidates.some((candidate) => db.hasFlare(userSub, candidate))) {
      return res.json({ success: true, alreadyOwned: true });
    }

    // Spend currency (atomic; fails if balance insufficient)
    if (price > 0) {
      const spent = db.spendCurrency(userSub, currencyType, price);
      if (!spent) {
        return res.status(402).json({ error: "Insufficient currency" });
      }
    }

    // Grant the flare
    db.grantFlare(userSub, flareName);

    return res.json({ success: true });
  });

  /**
   * POST /api/shop/inventory/delete
   * Body: { cosmeticType, cosmeticName, colorPaletteName? }
   */
  router.post("/inventory/delete", async (req, res) => {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    let payload: Record<string, unknown>;
    try {
      payload = await verifyAuthToken(token, req);
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }

    const userSub = typeof payload.sub === "string" ? payload.sub : null;
    if (!userSub) {
      return res.status(401).json({ error: "Invalid token: missing sub" });
    }

    const { cosmeticType, cosmeticName, colorPaletteName } = req.body as {
      cosmeticType?: string;
      cosmeticName?: string;
      colorPaletteName?: string;
    };

    if (!cosmeticType || !cosmeticName) {
      return res.status(400).json({ error: "Missing cosmeticType or cosmeticName" });
    }

    if (
      cosmeticType !== "flag" &&
      cosmeticType !== "skin" &&
      cosmeticType !== "pattern"
    ) {
      return res.status(400).json({ error: "cosmeticType must be flag, skin, or pattern" });
    }

    const key = normalizeCosmeticKey(cosmeticName);
    const normalizedPaletteName =
      typeof colorPaletteName === "string" && colorPaletteName.trim().length > 0
        ? colorPaletteName.trim()
        : null;

    let removed = 0;
    if (cosmeticType === "flag") {
      const flare = `flag:${key}`;
      if (db.revokeFlare(userSub, flare)) {
        removed += 1;
      }
    } else {
      const base = `pattern:${key}`;
      const flares = db.getUserFlares(userSub);

      if (normalizedPaletteName) {
        const exact = `${base}:${normalizedPaletteName}`;
        if (db.revokeFlare(userSub, exact)) {
          removed += 1;
        }
      } else {
        // Delete the base pattern and all owned palette variants for this pattern.
        for (const flare of flares) {
          if (flare === base || flare.startsWith(`${base}:`)) {
            if (db.revokeFlare(userSub, flare)) {
              removed += 1;
            }
          }
        }
      }
    }

    return res.json({ success: true, removed });
  });

  app.use("/api/shop", router);
  app.use("/shop", router);
}
