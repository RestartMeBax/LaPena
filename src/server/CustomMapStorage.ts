import fs from "fs";
import path from "path";

const MAP_KEY_REGEX = /^[a-z0-9_-]{1,64}$/;

function resolveAuthDataDir(): string {
  const preferredDataDir =
    process.env.AUTH_DB_DIR?.trim() || path.join(process.cwd(), "data");

  try {
    fs.mkdirSync(preferredDataDir, { recursive: true });
    return preferredDataDir;
  } catch {
    const fallbackDataDir = path.join("/tmp", "openfront-data");
    fs.mkdirSync(fallbackDataDir, { recursive: true });
    return fallbackDataDir;
  }
}

export function getCustomMapsDir(): string {
  const customMapsDir = path.join(resolveAuthDataDir(), "maps");
  fs.mkdirSync(customMapsDir, { recursive: true });
  return customMapsDir;
}

export function normalizeCustomMapKey(rawKey: string): string {
  const key = rawKey.trim().toLowerCase();
  if (!MAP_KEY_REGEX.test(key)) {
    throw new Error(
      "Invalid map key. Use only lowercase letters, numbers, underscore, and dash.",
    );
  }
  return key;
}

function customMapDirForKey(key: string): string {
  return path.join(getCustomMapsDir(), key);
}

export function writeCustomMapBundle(input: {
  key: string;
  manifestJson: string;
  mapBin: Buffer;
  map4xBin: Buffer;
  map16xBin: Buffer;
}): { mapBaseUrl: string } {
  const key = normalizeCustomMapKey(input.key);
  const mapDir = customMapDirForKey(key);
  fs.mkdirSync(mapDir, { recursive: true });

  fs.writeFileSync(path.join(mapDir, "manifest.json"), input.manifestJson, "utf8");
  fs.writeFileSync(path.join(mapDir, "map.bin"), input.mapBin);
  fs.writeFileSync(path.join(mapDir, "map4x.bin"), input.map4xBin);
  fs.writeFileSync(path.join(mapDir, "map16x.bin"), input.map16xBin);

  return {
    mapBaseUrl: `/maps/${key}`,
  };
}
