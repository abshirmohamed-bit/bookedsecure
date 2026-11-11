import { describe, expect, it } from "vitest";
import { applyLineEdits, applyWordFixes, type CaptionWord, checkTrim, groupCaptionLines, mergeTrimmedWords } from "@/lib/video-clips";

const w = (text: string, start: number, end: number, extra: Record<string, unknown> = {}): CaptionWord => ({ text, start_ms: start, end_ms: end, ...extra });
const words = [w("so", 0, 200), w("teh", 200, 400, { speaker: 1 }), w("pool", 400, 600), w("is", 600, 800), w("clean.", 800, 1000), w("Done", 3000, 3300)];

describe("caption lines", () => {
  it("groups like the Engine: four words, then a new line", () => {
    expect(groupCaptionLines(words).map((l) => l.text)).toEqual(["so teh pool is", "clean.", "Done"]);
  });
  it("splits a line that runs past 1.6 seconds", () => {
    expect(groupCaptionLines([w("a", 0, 100), w("b", 1700, 1800)]).length).toBe(2);
  });
});

describe("line edits from the editor", () => {
  it("keeps timings and other fields when the word count matches", () => {
    const out = applyLineEdits(words, [{ start_ms: 0, from: "so teh pool is", to: "so the pool is" }]);
    expect(out[1]).toEqual(w("the", 200, 400, { speaker: 1 }));
    expect(out).toHaveLength(words.length);
  });
  it("spreads a different number of words over the line", () => {
    const out = applyLineEdits(words, [{ start_ms: 800, from: "clean.", to: "spotless now." }]);
    expect(out.slice(4, 6)).toEqual([w("spotless", 800, 900), w("now.", 900, 1000)]);
  });
  it("drops a cleared line", () => {
    expect(applyLineEdits(words, [{ start_ms: 3000, from: "Done", to: "  " }]).map((x) => x.text)).not.toContain("Done");
  });
  it("refuses an edit made on text that has since changed", () => {
    expect(() => applyLineEdits(words, [{ start_ms: 0, from: "something else", to: "x" }])).toThrow(/changed/);
    expect(() => applyLineEdits(words, [{ start_ms: 50, from: "so", to: "x" }])).toThrow(/changed/);
  });
});

describe("Co-Work word fixes", () => {
  it("replaces a word wherever it is said, keeping its punctuation", () => {
    const r = applyWordFixes(words, [{ wrong: "Clean", right: "sparkling" }, { wrong: "teh", right: "the" }]);
    expect(r.changed).toBe(2);
    expect(r.words.map((x) => x.text)).toEqual(["so", "the", "pool", "is", "sparkling.", "Done"]);
  });
  it("replaces a phrase", () => {
    const r = applyWordFixes(words, [{ wrong: "teh pool", right: "the spa" }]);
    expect(r.words.slice(1, 3).map((x) => x.text)).toEqual(["the", "spa"]);
  });
  it("reports nothing changed when the word isn't there", () => {
    expect(applyWordFixes(words, [{ wrong: "missing", right: "x" }]).changed).toBe(0);
  });
});

describe("keeping fixed words through a trim", () => {
  it("keeps corrected words inside the old range and fills new footage from the transcript", () => {
    // old clip 10s–11s with a fix; new clip 9.5s–10.6s
    const base = [w("fixed", 0, 400), w("word", 400, 900)];
    const fresh = [w("before", 0, 400), w("raw", 500, 900), w("raw2", 900, 1100)];
    const out = mergeTrimmedWords(base, 10_000, 11_000, fresh, 9_500, 10_600);
    expect(out.map((x) => x.text)).toEqual(["before", "fixed", "word"]);
    expect(out[1]).toMatchObject({ start_ms: 500, end_ms: 900 });
  });
});

describe("trim limits", () => {
  it("accepts a sensible trim and refuses the rest", () => {
    expect(checkTrim(1000, 20_000, 60_000)).toBeNull();
    expect(checkTrim(1000, 2000, 60_000)).toMatch(/3 seconds/);
    expect(checkTrim(1000, 70_000, 60_000)).toMatch(/after the video/);
    expect(checkTrim(-1, 5000, null)).toMatch(/before the video/);
  });
});

describe("a video's clipping defaults", () => {
  it("keeps only known choices", async () => {
    const { readJobOptions } = await import("@/lib/video-clips");
    expect(readJobOptions({ layout: "split", zoom: "moments", captionStyleId: "neon", captionPosition: "lower", captionSize: 1.2, titleEnabled: false, titleStyle: "clean", extra: 1 }))
      .toEqual({ layout: "split", zoom: "moments", captionStyleId: "neon", captionPosition: "lower", captionSize: 1.2, titleEnabled: false, titleStyle: "clean" });
    expect(readJobOptions({ layout: "diagonal", zoom: 3, captionSize: 9, titleStyle: "loud" })).toEqual({});
    expect(readJobOptions(null)).toEqual({});
    expect(readJobOptions("split")).toEqual({});
  });
});
