import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateConfig, safeFilename, sha256Buffer } from "./core.mjs";
import { sanitizeRenderwolfStorageState, isRenderwolfHost } from "./session.mjs";

test("inspect command requires config", () => {
  assert.deepEqual(parseArgs(["inspect", "--config", "selectors.json"]), {
    action: "inspect", config: "selectors.json",
  });
  assert.throws(() => parseArgs(["inspect"]), /config/);
});
test("generations require explicit credits approval and prompt", () => {
  assert.throws(() => parseArgs(["generate", "--config", "s.json", "--prompt-file", "p.txt"]), /approve/);
  const args = parseArgs(["generate", "--config", "s.json", "--prompt-file", "p.txt", "--approve-generation"]);
  assert.equal(args.approveGeneration, true);
  assert.throws(() => parseArgs(["full", "--config", "s.json", "--prompt-file", "p.txt", "--approve-generation"]), /output/);
});
test("allow only provider HTTPS URLs", () => {
  assert.equal(validateConfig({url:"https://slots.renderwolf.ai/",selectors:{}}).url, "https://slots.renderwolf.ai/");
  assert.throws(() => validateConfig({url:"https://renderwolf.ai.evil.test/",selectors:{}}), /RenderWolf/);
  assert.throws(() => validateConfig({url:"http://slots.renderwolf.ai/",selectors:{}}), /RenderWolf/);
  assert.throws(() => validateConfig({url:"https://user:pass@slots.renderwolf.ai/",selectors:{}}), /credentials/);
});
test("validate selectors and reject unexpected automation keys", () => {
  assert.deepEqual(validateConfig({url:"https://slots.renderwolf.ai/",selectors:{prompt:"textarea"}}).selectors, {prompt:"textarea"});
  assert.throws(() => validateConfig({url:"https://slots.renderwolf.ai/",selectors:{bypassCaptcha:"x"}}), /Unknown/);
  assert.throws(() => validateConfig({url:"https://slots.renderwolf.ai/",selectors:{generate:""}}), /nonempty/);
});
test("download names cannot escape output directory", () => {
  assert.equal(safeFilename("my-export.zip"),"my-export.zip");
  assert.equal(safeFilename("../../my-export.zip"),"my-export.zip");
  assert.throws(() => safeFilename(".env"), /Unsafe/);
  assert.throws(() => safeFilename("my%2Fexport.zip"), /Unsafe/);
});
test("sha256 proof", () => {
  assert.equal(sha256Buffer(Buffer.from("hello")), "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});


const validSession = {
  cookies: [{
    name: "rw-session", value: "dummy-value-not-a-real-token",
    domain: ".renderwolf.ai", path: "/", expires: -1,
    httpOnly: true, secure: true, sameSite: "Lax",
  }],
  origins: [{
    origin: "https://slots.renderwolf.ai",
    localStorage: [{ name: "auth-state", value: "dummy-local-value" }],
  }],
};

test("CLI accepts session file with inspect but not simultaneous persistent profile", () => {
  const args = parseArgs(["inspect", "--config", "selectors.json", "--session-file", "renderwolf-session.json"]);
  assert.equal(args.sessionFile, "renderwolf-session.json");
  assert.throws(() => parseArgs([
    "inspect", "--config", "selectors.json", "--session-file", "session.json",
    "--profile", "browser-profile",
  ]), /not both/);
});

test("sanitize a RenderWolf-only Playwright storageState", () => {
  const sanitized = sanitizeRenderwolfStorageState(validSession);
  assert.deepEqual(sanitized, validSession);
  assert.equal(isRenderwolfHost("slots.renderwolf.ai"), true);
  assert.equal(isRenderwolfHost(".renderwolf.ai"), true);
  assert.equal(isRenderwolfHost("renderwolf.ai.attacker.test"), false);
});

test("reject cookies scoped to Google or other domains", () => {
  const untrusted = structuredClone(validSession);
  untrusted.cookies[0].domain = ".google.com";
  assert.throws(() => sanitizeRenderwolfStorageState(untrusted), /non-RenderWolf/);
});

test("reject cross-site localStorage and malformed cookies", () => {
  const untrusted = structuredClone(validSession);
  untrusted.origins[0].origin = "https://accounts.google.com";
  assert.throws(() => sanitizeRenderwolfStorageState(untrusted), /non-RenderWolf/);
  const malformed = structuredClone(validSession);
  malformed.cookies[0].value = 1234;
  assert.throws(() => sanitizeRenderwolfStorageState(malformed), /Malformed/);
});

test("reject empty auth, extraneous passkey credentials, oversized or duplicated entries", () => {
  assert.throws(() => sanitizeRenderwolfStorageState({ cookies: [], origins: [] }), /empty/);
  const dangerous = structuredClone(validSession);
  dangerous.credentials = [{ id: "private-key" }];
  assert.throws(() => sanitizeRenderwolfStorageState(dangerous), /unsupported fields/);
  const duplicate = structuredClone(validSession);
  duplicate.cookies.push(structuredClone(duplicate.cookies[0]));
  assert.throws(() => sanitizeRenderwolfStorageState(duplicate), /Duplicate/);
});
