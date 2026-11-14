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
  /** Podcast poster's progress bar: height and lift from the bottom (share of the height). */
  progress: { height: 0.006, lift: 0.025, alpha: 0.9 },
  /** The on-screen card under a person takes at most this share of the height. */
  graphicMax: 0.38,
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

/** The reaction bubble in a W x H frame, on the side the Engine chose (away from the speaker's face). */
export function pipBox(W: number, H: number, side?: string | null): Box {
  const w = W * LOOK.pip.width, h = w / LOOK.pip.aspect;
  const x = side === "left" ? W * LOOK.pip.right : W - w - W * LOOK.pip.right;
  return { x, y: H * LOOK.pip.top, w, h };
}

/** The part of the source the screen card shows: the screen region the Engine found beside a corner webcam, else all of it. */
export function screenCrop(cells: Box[] | null | undefined, src: { w: number; h: number }): Box {
  return cells && cells[0] ? cells[0] : { x: 0, y: 0, w: src.w, h: src.h };
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

/**
 * A card on screen (a tweet, a comment): the person on top and the card (gw x gh source px)
 * whole below. Mirrors looks.graphic_cards.
 */
export function graphicCards(W: number, H: number, gw: number, gh: number): [Box, Box] {
  const m = W * LOOK.duoMargin, g = W * LOOK.duoGap;
  const iw = W - 2 * m, ih = H - 2 * m - g;
  let cw = iw, ch = (cw * gh) / Math.max(1, gw);
  if (ch > ih * LOOK.graphicMax) { ch = ih * LOOK.graphicMax; cw = (ch * gw) / Math.max(1, gh); }
  const ph = ih - ch;
  return [{ x: m, y: m, w: iw, h: ph }, { x: m + (iw - cw) / 2, y: m + ph + g, w: cw, h: ch }];
}

/**
 * Where captions sit for a shot's composition (centre, 0 top .. 1 bottom), or null for the
 * style's own place: on the seam of two cards, over the person just above an on-screen card.
 * Mirrors shots.caption_y; used only when the captions weren't dragged or put top/bottom.
 */
export function captionYFor(
  shot: { kind: string; main?: Box | null; inset?: Box | null; caption_y?: number | null } | null | undefined,
  W: number, H: number, src: { w: number; h: number },
): number | null {
  if (!shot || !H || H < W) return null;
  // The Engine moved the line off the face in this shot (shots.place_captions).
  if (typeof shot.caption_y === "number" && Number.isFinite(shot.caption_y)) return shot.caption_y;
  if (shot.kind === "split") return 0.5;
  if (shot.kind === "screen" && shot.main) return Math.min(H * 0.5, (W * src.h) / Math.max(1, src.w)) / H;
  if (shot.kind === "graphic" && shot.inset) {
    const [person] = graphicCards(W, H, shot.inset.w, shot.inset.h);
    return (person.y + person.h) / H - 0.06;
  }
  return null;
}

/** Presenter mode: the screen card on top (to `top` px, the Engine's screen_split) and the speaker card below. */
export function presenterCards(W: number, H: number, top: number): [Box, Box] {
  const m = W * LOOK.duoMargin, g = W * LOOK.duoGap;
  const w = W - 2 * m, th = top - m - g / 2, bh = H - top - m - g / 2;
  return [{ x: m, y: m, w, h: th }, { x: m, y: m + th + g, w, h: bh }];
}

/** 1 while the headline shows, fading to 0 over its last 300 ms when it shows for the opening only. */
export function headlineAlpha(untilMs: number | null, rel: number, fromMs: number | null = null): number {
  // After a question card (fromMs), the headline fades in over 300 ms.
  if (fromMs && rel < fromMs) return 0;
  const fadeIn = fromMs ? Math.min(1, (rel - fromMs) / 300) : 1;
  if (!untilMs) return fadeIn;
  if (rel >= untilMs) return 0;
  return Math.min(fadeIn, Math.max(0, (untilMs - rel) / 300));
}
