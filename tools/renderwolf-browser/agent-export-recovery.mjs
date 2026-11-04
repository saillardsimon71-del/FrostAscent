/**
 * Narrow, non-generative recovery when DeepSeek repeatedly selects the same
 * spritesheet grid size (e.g. 4×4) while a final Download button is visible.
 * Only returns actions on current visible, non-disabled, RenderWolf controls.
 */
import { isFinalDownloadButton } from "./agent-download.mjs";

const gridChoice = /^\s*\d{1,2}\s*[×x]\s*\d{1,2}\s*$/i;
function name(c) {
  return [c?.label, c?.text, c?.title].filter(Boolean).join(" ").trim();
}
function isClickable(c) {
  return c && !c.disabled &&
    ["button","label","div","span","input"].includes(c.tag);
}

export function recoverRepeatedSheetChoice({ observation, action, repeatCount, task }) {
  if (!observation?.url?.includes("/extra/animation") ||
      !/(télécharg|download|export)/i.test(task || "") ||
      action?.action !== "click" ||
      !Number.isInteger(action.target_id)) return null;

  const chosen = observation.controls?.find(c => c.id === action.target_id);
  if (!isClickable(chosen)) return null;
  if (!gridChoice.test(name(chosen))) return null;
  if (repeatCount < 2 && chosen.selected !== true && chosen.checked !== true) {
    return null; // First click on a genuinely new grid selection is allowed.
  }

  // Respect an explicit request for BOTH opaque and transparent sheets.
  const bothRequested = /\bboth sheets\b|deux feuilles|opaque.{0,30}transparent/i.test(task);
  if (bothRequested) {
    const unselectedBoth = (observation.controls || []).filter(c =>
      isClickable(c) && /\bboth sheets\b/i.test(name(c)) &&
      c.selected === false
    );
    if (unselectedBoth.length === 1) {
      return {
        action: { action: "click", target_id: unselectedBoth[0].id },
        reason: "Selecting the requested Both sheets option instead of repeating grid size",
      };
    }
  }

  const finals = (observation.controls || []).filter(c =>
    isClickable(c) && c.tag === "button" && isFinalDownloadButton(c)
  );
  if (finals.length !== 1) return null; // Never guess among multiple Download buttons.

  return {
    action: { action: "click", target_id: finals[0].id },
    reason: "Grid size already selected or repeated; advance to final Download",
  };
}
