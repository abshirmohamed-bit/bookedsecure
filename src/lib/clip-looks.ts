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
  ambientBrightness: 0.98,
  cinemaBrightness: 0.8,
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

/** Three people (portrait): a big card on top for the one talking, two below. Mirrors looks.spotlight_cards. */
export function spotlightCards(W: number, H: number): Box[] {
  const m = W * LOOK.duoMargin, g = W * LOOK.duoGap;
  const iw = W - 2 * m, ih = H - 2 * m - g;
  const top = ih * 0.56, bot = ih - top, half = (iw - g) / 2;
  return [{ x: m, y: m, w: iw, h: top }, { x: m, y: m + top + g, w: half, h: bot }, { x: m + half + g, y: m + top + g, w: half, h: bot }];
}

/** Four people: a 2 x 2 of cards. Mirrors looks.quad_cards. */
export function quadCards(W: number, H: number): Box[] {
  const m = W * LOOK.duoMargin, g = W * LOOK.duoGap;
  const w = (W - 2 * m - g) / 2, h = (H - 2 * m - g) / 2;
  return [0, 1, 2, 3].map((i) => ({ x: m + (i % 2) * (w + g), y: m + Math.floor(i / 2) * (h + g), w, h }));
}

/** Presenter mode: the screen card on top (to `top` px, the Engine's screen_split) and the speaker card below. */
export function presenterCards(W: number, H: number, top: number): [Box, Box] {
  const m = W * LOOK.duoMargin, g = W * LOOK.duoGap;
  const w = W - 2 * m, th = top - m - g / 2, bh = H - top - m - g / 2;
  return [{ x: m, y: m, w, h: th }, { x: m, y: m + th + g, w, h: bh }];
}
