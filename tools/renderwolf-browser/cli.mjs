#!/usr/bin/env node
/**
 * One-job-at-a-time Chromium connector for RenderWolf Slots Studio.
 * No CAPTCHA bypass, no private endpoints, no credential scraping, no retries.
 * CSS/role selectors are supplied after inspecting the actual user interface.
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  parseArgs, loadConfig, HOME_PROFILE,
  preparePrivateProfile, ensureNewExportDir,
  safeFilename, writeMetadata,
} from "./core.mjs";

function required(config, key) {
  const selector = config.selectors[key];
  if (!selector) throw new Error("Missing selector '" + key + "' in config");
  return selector;
}

async function snapshot(page, outputDir, name) {
  if (outputDir) await page.screenshot({
    path: path.join(outputDir, name), fullPage: false, timeout: 20000,
  });
}

async function inspect(page) {
  const rows = await page.locator("input,textarea,button,[role=button],[contenteditable=true]")
    .evaluateAll((nodes) => nodes.slice(0, 120).map((n) => ({
      tag: n.tagName.toLowerCase(),
      type: n.getAttribute("type"),
      label: n.getAttribute("aria-label"),
      placeholder: n.getAttribute("placeholder"),
      text: (n.innerText || n.textContent || "").trim().slice(0, 100),
    })));
  // Never print form values, browser cookies or session tokens.
  console.log(JSON.stringify({ url: page.url(), controls: rows }, null, 2));
}

async function pause(message) {
  const rl = createInterface({ input, output });
  try { await rl.question(message + "\nPress Enter to continue (Ctrl+C to abort). "); }
  finally { rl.close(); }
}

async function generate(page, config, promptFile, outputDir) {
  const prompt = await readFile(promptFile, "utf8");
  if (!prompt.trim() || prompt.length > 15000) {
    throw new Error("Prompt file must have 1-15000 characters");
  }
  const box = page.locator(required(config, "prompt"));
  if (await box.count() !== 1) throw new Error("Prompt selector must match exactly one control");
  await box.fill(prompt, { timeout: 12000 });
  const button = page.locator(required(config, "generate"));
  if (await button.count() !== 1) throw new Error("Generate selector must match exactly one control");
  console.log("Clicking Generate once. This may spend RenderWolf credits.");
  await button.click({ timeout: 12000 });
  await snapshot(page, outputDir, "after-generate.png");
  console.log("Generation click submitted. No repeat, no automatic retries.");
  if (config.selectors.ready) {
    await page.locator(config.selectors.ready).first().waitFor({
      state: "visible", timeout: 300000,
    });
    console.log("Configured readiness selector became visible.");
  } else {
    await pause("Wait for the result visually. The provider's completion UI is not known.");
  }
  return { promptSha256: createHash("sha256").update(prompt).digest("hex") };
}

async function exportAsset(page, config, outputDir, metadata = {}) {
  const menuSelector = config.selectors.exportMenu;
  const exportSelector = required(config, "exportZip");
  if (menuSelector) {
    const menu = page.locator(menuSelector);
    if (await menu.count() !== 1) throw new Error("Export menu selector must match one control");
    await menu.click({ timeout: 12000 });
  }
  const button = page.locator(exportSelector);
  if (await button.count() !== 1) throw new Error("Export selector must match one control");
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 90000 }),
    button.click({ timeout: 12000 }),
  ]);
  const filename = safeFilename(download.suggestedFilename());
  const dest = path.join(outputDir, filename);
  await download.saveAs(dest);
  const info = await stat(dest);
  if (info.size === 0) throw new Error("Downloaded asset is empty");
  const bytes = await readFile(dest);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const receipt = {
    schemaVersion: 1, provider: "renderwolf-slots-studio-browser",
    source: page.url(), downloadedFile: filename,
    downloadedBytes: info.size, downloadedSha256: sha256,
    ...metadata,
    note: "Browser export, not proof of an official RenderWolf API.",
  };
  await writeMetadata(path.join(outputDir, "receipt.json"), receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = await loadConfig(opts.config);
  const profile = await preparePrivateProfile(opts.profile || HOME_PROFILE);
  const needsOutput = opts.action === "export" || opts.action === "full";
  const outputDir = needsOutput ? path.resolve(opts.outputDir) : undefined;
  if (needsOutput) await ensureNewExportDir(outputDir);

  const context = await chromium.launchPersistentContext(profile, {
    headless: false, acceptDownloads: true,
    viewport: { width: 1340, height: 850 },
    // Do not disable browser security or anti-automation protections.
  });
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (opts.action === "inspect") {
      console.log("Log in manually if needed, and navigate to Slots Studio.");
      await pause("Inspect your account interface in the Chromium window.");
      await inspect(page);
      return;
    }
    let metadata = {};
    if (opts.action === "generate" || opts.action === "full") {
      metadata = await generate(page, config, opts.promptFile, outputDir);
    }
    if (needsOutput) await exportAsset(page, config, outputDir, metadata);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error("RenderWolf browser task stopped:", err.message);
  console.error("No automatic retries. Inspect the UI/config before another run.");
  process.exitCode = 1;
});
