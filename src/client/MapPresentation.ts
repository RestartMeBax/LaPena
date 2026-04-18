import { assetUrl } from "../core/AssetUrls";
import { getPublicAdminMaps } from "./Api";
import { terrainMapFileLoader } from "./TerrainMapFileLoader";
import { getMapName } from "./Utils";

export type MapPresentation = {
  key: string;
  name: string;
  imageUrl: string;
  aspectRatio?: number;
};

export async function resolveMapPresentation(
  gameMap: string,
): Promise<MapPresentation> {
  const fallbackName = getMapName(gameMap) ?? gameMap;
  const fallbackImageUrl = assetUrl("images/Favicon.svg");

  try {
    const adminMaps = await getPublicAdminMaps();
    const customMap = adminMaps.find((map) => map.enabled && map.key === gameMap);
    if (customMap) {
      let aspectRatio: number | undefined;
      try {
        const manifest = await terrainMapFileLoader.getMapData(gameMap).manifest();
        if (manifest?.map?.width && manifest?.map?.height) {
          aspectRatio = manifest.map.width / manifest.map.height;
        }
      } catch {
        aspectRatio = undefined;
      }

      return {
        key: gameMap,
        name: customMap.name || fallbackName,
        imageUrl: customMap.imageUrl || fallbackImageUrl,
        aspectRatio,
      };
    }
  } catch {
    // Fall through to built-in resolution.
  }

  try {
    const data = terrainMapFileLoader.getMapData(gameMap);
    let aspectRatio: number | undefined;
    try {
      const manifest = await data.manifest();
      if (manifest?.map?.width && manifest?.map?.height) {
        aspectRatio = manifest.map.width / manifest.map.height;
      }
    } catch {
      aspectRatio = undefined;
    }

    return {
      key: gameMap,
      name: fallbackName,
      imageUrl: data.webpPath || fallbackImageUrl,
      aspectRatio,
    };
  } catch {
    return {
      key: gameMap,
      name: fallbackName,
      imageUrl: fallbackImageUrl,
      aspectRatio: undefined,
    };
  }
}