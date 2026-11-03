import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assetById, pixiAssetAliases, loadRenderwolfManifest,
} from "../tools/renderwolf_manifest.mjs";

const manifest = {
  schemaVersion: 1,
  provider: "renderwolf-slots-studio-export",
  gameId: "frost-ascent",
  assets: [
    { id: "character.yeti", role: "character",
      url: "/frost-ascent/renderwolf/assets/yeti.png" },
    { id: "asset-unnamed", role: "unassigned",
      url: "/frost-ascent/renderwolf/assets/unknown.png" },
  ],
};

test("lookup a mapped character", () => {
  assert.equal(assetById(manifest, "character.yeti").role, "character");
  assert.throws(() => assetById(manifest, "missing"), /Missing/);
});

test("PixiJS aliases exclude unmapped assets by default", () => {
  assert.deepEqual(pixiAssetAliases(manifest), [
    { alias: "character.yeti", src: "/frost-ascent/renderwolf/assets/yeti.png" },
  ]);
  assert.equal(pixiAssetAliases(manifest, { includeUnassigned: true }).length, 2);
});

test("load manifest using an injected same-origin fetch", async () => {
  const calls = [];
  const result = await loadRenderwolfManifest(
    "/frost-ascent/renderwolf/manifest.json",
    async (path, opts) => {
      calls.push([path, opts]);
      return { ok: true, json: async () => manifest };
    },
  );
  assert.equal(result.gameId, "frost-ascent");
  assert.equal(calls[0][1].credentials, "same-origin");
});

test("reject hostile manifest paths", () => {
  const hostile = structuredClone(manifest);
  hostile.assets[0].url = "https://other-site.test/steal";
  assert.throws(() => pixiAssetAliases(hostile), /Invalid/);
  assert.throws(() => loadRenderwolfManifest("https://elsewhere.test/manifest"), /same-origin/);
});

test("reject duplicate asset identifiers", () => {
  const bad = structuredClone(manifest);
  bad.assets[1].id = "character.yeti";
  assert.throws(() => pixiAssetAliases(bad), /Invalid/);
});
