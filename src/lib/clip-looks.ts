/**
 * The finishing looks, shared by the editor's live preview and the browser
 * render, mirroring the Engine's engine/app/pipeline/looks.py: rounded cards
 * with a soft shadow over a blurred, richer copy of the picture (ambient
 * glass), two people as two cards with a gap (duo cards), a rounded
 * reaction bubble, and cinema bars made of the picture itself.
 * Shares are of the output width unless named otherwise.
 */
export const LOOK = {
  radius: 0.045,
  shadowBlur: 0.035,
  shadowAlpha: 0.55,
  shadowDrop: 0.012,
  ambientBlur: 40 / 1080,
  ambientSaturation: 1.35,
  ambientBrightness: 0.92,
  cinemaBrightness: 0.68,
  glassWidth: 0.92,
  duoMargin: 0.035,
  duoGap: 0.025,
  pip: { width: 0.3, aspect: 0.75, right: 0.04, top: 0.18 },
} as const;

type Box = { x: number; y: number; w: number; h: number };

/** Where the two duo cards sit in a W x H frame. */
export function duoCards(W: number, H: number): [Box, Box] {
  const m = W * LOOK.duoMargin, gap = W * LOOK.duoGap;
  const w = W - 2 * m, h = (H - 2 * m - gap) / 2;
  return [{ x: m, y: m, w, h }, { x: m, y: m + h + gap, w, h }];
}

/** The ambient-glass card for a source of sw x sh in a W x H frame. */
export function glassCard(W: number, H: number, sw: number, sh: number): Box {
  let w = W * LOOK.glassWidth, h = (w * sh) / Math.max(1, sw);
  if (h > H * LOOK.glassWidth) { h = H * LOOK.glassWidth; w = (h * sw) / Math.max(1, sh); }
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** The reaction bubble in a W x H frame. */
export function pipBox(W: number, H: number): Box {
  const w = W * LOOK.pip.width, h = w / LOOK.pip.aspect;
  return { x: W - w - W * LOOK.pip.right, y: H * LOOK.pip.top, w, h };
}
