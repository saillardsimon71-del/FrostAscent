/**
 * Safe, focused DOM snapshot for the DeepSeek browser agent.
 * Only visible controls, labels and small screen text snippets are exposed.
 * Explicitly excludes field values, network requests, cookies, raw HTML and
 * images / media URLs. The temporary data attribute is regenerated per snapshot.
 */
import { publicPageUrl, redactForModel } from "./agent-core.mjs";

const MAX_CONTROLS = 90;
export const TARGET_ATTR = "data-rw-agent-target";

export async function observeRenderwolfPage(page) {
  const url = publicPageUrl(page.url());
  const data = await page.evaluate(({ attr, cap }) => {
    document.querySelectorAll("[" + attr + "]").forEach((el) => el.removeAttribute(attr));
    const width = window.innerWidth, height = window.innerHeight;
    const visible = (el) => {
      if (!(el instanceof HTMLElement) || el.closest("[aria-hidden=true]")) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= height ||
          r.right <= 0 || r.left >= width) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" ||
          style.pointerEvents === "none" || Number(style.opacity) === 0) return false;
      const cx = Math.min(width - 1, Math.max(1, r.x + r.width / 2));
      const cy = Math.min(height - 1, Math.max(1, r.y + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      return top === el || !!top && el.contains(top);
    };
    const roleQuery = [
      "button", "a[href]", "input:not([type=hidden]):not([type=password])",
      "textarea", "select", "label", "[contenteditable=true]",
      "[role=button]", "[role=radio]", "[role=tab]", "[role=option]",
      "[role=menuitem]", "[role=checkbox]", "[role=switch]",
      "[aria-label]", "[title]", "[class*='cursor-pointer']",
    ].join(",");
    const all = [...new Set(document.querySelectorAll(roleQuery))]
      .filter(visible)
      .filter((el) => el.matches("button,a,input,textarea,select,label,[contenteditable=true],[role=button],[role=radio],[role=tab],[role=option],[role=menuitem],[role=checkbox],[role=switch]") ||
        (el.getAttribute("aria-label") || el.getAttribute("title") || "").length > 0);
    const dialog = document.querySelector('[role="dialog"],[aria-modal="true"]');
    const dialogBox = dialog && visible(dialog) ? dialog.getBoundingClientRect() : null;
    const isInDialog = (el) => dialogBox && (el === dialog || dialog.contains(el));
    all.sort((a,b) => {
      const aIn = isInDialog(a) ? 1 : 0;
      const bIn = isInDialog(b) ? 1 : 0;
      if (bIn !== aIn) return bIn - aIn;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.y - rb.y || ra.x - rb.x;
    });
    const controls = all.slice(0,cap).map((el,i) => {
      const r = el.getBoundingClientRect();
      el.setAttribute(attr,String(i));
      const field = el.matches("input,textarea,[contenteditable=true]");
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || "";
      const text = field ? "" : (el.innerText || el.textContent || "");
      const safeText = (s, length=90) => String(s || "").replace(/\s+/g," ").trim().slice(0,length);
      const tag = el.tagName.toLowerCase();
      return {
        id:i,
        tag, role:el.getAttribute("role") || undefined,
        label:safeText(label), title:safeText(el.getAttribute("title")),
        placeholder:safeText(el.getAttribute("placeholder")),
        text:safeText(text),
        type:el.getAttribute("type") || undefined,
        checked:el.matches("input[type=radio],input[type=checkbox]") ? el.checked :
          el.querySelector("input[type=radio],input[type=checkbox]")?.checked,
        selected:(()=>{
          const attr=el.getAttribute("aria-checked") ??
            el.getAttribute("aria-selected") ?? el.getAttribute("aria-pressed");
          if(attr==="true")return true;
          if(attr==="false")return false;
          const state=el.getAttribute("data-state");
          if(state==="checked"||state==="active"||state==="selected")return true;
          if(state==="unchecked"||state==="inactive"||state==="unselected")return false;
          if(el.matches("input[type=radio],input[type=checkbox]"))return el.checked;
          const nested=el.querySelector("input[type=radio],input[type=checkbox]");
          return nested ? nested.checked : undefined;
        })(),
        disabled:!!el.disabled || el.getAttribute("aria-disabled")==="true",
        editable:el.getAttribute("contenteditable")==="true",
        x:Math.round(r.x),y:Math.round(r.y),
      };
    });
    // Display-only context. Do not send text input values or full prompts.
    const contextSelectors="h1,h2,h3,h4,label,[role=dialog], [role=group] > span";
    const context = [...document.querySelectorAll(contextSelectors)]
      .filter(visible)
      .slice(0,18)
      .map(el=>(el.innerText||"").replace(/\s+/g," ").trim().slice(0,120))
      .filter(Boolean);
    return {
      controls, context,
      viewport:{width,height},
      totalVisibleCandidates:all.length,
      truncated:all.length>cap,
    };
  }, { attr: TARGET_ATTR, cap: MAX_CONTROLS });
  return {
    url,
    ...data,
    context: data.context.map(x=>redactForModel(x)),
    controls: data.controls.map(c=>({
      ...c, label:redactForModel(c.label), title:redactForModel(c.title),
      placeholder:redactForModel(c.placeholder), text:redactForModel(c.text),
    })),
  };
}
