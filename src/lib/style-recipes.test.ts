import { describe, expect, it } from "vitest";
import type { ClipOriginal } from "@/lib/clip-learning";
import { describeRecipes, learnStyleRecipes, type RecipeClip, type RecipeEvent } from "@/lib/style-recipes";

const original = (over: Partial<ClipOriginal> = {}): ClipOriginal => ({
  title: "A", startMs: 0, endMs: 30000, durationMs: 30000, score: 80, grades: null, reason: null, sceneAnalysis: null,
  layout: "split", captionStyleId: "bold_white", zoom: "auto", focus: null, aspect: "9:16",
  headline: { text: "HI", style: "bold_band" }, hookLine: null, vibe: "conversation", captionPosition: "lower", captionSize: 1,
  ...over,
});
const clip = (o: Partial<ClipOriginal>, events: RecipeEvent[] = [], extra: Partial<RecipeClip> = {}): RecipeClip => ({
  original: original(o), events, posted: events.some((e) => e.kind === "posted"), deleted: false, ...extra,
});
const layoutTo = (layout: string): RecipeEvent => ({ kind: "layout_changed", before: { layout: "split" }, after: { layout } });
const posted: RecipeEvent = { kind: "posted", before: null, after: { platform: "youtube" } };

describe("learnStyleRecipes", () => {
  it("learns nothing from clips nobody touched", () => {
    const r = learnStyleRecipes([clip({}), clip({}), clip({})]);
    expect(r).toEqual({ layouts: {}, evidence: {}, house: {}, clipsUsed: 0 });
  });

  it("learns the layout the owner keeps moving a kind of clip to", () => {
    const r = learnStyleRecipes([clip({}, [layoutTo("pip")]), clip({}, [layoutTo("pip")]), clip({ vibe: "talking_head", layout: "full-video" })]);
    expect(r.layouts).toEqual({ conversation: "pip" });
    expect(r.evidence["conversation"]).toBe(2);
  });

  it("counts posts as keeping the Engine's look", () => {
    const r = learnStyleRecipes([clip({}, [posted]), clip({}, [posted])]);
    expect(r.layouts).toEqual({ conversation: "split" });
  });

  it("needs a clear lead, not a split decision", () => {
    const r = learnStyleRecipes([clip({}, [layoutTo("pip")]), clip({}, [layoutTo("pip")]), clip({}, [layoutTo("grid")]), clip({}, [layoutTo("grid")])]);
    expect(r.layouts).toEqual({});
  });

  it("one change is not enough", () => {
    expect(learnStyleRecipes([clip({}, [layoutTo("pip")])]).layouts).toEqual({});
  });

  it("deletes count against what the Engine made", () => {
    const r = learnStyleRecipes([clip({}, [posted]), clip({}, [posted]), clip({}, [], { deleted: true }), clip({}, [], { deleted: true })]);
    // split: 2 + 2 - 1 - 1 = 2, below the bar
    expect(r.layouts).toEqual({});
  });

  it("only the last change to a field counts, and unknown values are ignored", () => {
    const r = learnStyleRecipes([
      clip({}, [layoutTo("grid"), layoutTo("pip")]), clip({}, [layoutTo("pip")]), clip({}, [layoutTo("spinning")]),
    ]);
    expect(r.layouts).toEqual({ conversation: "pip" });
  });

  it("learns a house style for captions, zoom and headline across kinds of clips", () => {
    const cap = (styleId: string, position: string, size: number): RecipeEvent => ({ kind: "caption_changed", before: null, after: { styleId, position, size } });
    const zoom: RecipeEvent = { kind: "zoom_changed", before: { zoom: "auto" }, after: { zoom: "off" } };
    const head: RecipeEvent = { kind: "headline_changed", before: null, after: { style: "clean" } };
    const r = learnStyleRecipes([
      clip({ vibe: "talking_head" }, [cap("karaoke", "middle", 1.2), zoom, head]),
      clip({ vibe: "screen" }, [cap("karaoke", "middle", 1.24), zoom, head]),
    ]);
    expect(r.house).toEqual({ captionStyleId: "karaoke", captionPosition: "middle", captionSize: 1.2, zoom: "off", titleStyle: "clean" });
  });

  it("deleted clips whose rows are gone still count", () => {
    const gone = { original: original(), events: [], posted: false, deleted: true };
    const r = learnStyleRecipes([clip({}, [layoutTo("pip")]), clip({}, [layoutTo("pip")]), gone]);
    expect(r.layouts).toEqual({ conversation: "pip" });
    expect(r.clipsUsed).toBe(3);
  });

  it("clips from before reviews (no vibe) teach only the house style", () => {
    const r = learnStyleRecipes([clip({ vibe: null }, [layoutTo("pip")]), clip({ vibe: null }, [layoutTo("pip")])]);
    expect(r.layouts).toEqual({});
  });
});

describe("describeRecipes", () => {
  it("says it in the owner's words", () => {
    const lines = describeRecipes({ layouts: { conversation: "pip" }, evidence: { conversation: 3 }, house: { captionPosition: "middle", zoom: "off" }, clipsUsed: 4 });
    expect(lines).toEqual([
      "For two people talking back and forth: Picture-in-picture (from 3 clips).",
      "Captions sit in the middle.",
      "Zoom: no zoom.",
    ]);
  });
});
