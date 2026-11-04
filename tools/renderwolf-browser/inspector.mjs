/**
 * DOM-only diagnostic of the currently open RenderWolf UI.
 * Read-only: no click, API request, cookie read, or storage read.
 * Output excludes field values, URLs in src/href, prompt bodies and raw HTML.
 */
export async function inspectVisibleInterface(page) {
  return await page.evaluate(() => {
    const VW = window.innerWidth, VH = window.innerHeight;
    const trim = (s, n = 70) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
    const info = (el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || undefined,
        label: trim(el.getAttribute("aria-label")) || undefined,
        title: trim(el.getAttribute("title")) || undefined,
        alt: trim(el.getAttribute("alt")) || undefined,
        placeholder: trim(el.getAttribute("placeholder")) || undefined,
        testId: trim(el.getAttribute("data-testid")) || undefined,
        text: el.matches("input,textarea,[contenteditable]") ? undefined
          : trim(el.innerText || (el.childElementCount < 2 ? el.textContent : ""), 80) || undefined,
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const shown = (el) => {
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) return false;
      if (r.bottom <= 0 || r.top >= VH || r.right <= 0 || r.left >= VW) return false;
      const x = Math.min(VW - 2, Math.max(1, r.left + Math.min(r.width / 2, 10)));
      const y = Math.min(VH - 2, Math.max(1, r.top + Math.min(r.height / 2, 10)));
      const top = document.elementFromPoint(x, y);
      return !!top && (top === el || el.contains(top));
    };
    // A DOM text node identifying the "Animation" panel, even when it is not a button.
    const headers = [...document.querySelectorAll("body *")]
      .filter((el) => {
        if (!shown(el) || el.matches("script,style")) return false;
        const ownText = [...el.childNodes]
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent || "").join(" ");
        return trim(ownText, 40).toLowerCase() === "animation";
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
      })
      .filter((r) => r.x < VW * 0.6)
      .sort((a, b) => a.x - b.x);
    const anchor = headers[0] || null;

    const CSS = [
      "button", "a", "input:not([type=hidden])", "textarea", "select",
      "[role=button]", "[tabindex]:not([tabindex='-1'])",
      "[title]", "[aria-label]", "[data-testid]",
      "[class*='cursor-pointer']", "img", "video", "canvas",
    ].join(",");
    const items = [...new Set(document.querySelectorAll(CSS))]
      .filter(shown)
      .filter((el) => !el.matches("input[type=password],input[type=hidden]"))
      .map((el) => {
        const value = info(el);
        let distance = Infinity;
        if (anchor) {
          const cx = value.x + value.width / 2;
          const cy = value.y + value.height / 2;
          distance = Math.abs(cx - (anchor.x + anchor.width / 2))
            + Math.abs(cy - (anchor.y + anchor.height / 2)) * 1.25;
        }
        const labelText = [value.label, value.title, value.alt, value.text].join(" ").toLowerCase();
        return {
          ...value,
          nearAnimation: !!anchor &&
            value.x < Math.max(480, anchor.x + 360) &&
            Math.abs(value.y - anchor.y) < 210,
          relevant: /animat|download|export|video|gif|element|yeti/i.test(labelText),
          distance,
        };
      });
    const priority = (a, b) =>
      Number(b.nearAnimation) - Number(a.nearAnimation) ||
      Number(b.relevant) - Number(a.relevant) ||
      a.distance - b.distance ||
      a.y - b.y;
    const filtered = items
      .filter((item) => item.nearAnimation || item.relevant)
      .sort(priority);
    const fallback = items.filter((item) => !filtered.includes(item))
      .sort((a, b) => a.y - b.y);
    const result = [...filtered, ...fallback].slice(0, 85);
    return {
      pageTitle: trim(document.title, 90),
      viewport: { width: VW, height: VH },
      animationHeadingFound: !!anchor,
      inspectedVisibleElements: items.length,
      shownElements: result.length,
      truncated: items.length > result.length,
      controls: result.map(({ distance, relevant, nearAnimation, ...value }) => value),
    };
  });
}
