/**
 * A clip's key words (caption_options.emphasis, picked by the Engine's moment
 * finder): coloured in its captions the way an editor colours the key word of
 * a pull quote. Mirrors engine/app/pipeline/caption.py emphasised() so the
 * live preview, the browser render and the Engine's export agree.
 */

export const EMPHASIS_COLOUR = "#FFD60A";

/** The clip's key words, cleaned, at most three. */
export function emphasisSet(raw: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(raw)) return out;
  for (const w of raw.slice(0, 3)) {
    const bare = String(w).toLowerCase().replace(/[^\p{L}\p{N}_']/gu, "");
    if (bare.length > 1) out.add(bare);
  }
  return out;
}

/** Whether a caption word is one of the key words (the same word, or the same root of 5+ letters). */
export function isEmphasised(word: string, keys: ReadonlySet<string>): boolean {
  if (!keys.size) return false;
  const bare = word.toLowerCase().replace(/[^\p{L}\p{N}_']/gu, "");
  if (!bare) return false;
  for (const k of keys) {
    if (bare === k || (k.length >= 5 && bare.startsWith(k)) || (bare.length >= 5 && k.startsWith(bare) && k.length - bare.length <= 2)) return true;
  }
  return false;
}
