# RenderWolf Slots Studio → slot asset bridge (prototype)

A small **offline import plugin** for game-art exports from [RenderWolf Slots Studio](https://slots.renderwolf.ai/). It helps a slot-building pipeline consume **your own legally exported assets** without mixing artistic assets with casino math or RGS settlement.

**Important:** RenderWolf's main site advertises APIs for some image-processing workflows, but no public Slots Studio generation-job contract was verified for this implementation. This bridge **does not** attempt unofficial network calls, browser scraping, cookie extraction, or invented endpoints. It imports ZIPs/folders exported by RenderWolf, then creates a stable manifest for PixiJS. An API adapter can be added later **only against official documentation/access**.

## What works now

- Imports a directory or ZIP containing PNG, JPEG, WebP, GIF, PSD, MP4, WebM, WAV or OGG.
- Supports an explicit role map: symbols, characters, backgrounds, frames, effects, animations, audio.
- Copies recognized media files to a new directory with stable relative paths.
- Writes versioned JSON with IDs, roles, URL, SHA-256, byte sizes, media type, and PNG dimensions.
- Safety: no archive traversal/symlinks, no overwrite, size limits, media signatures and rollback.
- Provides a tiny browser adapter for PixiJS aliases.
- Does NOT call RenderWolf or spend credits.

## Run (Python 3.10+, zero dependencies)

From this repository:

    python3 tools/renderwolf_bridge.py \
      --input /path/to/RenderWolf-export.zip \
      --out /your-slot-project/public/frost-ascent/renderwolf \
      --game frost-ascent

The output directory must **not exist**; this protects existing artwork. Output includes a manifest.json and an assets directory preserving original media paths.

Without a role map, each file receives a stable ID and the role "unassigned" so nothing is silently interpreted as a WILD or SCATTER.

For explicit mapping, copy and edit examples/renderwolf-map.example.json so source paths **exactly match your export**, then run:

    python3 tools/renderwolf_bridge.py \
      --input /path/to/RenderWolf-export.zip \
      --out /your-slot-project/public/frost-ascent/renderwolf \
      --game frost-ascent \
      --map /path/to/your-map.json

The example map contains **illustrative filenames**, not verified names from your account. Use a new output directory to retry.

## PixiJS integration

The importer emits a manifest under /frost-ascent/renderwolf/manifest.json. A frontend can import the accompanying tools/renderwolf_manifest.mjs helper:

    import { Assets } from "pixi.js";
    import {
      loadRenderwolfManifest, pixiAssetAliases,
    } from "./tools/renderwolf_manifest.mjs";

    const manifest = await loadRenderwolfManifest(
      "/frost-ascent/renderwolf/manifest.json"
    );
    const aliases = pixiAssetAliases(manifest);
    for (const { alias, src } of aliases) Assets.add({ alias, src });
    await Assets.load(aliases.map((item) => item.alias));

**Never** derive win amounts, stops, multipliers or RGS behavior from the asset manifest. Those remain authoritative in the Stake math books.

## Tests

    python3 -m unittest discover -s tests -p 'test_renderwolf_bridge.py' -v
    node --test tests/test_renderwolf_manifest.mjs

GitHub Actions runs the same tests on proposed PRs. Tests use fabricated image bytes; no credentials, credits or RenderWolf access needed.

## Integration with local Frost Ascent

The playable slot currently lives in the local WSL stake-slot-studio Builder worktree. **This GitHub repository does not mirror those files.** The importer is not automatically present in the Dev Container.

1. Review the plugin PR.
2. Have Builder copy the bridge into an appropriate tools directory under Builder ownership; never change agent permissions.
3. Manually export media from RenderWolf and import into a fresh staging/public directory.
4. Review asset roles and PixiJS aliases before linking them to the game's rendering.
5. Test video alpha/transparency, playback, performance, media decoders and asset licences.

No proprietary images, export bundles or secrets belong in the public repository.

## Future official API integration

If RenderWolf supplies a documented Slots Studio API, add a separate server-side provider adapter for official create-job/status/download operations, credentials, rate limiting, credit ceilings, error handling and user authorization. Reuse the current exporter/manifest code for the finished assets.

**Avoid confusing RenderWolf Slots Studio with Ironfang Render, formerly branded Renderwolf: different service.**

## Status

Prototype code submitted for review. Automated test status and real integration into WSL must be independently verified. No live API calls were made.
