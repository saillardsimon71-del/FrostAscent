import { readFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MODEL = "deepseek-flash";
export const DEFAULT_MAX_STEPS = 12;
export const MAX_STEPS = 24;

export function parseAgentArgs(args) {
  const opts = {
    maxSteps: DEFAULT_MAX_STEPS,
    model: DEFAULT_MODEL,
  };
  const options = {
    "--task": "task", "--session-file": "sessionFile",
    "--start-url": "startUrl", "--output-dir": "outputDir",
    "--max-steps": "maxSteps",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--allow-generation") opts.allowGeneration = true;
    else if (options[arg]) {
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        throw new TypeError("Missing value for " + arg);
      }
      opts[options[arg]] = args[++i];
    } else throw new TypeError("Unsupported agent argument: " + arg);
  }
  if (typeof opts.task !== "string" || opts.task.trim().length < 6 ||
      opts.task.length > 1500) throw new TypeError("Provide a --task (6–1500 characters)");
  if (!opts.sessionFile || !opts.outputDir || !opts.startUrl) {
    throw new TypeError("--session-file, --start-url and --output-dir are required");
  }
  const url = new URL(opts.startUrl);
  if (url.protocol !== "https:" ||
      !(url.hostname === "renderwolf.ai" || url.hostname.endsWith(".renderwolf.ai")) ||
      url.username || url.password || url.search || url.hash) {
    throw new TypeError("--start-url must be a RenderWolf HTTPS page with no query or fragment");
  }
  opts.startUrl = url.href;
  const n = Number(opts.maxSteps);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_STEPS) {
    throw new TypeError("maxSteps must be an integer from 1 to " + MAX_STEPS);
  }
  opts.maxSteps = n;
  return opts;
}

export function classifyControl(target) {
  const txt = [target?.label, target?.text, target?.title, target?.placeholder]
    .filter(Boolean).join(" ").toLowerCase();
  if (/log.?out|sign.?out|delete|remove|erase|publish|unpublish|billing|credits?|purchase|subscribe|checkout|payment|card number|password|api.key|reset|disable|disconnect/.test(txt)) {
    return "forbidden";
  }
  if (/regenerat|generat|create|produce|animate|edit image with ai|magic layers|replace|upload|apply changes|confirm purchase/.test(txt)) {
    return "generation";
  }
  return "safe";
}

export function validateAgentAction(raw, observation) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      !["click", "fill", "wait", "finish"].includes(raw.action)) {
    throw new TypeError("Invalid agent action");
  }
  if (raw.action === "finish") {
    return { action: "finish", summary: String(raw.summary || "").slice(0, 350) };
  }
  if (raw.action === "wait") return { action: "wait" };
  const index = raw.target_id;
  if (!Number.isInteger(index) || !Array.isArray(observation?.controls)) {
    throw new TypeError("A valid target_id is required");
  }
  const found = observation.controls.find((t) => t.id === index);
  if (!found) throw new TypeError("Action target is absent from the latest observation");
  const risk = classifyControl(found);
  if (risk === "forbidden") throw new TypeError("Action blocked: sensitive account/payment/destructive control");
  if (raw.action === "fill") {
    if (!["input", "textarea"].includes(found.tag) &&
        found.role !== "textbox" && !found.editable) {
      throw new TypeError("Only text inputs may be filled");
    }
    if (/(password|email|token|key|credit|card|payment)/i.test(
      [found.label, found.placeholder, found.text].join(" ")
    )) throw new TypeError("Refusing to fill a credential or payment field");
    if (typeof raw.value !== "string" || raw.value.length > 1500) {
      throw new TypeError("Text must be 0–1500 characters");
    }
    return { action: "fill", target_id: index, value: raw.value, risk };
  }
  return { action: "click", target_id: index, risk };
}

export function isRenderwolfPage(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.protocol === "https:" &&
      (u.hostname === "renderwolf.ai" || u.hostname.endsWith(".renderwolf.ai"));
  } catch { return false; }
}

export function publicPageUrl(rawUrl) {
  const u = new URL(rawUrl);
  if (!isRenderwolfPage(rawUrl)) throw new TypeError("Browser navigated outside RenderWolf");
  return u.origin + u.pathname;
}

export async function readLocalDeepSeekKey(file = new URL("./.env.local", import.meta.url)) {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  let body;
  try { body = await readFile(file, "utf8"); }
  catch { throw new Error("Missing local .env.local. Add DEEPSEEK_API_KEY=... there."); }
  const match = body.match(/^\s*DEEPSEEK_API_KEY\s*=\s*(["']?)([^\r\n]+?)\1\s*$/m);
  if (!match || !match[2].trim()) {
    throw new Error("Missing DEEPSEEK_API_KEY in .env.local");
  }
  const key = match[2].trim();
  if (/[\s]/.test(key) || key.length < 10) {
    throw new Error("Invalid DEEPSEEK_API_KEY format in .env.local");
  }
  return key;
}

export function redactForModel(text) {
  // Never send cookies, tokens, URLs, or HTML to the model.
  return String(text || "")
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9._-]{24,})\b/g, "[secret]")
    .slice(0, 100);
}
