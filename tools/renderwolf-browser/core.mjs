import { createHash } from "node:crypto";
import { readFile, mkdir, readdir, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const PROVIDER = "renderwolf-slots-studio";
export const HOME_PROFILE = path.join(homedir(), ".local", "share", "renderwolf-slots-studio-browser");
export const ALLOWED_KEYS = ["prompt", "generate", "ready", "exportMenu", "exportZip"];

export function validateConfig(obj) {
  if (!obj || typeof obj !== "object") throw new TypeError("Expected JSON object");
  const url = new URL(obj.url);
  if (url.protocol !== "https:" ||
      !(url.hostname === "renderwolf.ai" || url.hostname.endsWith(".renderwolf.ai"))) {
    throw new TypeError("Only HTTPS RenderWolf domains are allowed");
  }
  if (url.username || url.password || url.search) {
    throw new TypeError("Do not include credentials or tokens in a URL");
  }
  const selectors = obj.selectors;
  if (!selectors || typeof selectors !== "object" || Array.isArray(selectors)) {
    throw new TypeError("Expected selectors mapping");
  }
  for (const [key, value] of Object.entries(selectors)) {
    if (!ALLOWED_KEYS.includes(key)) throw new TypeError("Unknown selector: " + key);
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError("Selector must be a nonempty string: " + key);
    }
  }
  return { url: url.href, selectors };
}

export function validateStartUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new TypeError("Invalid --start-url"); }
  if (url.protocol !== "https:" ||
      !(url.hostname === "renderwolf.ai" || url.hostname.endsWith(".renderwolf.ai")) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError("--start-url must be an HTTPS RenderWolf URL without credentials, query or fragment");
  }
  return url.href;
}

export function parseArgs(argv) {
  const [action, ...args] = argv;
  if (!["inspect", "generate", "export", "full"].includes(action)) {
    throw new TypeError("Usage: cli.mjs inspect|generate|export|full [options]");
  }
  const opts = { action };
  const flags = new Set(["--approve-generation"]);
  const values = {
    "--config": "config",
    "--prompt-file": "promptFile",
    "--output-dir": "outputDir",
    "--profile": "profile",
    "--session-file": "sessionFile",
    "--start-url": "startUrl",
  };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flags.has(flag)) opts.approveGeneration = true;
    else if (values[flag]) {
      const val = args[++i];
      if (!val || val.startsWith("--")) throw new TypeError("Missing value for " + flag);
      opts[values[flag]] = val;
    } else throw new TypeError("Unknown option: " + flag);
  }
  if (!opts.config) throw new TypeError("--config is required");
  if (opts.startUrl) opts.startUrl = validateStartUrl(opts.startUrl);
  if (opts.sessionFile && opts.profile) {
    throw new TypeError("Use --session-file or --profile, not both");
  }
  if (["generate", "full"].includes(action) && (!opts.promptFile || !opts.approveGeneration)) {
    throw new TypeError("Generating requires --prompt-file and --approve-generation; it may consume credits");
  }
  if (["export", "full"].includes(action) && !opts.outputDir) {
    throw new TypeError("Exporting requires --output-dir");
  }
  return opts;
}

export function safeFilename(input) {
  const basename = path.posix.basename(input.replace(/\\/g, "/"));
  if (!basename || basename === "." || basename === ".." ||
      /[^\w .()-]/.test(basename) || basename.startsWith(".")) {
    throw new TypeError("Unsafe downloaded filename");
  }
  return basename;
}

export function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function preparePrivateProfile(dir = HOME_PROFILE) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

export async function ensureNewExportDir(dir) {
  await mkdir(dir, { recursive: false });
  const existing = await readdir(dir);
  if (existing.length) throw new TypeError("Output directory is not empty");
  return dir;
}

export async function loadConfig(file) {
  return validateConfig(JSON.parse(await readFile(file, "utf8")));
}

export async function writeMetadata(file, obj) {
  await writeFile(file, JSON.stringify(obj, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
