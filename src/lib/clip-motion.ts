/**
 * The Engine's camera, played back in the browser: each shot's per-frame
 * crop (glides, the breathing zoom, punch-ins) and the short transition into
 * a shot whose composition changed. The live preview and the browser render
 * both read the plan through here, so they move exactly as the Engine's MP4.
 */

export type MotionBox = { x: number; y: number; w: number; h: number };
/** [ms, x, y, w, h], clip-relative ms, every few frames (interpolate between). */
export type MotionSample = [number, number, number, number, number];
export type MotionShot = {
  start_ms: number; end_ms: number; kind: string;
  window: MotionBox | null; pan: [number, number][];
  motion?: MotionSample[]; transition?: string | null;
};

/** How long the Engine's transitions run (camera.TRANSITION_MS). */
export const TRANSITION_MS = 200;

/** Where a shot's crop is at `ms`: its camera path, or its window slid along the pan. */
export function cropAt(shot: MotionShot, ms: number): MotionBox | null {
  const m = shot.motion;
  if (m && m.length) {
    if (ms <= m[0]![0]) return box(m[0]!);
    for (let i = 1; i < m.length; i++) {
      const b = m[i]!;
      if (ms <= b[0]) {
        const a = m[i - 1]!;
        const u = (ms - a[0]) / Math.max(1, b[0] - a[0]);
        return { x: a[1] + (b[1] - a[1]) * u, y: a[2] + (b[2] - a[2]) * u, w: a[3] + (b[3] - a[3]) * u, h: a[4] + (b[4] - a[4]) * u };
      }
    }
    return box(m[m.length - 1]!);
  }
  const win = shot.window;
  if (!win) return null;
  const pan = shot.pan;
  if (!pan.length) return win;
  if (ms <= pan[0]![0]) return { ...win, x: pan[0]![1] };
  for (let i = 1; i < pan.length; i++) {
    const [t1, x1] = pan[i]!;
    const [t0, x0] = pan[i - 1]!;
    if (ms <= t1) return { ...win, x: x0 + ((x1 - x0) * (ms - t0)) / Math.max(1, t1 - t0) };
  }
  return { ...win, x: pan[pan.length - 1]![1] };
}

function box(s: MotionSample): MotionBox {
  return { x: s[1], y: s[2], w: s[3], h: s[4] };
}

/** The shot showing at `ms` (the nearest end one outside the plan). */
export function shotAt<S extends MotionShot>(shots: S[], ms: number): S | null {
  if (!shots.length) return null;
  return shots.find((s) => ms >= s.start_ms && ms < s.end_ms)
    ?? (ms < shots[0]!.start_ms ? shots[0]! : shots[shots.length - 1]!);
}

/**
 * A transition in progress at `ms`: the shots on either side, the Engine's
 * transition name and how far through it is (0..1). Null between transitions.
 */
export function transitionAt<S extends MotionShot>(shots: S[], ms: number): { from: S; to: S; name: string; p: number } | null {
  const half = TRANSITION_MS / 2;
  for (let i = 1; i < shots.length; i++) {
    const to = shots[i]!;
    if (!to.transition) continue;
    const d = ms - to.start_ms;
    if (d >= -half && d < half) return { from: shots[i - 1]!, to, name: to.transition, p: (d + half) / TRANSITION_MS };
  }
  return null;
}

/**
 * How the incoming picture is laid over the outgoing one at progress `p`,
 * close to ffmpeg's xfade of the same name: its opacity, a scale of the
 * outgoing picture, a vertical slide (share of the height) and a circular
 * reveal radius (share of the diagonal; null for none).
 */
export function transitionLook(name: string, p: number): { alpha: number; fromScale: number; slide: number; circle: number | null; circleOut: boolean } {
  const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
  switch (name) {
    case "zoomin": return { alpha: e, fromScale: 1 + 0.35 * e, slide: 0, circle: null, circleOut: false };
    case "smoothup": return { alpha: 1, fromScale: 1, slide: 1 - e, circle: null, circleOut: false };
    case "circleopen": return { alpha: 1, fromScale: 1, slide: 0, circle: e, circleOut: false };
    case "circleclose": return { alpha: 1, fromScale: 1, slide: 0, circle: 1 - e, circleOut: true };
    default: return { alpha: e, fromScale: 1, slide: 0, circle: null, circleOut: false };
  }
}
