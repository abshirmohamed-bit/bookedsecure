import { describe, expect, it } from "vitest";
import { emphasisSet, isEmphasised } from "@/lib/caption-emphasis";
import { captionYFor, headlineAlpha } from "@/lib/clip-looks";

describe("key words in captions (mirrors engine caption.emphasised)", () => {
  const keys = emphasisSet(["homeless", "Truth!", "a", "x", "extra", "fourth"]);
  it("keeps up to three clean words", () => {
    expect([...keys]).toEqual(["homeless", "truth"]);
  });
  it("matches the word, its root and punctuation around it", () => {
    expect(isEmphasised("homeless,", keys)).toBe(true);
    expect(isEmphasised("Homelessness", keys)).toBe(true);
    expect(isEmphasised("TRUTH.", keys)).toBe(true);
    expect(isEmphasised("home", keys)).toBe(false);
    expect(isEmphasised("anything", new Set())).toBe(false);
  });
});

describe("the headline for the opening only", () => {
  it("shows fully, fades over its last 300 ms, then is gone", () => {
    expect(headlineAlpha(null, 99_000)).toBe(1);
    expect(headlineAlpha(4000, 1000)).toBe(1);
    expect(headlineAlpha(4000, 3850)).toBeCloseTo(0.5);
    expect(headlineAlpha(4000, 4000)).toBe(0);
  });
  it("waits for the question card, then fades in", () => {
    expect(headlineAlpha(null, 1000, 2800)).toBe(0);
    expect(headlineAlpha(null, 2950, 2800)).toBeCloseTo(0.5);
    expect(headlineAlpha(6800, 5000, 2800)).toBe(1);
  });
});

describe("captions off the face", () => {
  it("uses the Engine's height for a shot when it moved the line under the chin", () => {
    expect(captionYFor({ kind: "fill", caption_y: 0.71 }, 1080, 1920, { w: 1920, h: 1080 })).toBe(0.71);
    expect(captionYFor({ kind: "fill" }, 1080, 1920, { w: 1920, h: 1080 })).toBeNull();
  });
});

describe("which layouts change a clip", () => {
  it("knows the shots that carry each look", async () => {
    const { layoutLookKinds } = await import("@/lib/video-clips");
    expect(layoutLookKinds("split")).toEqual(["split"]);
    expect(layoutLookKinds("screen")).toEqual(["screen", "graphic"]);
    expect(layoutLookKinds("full-video")).toBeNull();
    expect(layoutLookKinds("streamer")).toBeNull();
  });
});
