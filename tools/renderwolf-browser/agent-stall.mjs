/**
 * Detect a model repeatedly clicking the same control on an unchanged page.
 * Use sanitized DOM labels only, not cookies or field values.
 */
export function actionFingerprint(observation, action) {
  if (action?.action !== "click" || !Number.isInteger(action.target_id)) return null;
  const target = observation?.controls?.find(c => c.id === action.target_id);
  if (!target) return null;
  const screen = (observation.controls || []).map(c => [
    c.id, c.tag, c.role, c.label, c.title, c.text,
    c.placeholder, c.checked, c.disabled,
  ]);
  return JSON.stringify({
    url: observation.url,
    screen,
    target: [target.id, target.tag, target.label, target.title, target.text],
  });
}

/** Stop BEFORE executing the third identical click against unchanged UI. */
export function countSameClick(previousFingerprint, previousCount, nextFingerprint) {
  if (!nextFingerprint) return 0;
  return previousFingerprint === nextFingerprint ? previousCount + 1 : 1;
}

export const MAX_SAME_CLICK = 2;
