/**
 * Wait for React/Next SPA hydration before spending any DeepSeek tokens.
 * A domcontentloaded event alone does NOT mean RenderWolf has rendered controls.
 */
export const DEFAULT_READINESS_ATTEMPTS = 26; // 26 * 750ms ~= 19s
export const DEFAULT_READINESS_INTERVAL_MS = 750;

/**
 * RenderWolf keeps dashboard/sidebar controls mounted while the game /player
 * route hydrates. A nonempty control list is NOT proof the game workspace is
 * ready. Require a genuine game-specific control before spending model tokens.
 * Unknown player layouts safely time out with a local screenshot.
 */
export function hasGameWorkspaceControls(observation) {
  if (!/\/games\/[^/]+\//.test(observation?.url || "")) return false;
  const controls = observation?.controls || [];
  // A dismissible upsell can appear before the game workspace is available.
  // Expose only that safe decision to the model; never assume it means creation is enabled.
  if ((observation?.context || []).some(x => /upgrade required/i.test(x)) &&
      controls.some(c => /^maybe later$/i.test([c.label,c.text].filter(Boolean).join(" ").trim()))) {
    return true;
  }
  return controls.some(control => {
    const label = [control.label, control.title, control.text]
      .filter(Boolean).join(" ").trim().toLowerCase();
    if (/^\d+\s+assets?\s+.+\btheme\b/.test(label)) return false; // dashboard cards
    if (/^(?:move to folder|delete game|add credits|toggle sidebar|subscribe now|maybe later)$/.test(label)) return false;
    return /\b(?:design|gameplay|edit game|edit assets|edit design|symbols|reels|characters|animation|background|scene|preview|spin|autoplay|paytable|asset library|open editor)\b/.test(label);
  });
}

/**
 * A direct /design URL can first render only global navigation. Do not spend a
 * DeepSeek call until the design asset browser or Add Element entry is visible.
 */
export function hasDesignWorkspaceControls(observation) {
  if (!/\/games\/[^/]+\/design(?:\/|$)/.test(observation?.url || "")) return false;
  return (observation.controls || []).some(control => {
    const label=[control.label, control.title, control.text].filter(Boolean).join(" ").trim();
    return (control.tag === "a" &&
      (/^add element$/i.test(label) ||
       /^(?:background\s*[-–]|the yeti guardian$|the climber$|reel frame\s*[-–]|game title$|spin button$)/i.test(label)));
  });
}

export function isUsefulObservation(observation, {
  requireAnimationDownload = false,
  requireGameWorkspace = false,
  requireDesignWorkspace = false,
} = {}) {
  if (!observation || !Array.isArray(observation.controls) ||
      observation.controls.length === 0) return false;
  if (requireAnimationDownload) {
    return observation.controls.some((control) =>
      /download animation/i.test(
        [control.label, control.title, control.text].filter(Boolean).join(" ")
      ));
  }
  if (requireGameWorkspace) return hasGameWorkspaceControls(observation);
  if (requireDesignWorkspace) return hasDesignWorkspaceControls(observation);
  return true;
}

export async function waitForRenderwolfUI(page, observe, {
  attempts = DEFAULT_READINESS_ATTEMPTS,
  intervalMs = DEFAULT_READINESS_INTERVAL_MS,
  requireAnimationDownload = false,
  requireGameWorkspace = false,
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 60) {
    throw new TypeError("Invalid readiness attempt count");
  }
  let observation;
  for (let i = 0; i < attempts; i++) {
    observation = await observe(page);
    if (isUsefulObservation(observation, { requireAnimationDownload, requireGameWorkspace, requireDesignWorkspace })) {
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
