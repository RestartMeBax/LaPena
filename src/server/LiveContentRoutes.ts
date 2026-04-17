import { Router } from "express";
import fs from "fs";
import path from "path";
import { AuthDatabase, AdminMapRecord } from "./AuthDatabase";
import { normalizeCosmeticKey } from "./CosmeticKey";
import { setNoStoreHeaders } from "./NoStoreHeaders";

type LiveNewsItem = {
  id: string;
  title: string;
  description: string;
  url?: string | null;
  type: "tournament" | "tutorial" | "announcement" | string;
};

type LiveColorPalette = {
  name: string;
  primaryColor: string;
  secondaryColor: string;
};

type LivePattern = {
  name: string;
  affiliateCode: string | null;
  product: null;
  priceSoft?: number;
  priceHard?: number;
  artist?: string;
  rarity: string;
  pattern: string;
  colorPalettes?: { name: string; isArchived: boolean }[];
  url?: string;
};

type LiveFlag = {
  name: string;
  affiliateCode: string | null;
  product: null;
  priceSoft?: number;
  priceHard?: number;
  artist?: string;
  rarity: string;
  url: string;
};

type LivePack = {
  name: string;
  affiliateCode: string | null;
  product: null;
  priceSoft?: number;
  priceHard?: number;
  artist?: string;
  rarity: string;
  displayName: string;
  currency: "hard" | "soft";
  amount: number;
};

type LiveCosmetics = {
  colorPalettes?: Record<string, LiveColorPalette>;
  patterns: Record<string, LivePattern>;
  flags: Record<string, LiveFlag>;
  currencyPacks?: Record<string, LivePack>;
};

const ADMIN_DEFAULT_PALETTE = "admin_default";
const ADMIN_DEFAULT_PATTERN_DATA = "AAAAAA";

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toProxyImageUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const val = raw.trim();
  if (!val) return undefined;

  if (val.startsWith("/api/assets/image-proxy")) {
    return val;
  }

  if (val.startsWith("http://") || val.startsWith("https://")) {
    return `/api/assets/image-proxy?url=${encodeURIComponent(val)}`;
  }

  return val;
}

function buildBaseCosmetics(): LiveCosmetics {
  const fromStatic = readJsonFile<LiveCosmetics>(
    path.join(process.cwd(), "static", "cosmetics.json"),
  );
  if (fromStatic) {
    return fromStatic;
  }

  const fromResourcesRoot = readJsonFile<LiveCosmetics>(
    path.join(process.cwd(), "resources", "cosmetics.json"),
  );
  if (fromResourcesRoot) {
    return fromResourcesRoot;
  }

  const fromResourcesNested = readJsonFile<LiveCosmetics>(
    path.join(process.cwd(), "resources", "cosmetics", "cosmetics.json"),
  );
  if (fromResourcesNested) {
    return fromResourcesNested;
  }

  return {
    colorPalettes: {
      [ADMIN_DEFAULT_PALETTE]: {
        name: "Admin Default",
        primaryColor: "#4fb8ff",
        secondaryColor: "#0f3154",
      },
    },
    patterns: {},
    flags: {},
    currencyPacks: {},
  };
}

