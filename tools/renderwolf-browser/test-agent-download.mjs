import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createDownloadTracker, isFinalDownloadButton } from "./agent-download.mjs";

function mockContext() {
  const context = new EventEmitter();
  const original = new EventEmitter();
  context.pages = () => [original];
  return { context, original };
}
const receipt = (name) => ({
  filename: name, bytes: 1234, sha256: "a".repeat(64),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("captures delayed download on current page beyond old 2500ms timeout", async () => {
  const { context, original } = mockContext();
  const tracker = createDownloadTracker(context, async (download) => {
    await sleep(25);
    return receipt(download.name);
  });
  setTimeout(() => original.emit("download", { name: "yeti-both-sheets.zip" }), 2700);
  const result = await tracker.waitForExport({ after: 0, timeoutMs: 4000 });
  assert.equal(result.saved, true);
  assert.equal(result.file.filename, "yeti-both-sheets.zip");
  assert.equal(tracker.files.length, 1);
  await tracker.flush();
});

test("captures downloads from new popup tab", async () => {
  const { context } = mockContext();
  const tracker = createDownloadTracker(context, async (download) => receipt(download.name));
  const popup = new EventEmitter();
  context.emit("page", popup);
  setTimeout(() => popup.emit("download", { name: "yeti-sprites.zip" }), 15);
  const result = await tracker.waitForExport({ after: 0, timeoutMs: 800 });
  assert.equal(result.saved, true);
  assert.equal(tracker.files[0].filename, "yeti-sprites.zip");
});

test("duplicate context page events do not attach two listeners", async () => {
  const { context, original } = mockContext();
  let called = 0;
  const tracker = createDownloadTracker(context, async (download) => {
    called++;
    return receipt(download.name);
  });
  context.emit("page", original);
  original.emit("download", { name: "one.zip" });
  await tracker.flush();
  assert.equal(called, 1);
  assert.equal(tracker.files.length, 1);
});

test("reports saving failure rather than fabricating successful receipt", async () => {
  const { context, original } = mockContext();
  const tracker = createDownloadTracker(context, async () => {
    const error = new Error("broken file");
    error.code = "EIO";
    throw error;
  });
  setTimeout(() => original.emit("download", { name: "failed.zip" }), 10);
  const result = await tracker.waitForExport({ after: 0, timeoutMs: 800 });
  assert.equal(result.saved, false);
  assert.match(result.error, /EIO/);
  assert.equal(tracker.files.length, 0);
});

test("actual Download button waits, menu Download actions do not", () => {
  assert.equal(isFinalDownloadButton({ text: "Download" }), true);
  assert.equal(isFinalDownloadButton({ label: "Download animation" }), false);
  assert.equal(isFinalDownloadButton({ text: "Download sprite sheet…" }), false);
  assert.equal(isFinalDownloadButton({ text: "Both sheets (.zip)" }), false);
  assert.equal(isFinalDownloadButton({ label: "Export" }), true);
  assert.equal(isFinalDownloadButton({ label: "Download", text: "Download" }), true);
});

test("timeout does not pretend a download happened", async () => {
  const { context } = mockContext();
  const tracker = createDownloadTracker(context, async (d) => receipt(d.name));
  const result = await tracker.waitForExport({ timeoutMs: 200 });
  assert.equal(result.saved, false);
  assert.equal(tracker.files.length, 0);
});
