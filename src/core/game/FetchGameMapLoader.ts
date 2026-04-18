import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";

type AdminPublicMapRecord = {
  key: string;
  name: string;
  imageUrl: string | null;
  mapUrl: string | null;
  enabled: boolean;
};

let adminPublicMapsPromise: Promise<AdminPublicMapRecord[]> | null = null;

function isBuiltInMap(map: string): map is GameMapType {
  return Object.values(GameMapType).includes(map as GameMapType);
}

async function getAdminPublicMaps(): Promise<AdminPublicMapRecord[]> {
  adminPublicMapsPromise ??= (async () => {
    try {
      const response = await fetch("/api/admin/public/maps", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as { maps?: AdminPublicMapRecord[] };
      return Array.isArray(body.maps) ? body.maps : [];
    } catch {
      return [];
    }
  })();

  return adminPublicMapsPromise;
}

function toCustomMapBaseUrl(mapUrl: string): string {
  const trimmed = mapUrl.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/manifest.json")
    ? trimmed.slice(0, -"/manifest.json".length)
    : trimmed;
}

export class FetchGameMapLoader implements GameMapLoader {
  private maps: Map<string, MapData>;

  public constructor(
    private readonly pathResolver: string | ((path: string) => string),
  ) {
    this.maps = new Map<string, MapData>();
  }

  public getMapData(map: GameMapType | string): MapData {
    const cachedMap = this.maps.get(map);
    if (cachedMap) {
      return cachedMap;
    }

    if (!isBuiltInMap(map)) {
      const customMapData = this.createCustomMapData(map);
      this.maps.set(map, customMapData);
      return customMapData;
    }

    const key = Object.keys(GameMapType).find(
      (k) => GameMapType[k as keyof typeof GameMapType] === map,
    );
    const fileName = key?.toLowerCase();

    if (!fileName) {
      throw new Error(`Unknown map: ${map}`);
    }

    const mapData = {
      mapBin: () => this.loadBinaryFromUrl(this.url(fileName, "map.bin")),
      map4xBin: () => this.loadBinaryFromUrl(this.url(fileName, "map4x.bin")),
      map16xBin: () => this.loadBinaryFromUrl(this.url(fileName, "map16x.bin")),
      manifest: () => this.loadJsonFromUrl(this.url(fileName, "manifest.json")),
      webpPath: this.url(fileName, "thumbnail.webp"),
    } satisfies MapData;

    this.maps.set(map, mapData);
    return mapData;
  }

  private createCustomMapData(map: string): MapData {
    const customMapPromise = getAdminPublicMaps().then((maps) => {
      const customMap = maps.find((entry) => entry.enabled && entry.key === map);
      if (!customMap || !customMap.mapUrl) {
        throw new Error(`Unknown custom map: ${map}`);
      }
      return customMap;
    });

    const manifestUrl = customMapPromise.then((customMap) => {
      const baseUrl = toCustomMapBaseUrl(customMap.mapUrl as string);
      return `${baseUrl}/manifest.json`;
    });

    const fileUrl = (fileName: string) =>
      customMapPromise.then((customMap) => {
        const baseUrl = toCustomMapBaseUrl(customMap.mapUrl as string);
        return `${baseUrl}/${fileName}`;
      });

    return {
      mapBin: async () => this.loadBinaryFromUrl(await fileUrl("map.bin")),
      map4xBin: async () => this.loadBinaryFromUrl(await fileUrl("map4x.bin")),
      map16xBin: async () => this.loadBinaryFromUrl(await fileUrl("map16x.bin")),
      manifest: async () => this.loadJsonFromUrl(await manifestUrl),
      webpPath: "/images/Favicon.svg",
    } satisfies MapData;
  }

  private resolveUrl(path: string): string {
    if (typeof this.pathResolver === "function") {
      return this.pathResolver(path);
    }
    return `${this.pathResolver}/${path}`;
  }

  private url(map: string, path: string) {
    return this.resolveUrl(`${map}/${path}`);
  }

  private async loadBinaryFromUrl(url: string) {
    const startTime = performance.now();
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }

    const data = await response.arrayBuffer();
    console.log(
      `[MapLoader] ${url}: ${(performance.now() - startTime).toFixed(0)}ms`,
    );
    return new Uint8Array(data);
  }

  private async loadJsonFromUrl(url: string) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.statusText}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const text = await response.text();

    if (contentType.includes("text/html") || text.trimStart().startsWith("<!doctype") || text.trimStart().startsWith("<html")) {
      throw new Error(
        `Map manifest URL returned HTML instead of JSON: ${url}. Check custom map Map Data URL points to a folder with manifest.json, map.bin, map4x.bin, and map16x.bin.`,
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON at ${url}`);
    }
  }
}
