import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, validateConfig, safeFilename, sha256Buffer } from "./core.mjs";

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
