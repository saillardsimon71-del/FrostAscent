/**
 * Browser-side consumer for the offline RenderWolf Slots Studio export manifest.
 * Nothing here calls an undocumented RenderWolf generation endpoint.
 */
function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 ||
      manifest.provider !== "renderwolf-slots-studio-export" ||
      !Array.isArray(manifest.assets)) {
    throw new TypeError("Unsupported RenderWolf asset manifest");
  }
  const ids = new Set();
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.id !== "string" || !asset.id ||
        ids.has(asset.id) || typeof asset.url !== "string" ||
        !asset.url.startsWith("/" + manifest.gameId + "/renderwolf/assets/") ||
        asset.url.includes("..") || asset.url.includes("\\") ||
        asset.url.includes("?") || asset.url.includes("#")) {
      throw new TypeError("Invalid, duplicated, or unsafe asset URL/ID");
    }
    ids.add(asset.id);
  }
  return manifest;
}

export function assetById(manifest, id) {
  validateManifest(manifest);
  const asset = manifest.assets.find((item) => item.id === id);
  if (!asset) throw new Error("Missing RenderWolf asset: " + id);
  return asset;
}

/** Alias descriptors usable with PixiJS Assets.load / Assets.add. */
export function pixiAssetAliases(manifest, { includeUnassigned = false } = {}) {
  validateManifest(manifest);
  return manifest.assets
    .filter((a) => includeUnassigned || a.role !== "unassigned")
    .map(({ id, url }) => ({ alias: id, src: url }));
}

export async function loadRenderwolfManifest(
  url,
  fetchImpl = globalThis.fetch,
) {
  if (typeof url !== "string" || !/^\/[a-z][a-z0-9-]*\/renderwolf\/manifest\.json$/.test(url)) {
    throw new TypeError("Use a same-origin game-specific RenderWolf manifest path");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch implementation is required");
  }
  const response = await fetchImpl(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Manifest HTTP " + response.status);
  return validateManifest(await response.json());
}
