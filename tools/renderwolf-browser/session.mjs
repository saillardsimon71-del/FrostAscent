/**
 * Load a local, user-provided Playwright storageState for RenderWolf only.
 * This module neither discovers cookies nor exports browser credentials.
 * Never log or commit the resulting state: it contains active session secrets.
 */
import { readFile, stat } from "node:fs/promises";

const MAX_SESSION_FILE_BYTES = 2 * 1024 * 1024;
const MAX_COOKIES = 200;
const MAX_ORIGINS = 20;
const MAX_LOCAL_STORAGE_ITEMS = 300;

export function isRenderwolfHost(raw) {
  if (typeof raw !== "string") return false;
  const host = raw.replace(/^\./, "").toLowerCase();
  return host === "renderwolf.ai" || host.endsWith(".renderwolf.ai");
}

function sanitizeCookie(cookie) {
  if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) {
    throw new TypeError("Invalid session cookie");
  }
  if (!isRenderwolfHost(cookie.domain)) {
    throw new TypeError("Session contains a cookie for a non-RenderWolf domain");
  }
  if (typeof cookie.name !== "string" || !cookie.name ||
      typeof cookie.value !== "string" ||
      typeof cookie.path !== "string" || !cookie.path.startsWith("/") ||
      cookie.path.includes("\\") ||
      typeof cookie.secure !== "boolean" ||
      typeof cookie.httpOnly !== "boolean") {
    throw new TypeError("Malformed session cookie");
  }
  const expires = cookie.expires === undefined ? -1 : cookie.expires;
  if (typeof expires !== "number" || !Number.isFinite(expires) ||
      (expires < 0 && expires !== -1)) {
    throw new TypeError("Invalid cookie expiry");
  }
  if (!["Strict", "Lax", "None"].includes(cookie.sameSite)) {
    throw new TypeError("Invalid cookie SameSite value");
  }
  const host = cookie.domain.replace(/^\./, "").toLowerCase();
  if (cookie.sameSite === "None" && !cookie.secure) {
    throw new TypeError("SameSite=None cookies must be secure");
  }
  return {
    name: cookie.name, value: cookie.value,
    domain: (cookie.domain.startsWith(".") ? "." : "") + host,
    path: cookie.path, expires,
    httpOnly: cookie.httpOnly, secure: cookie.secure, sameSite: cookie.sameSite,
  };
}

function sanitizeOrigin(origin) {
  if (!origin || typeof origin !== "object" || typeof origin.origin !== "string") {
    throw new TypeError("Invalid storage origin");
  }
  let url;
  try { url = new URL(origin.origin); }
  catch { throw new TypeError("Invalid storage origin URL"); }
  if (url.protocol !== "https:" || !isRenderwolfHost(url.hostname) ||
      url.origin !== origin.origin || url.username || url.password) {
    throw new TypeError("Session contains a non-RenderWolf storage origin");
  }
  if (!Array.isArray(origin.localStorage) ||
      origin.localStorage.length > MAX_LOCAL_STORAGE_ITEMS) {
    throw new TypeError("Invalid localStorage entries");
  }
  const localStorage = [];
  const seen = new Set();
  for (const item of origin.localStorage) {
    if (!item || typeof item.name !== "string" ||
        typeof item.value !== "string" || seen.has(item.name)) {
      throw new TypeError("Invalid or duplicated localStorage item");
    }
    seen.add(item.name);
    localStorage.push({ name: item.name, value: item.value });
  }
  return { origin: url.origin, localStorage };
}

export function sanitizeRenderwolfStorageState(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !Array.isArray(data.cookies) || !Array.isArray(data.origins) ||
      data.cookies.length > MAX_COOKIES || data.origins.length > MAX_ORIGINS) {
    throw new TypeError("Invalid or oversized Playwright storage state");
  }
  // Reject credentials/passkeys and unknown state fields, not just other domains.
  if (Object.keys(data).some((key) => !["cookies", "origins"].includes(key))) {
    throw new TypeError("Session state contains unsupported fields");
  }
  if (data.cookies.length === 0 && data.origins.length === 0) {
    throw new TypeError("The RenderWolf session file is empty");
  }
  const cookies = data.cookies.map(sanitizeCookie);
  const origins = data.origins.map(sanitizeOrigin);
  const uniqueCookies = new Set();
  for (const cookie of cookies) {
    const key = [cookie.name, cookie.domain, cookie.path].join("\u0000");
    if (uniqueCookies.has(key)) throw new TypeError("Duplicate session cookie");
    uniqueCookies.add(key);
  }
  const uniqueOrigins = new Set(origins.map((item) => item.origin));
  if (uniqueOrigins.size !== origins.length) throw new TypeError("Duplicate storage origins");
  return { cookies, origins };
}

export async function loadRenderwolfStorageState(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_SESSION_FILE_BYTES) {
    throw new TypeError("Session file exceeds size limit or is not a file");
  }
  let value;
  try { value = JSON.parse(await readFile(file, "utf8")); }
  catch { throw new TypeError("Session file is not valid JSON"); }
  return sanitizeRenderwolfStorageState(value);
}
