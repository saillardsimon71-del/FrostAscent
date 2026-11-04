/**
 * Wait for React/Next SPA hydration before spending any DeepSeek tokens.
 * A domcontentloaded event alone does NOT mean RenderWolf has rendered controls.
 */
export const DEFAULT_READINESS_ATTEMPTS = 26; // 26 * 750ms ~= 19s
export const DEFAULT_READINESS_INTERVAL_MS = 750;

export function isUsefulObservation(observation, { requireAnimationDownload = false } = {}) {
  if (!observation || !Array.isArray(observation.controls) ||
      observation.controls.length === 0) return false;
  if (!requireAnimationDownload) return true;
  return observation.controls.some((control) =>
    /download animation/i.test(
      [control.label, control.title, control.text].filter(Boolean).join(" ")
    ));
}

export async function waitForRenderwolfUI(page, observe, {
  attempts = DEFAULT_READINESS_ATTEMPTS,
  intervalMs = DEFAULT_READINESS_INTERVAL_MS,
  requireAnimationDownload = false,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) {
    throw new TypeError("Invalid readiness attempt count");
  }
  let observation;
  for (let i = 0; i < attempts; i++) {
    observation = await observe(page);
    if (isUsefulObservation(observation, { requireAnimationDownload })) {
      return { ready: true, observation, polls: i + 1 };
    }
    if (i < attempts - 1) await page.waitForTimeout(intervalMs);
  }
  return { ready: false, observation, polls: attempts };
}

export async function writeEmptyPageDiagnostics(page, outDir) {
  const { join } = await import("node:path");
  const screenshotPath = join(outDir, "page-not-ready.png");
  try { await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 12000 }); }
  catch { /* Browser may have navigated or closed; keep earlier root cause. */ }
  const diagnostic = await page.evaluate(() => ({
    readyState: document.readyState,
    title: document.title.slice(0, 80),
    bodyChildCount: document.body?.children.length ?? 0,
    buttonCount: document.querySelectorAll("button").length,
    roleButtonCount: document.querySelectorAll("[role=button]").length,
    documentElementPresent: !!document.documentElement,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    // No field values, session data, DOM HTML or URLs.
  })).catch(() => ({ note: "Page closed before diagnostics" }));
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(outDir, "page-not-ready.json"),
    JSON.stringify(diagnostic, null, 2) + "\n", { flag: "wx" });
  return { screenshotPath, diagnostic };
}
