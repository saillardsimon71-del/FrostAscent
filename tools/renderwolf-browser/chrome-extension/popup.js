"use strict";

// Runs only in this extension popup after a user click.
// Never sends cookies, tokens or localStorage over the network.
const button = document.getElementById("export");
const status = document.getElementById("status");

function isProviderHost(hostname) {
  return hostname === "renderwolf.ai" || hostname.endsWith(".renderwolf.ai");
}

function sameSite(value) {
  if (value === "strict") return "Strict";
  if (value === "no_restriction") return "None";
  return "Lax";
}

function toPlaywrightCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || "/",
    expires: cookie.session ? -1 : (cookie.expirationDate ?? -1),
    httpOnly: !!cookie.httpOnly,
    secure: !!cookie.secure,
    sameSite: sameSite(cookie.sameSite),
  };
}

async function readActiveOriginStorage(tabId) {
  const rows = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const items = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const name = window.localStorage.key(i);
        items.push({ name, value: window.localStorage.getItem(name) || "" });
      }
      return items;
    },
  });
  return rows?.[0]?.result || [];
}

button.addEventListener("click", async () => {
  button.disabled = true;
  status.textContent = "Préparation locale...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error("Aucun onglet actif disponible.");
    }
    const url = new URL(tab.url);
    if (url.protocol !== "https:" || !isProviderHost(url.hostname)) {
      throw new Error("Ouvre un onglet RenderWolf Slots Studio connecté avant d'exporter.");
    }
    const all = await chrome.cookies.getAll({ domain: "renderwolf.ai" });
    const cookies = all
      .filter((cookie) => isProviderHost(cookie.domain.replace(/^\./, "")))
      .filter((cookie) => !cookie.partitionKey)
      .map(toPlaywrightCookie);
    const localStorage = await readActiveOriginStorage(tab.id);
    if (cookies.length === 0 && localStorage.length === 0) {
      throw new Error("Aucune donnée de session RenderWolf trouvée.");
    }
    const state = {
      cookies,
      origins: [{ origin: url.origin, localStorage }],
    };
    const json = JSON.stringify(state, null, 2);
    if (json.length > 2 * 1024 * 1024) {
      throw new Error("Le stockage RenderWolf est trop volumineux pour cet export.");
    }
    const blob = new Blob([json], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "renderwolf-session.json";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 15000);
    status.textContent = "Session exportée localement. Ne partage pas ce fichier, conserve-le hors GitHub puis supprime-le après utilisation.";
  } catch (error) {
    // Never print or reveal actual cookie/localStorage values.
    status.textContent = error instanceof Error ? error.message : "Échec de l'export local.";
  } finally {
    button.disabled = false;
  }
});