export function mergeAdminCosmetics(db: AuthDatabase): LiveCosmetics {
  const merged = buildBaseCosmetics();
  merged.colorPalettes ??= {};
  merged.patterns ??= {};
  merged.flags ??= {};
  merged.currencyPacks ??= {};

  if (!merged.colorPalettes[ADMIN_DEFAULT_PALETTE]) {
    merged.colorPalettes[ADMIN_DEFAULT_PALETTE] = {
      name: "Admin Default",
      primaryColor: "#4fb8ff",
      secondaryColor: "#0f3154",
    };
  }

  for (const skin of db.getSkins()) {
    const key = normalizeCosmeticKey(skin.name);
    const existing = merged.patterns[key];
    merged.patterns[key] = {
      name: key,
      affiliateCode: existing?.affiliateCode ?? null,
      product: null,
      priceSoft: existing?.priceSoft ?? 0,
      priceHard: existing?.priceHard,
      artist: existing?.artist,
      rarity: existing?.rarity ?? "common",
      pattern: existing?.pattern ?? ADMIN_DEFAULT_PATTERN_DATA,
      colorPalettes:
        existing?.colorPalettes && existing.colorPalettes.length > 0
          ? existing.colorPalettes
          : [{ name: ADMIN_DEFAULT_PALETTE, isArchived: false }],
      url: skin.imageUrl ?? existing?.url,
    };
  }

  for (const flag of db.getFlags()) {
    const key = normalizeCosmeticKey(flag.name);
    const existing = merged.flags[key];
    merged.flags[key] = {
      name: key,
      affiliateCode: existing?.affiliateCode ?? null,
      product: null,
      priceSoft: existing?.priceSoft ?? 0,
      priceHard: existing?.priceHard,
      artist: existing?.artist,
      rarity: existing?.rarity ?? "common",
      url: flag.imageUrl ?? existing?.url ?? "/images/Favicon.svg",
    };
  }

  for (const item of db.getAdminShopItems()) {
    if (!item.enabled) continue;
    const key = normalizeCosmeticKey(item.itemKey);
    const metadata = parseMetadata(item.metadataJson);

    if (item.itemType === "pattern" || item.itemType === "skin") {
      const existing = merged.patterns[key];
      const paletteName =
        typeof metadata.paletteName === "string"
          ? metadata.paletteName
          : ADMIN_DEFAULT_PALETTE;
      const softPrice =
        item.softPrice ?? (item.hardPrice === null ? 0 : undefined);
      const hardPrice = item.hardPrice ?? undefined;

      merged.patterns[key] = {
        name: key,
        affiliateCode: existing?.affiliateCode ?? null,
        product: null,
        priceSoft: softPrice,
        priceHard: hardPrice,
        artist:
          typeof metadata.artist === "string"
            ? metadata.artist
            : existing?.artist,
        rarity:
          typeof metadata.rarity === "string"
            ? metadata.rarity
            : existing?.rarity ?? "common",
        pattern:
          typeof metadata.patternData === "string"
            ? metadata.patternData
            : existing?.pattern ?? ADMIN_DEFAULT_PATTERN_DATA,
        colorPalettes:
          existing?.colorPalettes && existing.colorPalettes.length > 0
            ? existing.colorPalettes
            : [{ name: paletteName, isArchived: false }],
      url:
          typeof metadata.imageUrl === "string" && metadata.imageUrl
            ? metadata.imageUrl
            : typeof metadata.url === "string" && metadata.url
              ? metadata.url
              : existing?.url,
      };
      continue;
    }

    if (item.itemType === "flag") {
      const existing = merged.flags[key];
      const softPrice =
        item.softPrice ?? (item.hardPrice === null ? 0 : undefined);
      const hardPrice = item.hardPrice ?? undefined;
      merged.flags[key] = {
        name: key,
        affiliateCode: existing?.affiliateCode ?? null,
        product: null,
        priceSoft: softPrice,
        priceHard: hardPrice,
        artist:
          typeof metadata.artist === "string"
            ? metadata.artist
            : existing?.artist,
        rarity:
          typeof metadata.rarity === "string"
            ? metadata.rarity
            : existing?.rarity ?? "common",
        url:
          typeof metadata.url === "string"
            ? metadata.url
            : typeof metadata.imageUrl === "string"
              ? metadata.imageUrl
               : existing?.url ?? "",
      };
      continue;
    }

    if (item.itemType === "pack") {
      const currency =
        metadata.currency === "soft" || metadata.currency === "hard"
          ? metadata.currency
          : "hard";
      const amount =
        typeof metadata.amount === "number" && Number.isFinite(metadata.amount)
          ? Math.max(1, Math.floor(metadata.amount))
          : 100;
      const softPrice =
        item.softPrice ?? (item.hardPrice === null ? 0 : undefined);
      const hardPrice = item.hardPrice ?? undefined;
      merged.currencyPacks![key] = {
        name: key,
        affiliateCode: null,
        product: null,
        priceSoft: softPrice,
        priceHard: hardPrice,
        artist:
          typeof metadata.artist === "string" ? metadata.artist : undefined,
        rarity:
          typeof metadata.rarity === "string" ? metadata.rarity : "common",
        displayName:
          typeof metadata.displayName === "string"
            ? metadata.displayName
            : item.title,
        currency,
        amount,
      };
    }
  }

  for (const pattern of Object.values(merged.patterns)) {
    pattern.url = toProxyImageUrl(pattern.url);
  }

  for (const flag of Object.values(merged.flags)) {
    flag.url = toProxyImageUrl(flag.url) ?? flag.url;
  }

  return merged;
}

function buildNews(db: AuthDatabase): LiveNewsItem[] {
  const staticNews =
    readJsonFile<LiveNewsItem[]>(path.join(process.cwd(), "resources", "news.json")) ??
    [];

  const dynamic = db.getNews().map((n) => ({
    id: `db-${n.id}`,
    title: n.title,
    description: n.description,
    url: n.url,
    type: "announcement" as const,
  }));

  const merged = [...dynamic, ...staticNews];

  // Keep first item per id and preserve order.
  const seen = new Set<string>();
  const unique: LiveNewsItem[] = [];
  for (const item of merged) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

function mapToPublicPayload(map: AdminMapRecord) {
  return {
    id: map.id,
    key: map.key,
    name: map.name,
    description: map.description,
    imageUrl: map.imageUrl,
    mapUrl: map.mapUrl,
    enabled: map.enabled,
  };
}

export function registerLiveContentRoutes(app: Router, db: AuthDatabase): void {
  app.get("/cosmetics.json", (_req, res) => {
    setNoStoreHeaders(res);
    res.json(mergeAdminCosmetics(db));
  });

  app.get("/news.json", (_req, res) => {
    setNoStoreHeaders(res);
    res.json(buildNews(db));
  });

  app.get("/api/admin/public/maps", (_req, res) => {
    setNoStoreHeaders(res);
    const maps = db.getAdminMaps().filter((m) => m.enabled).map(mapToPublicPayload);
    res.json({ maps });
  });
}
