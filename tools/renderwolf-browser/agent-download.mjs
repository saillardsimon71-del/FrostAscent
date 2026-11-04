/**
 * Capture browser downloads for the ENTIRE Playwright context, including
 * downloads launched by a popup. A 2.5s page.waitForEvent('download') can miss
 * slow ZIP creation and downloads originating in newly opened tabs.
 *
 * No downloaded files or session material leave the user's computer.
 */
export function createDownloadTracker(context, saveFile, { maxFiles = 5 } = {}) {
  if (!context || typeof context.on !== "function" || typeof saveFile !== "function") {
    throw new TypeError("Expected a Playwright browser context and save callback");
  }
  const files = [];
  const errors = [];
  const attached = new WeakSet();
  const pending = new Set();
  let started = 0;

  function onDownload(download) {
    if (started >= maxFiles) {
      errors.push("Maximum download count reached");
      return;
    }
    started++;
    let job;
    job = Promise.resolve().then(() => saveFile(download))
      .then((receipt) => {
        if (!receipt || !receipt.filename || !receipt.sha256) {
          throw new Error("Download was not saved and verified");
        }
        files.push(receipt);
      })
      .catch((error) => {
        // Never log provider tokens, signed CDN URLs or raw download failures.
        errors.push("Download could not be saved: " +
          (error?.code || error?.name || "unknown error"));
      })
      .finally(() => pending.delete(job));
    pending.add(job);
  }

  function attach(page) {
    if (!page || attached.has(page)) return;
    attached.add(page);
    page.on("download", onDownload);
  }
  context.on("page", attach);
  for (const page of context.pages()) attach(page);

  async function waitForExport({ after = 0, timeoutMs = 60000 } = {}) {
    if (!Number.isInteger(after) || after < 0) throw new TypeError("Invalid initial count");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 90000) {
      throw new TypeError("Invalid download timeout");
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (files.length > after) return { saved: true, file: files[files.length - 1] };
      if (errors.length) return { saved: false, error: errors[errors.length - 1] };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { saved: false, error: "No verified Playwright download within timeout" };
  }

  async function flush() {
    await Promise.allSettled([...pending]);
  }

  return { files, errors, waitForExport, flush };
}

export function isFinalDownloadButton(control) {
  const name = [control?.label, control?.text, control?.title]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  // Intermediate entries such as "Download animation" and
  // "Download sprite sheet..." open menus but do not start a file.
  return /^(download|save|export)(?:\s*\.(?:zip|png|webm|mp4))?$/i.test(name);
}
