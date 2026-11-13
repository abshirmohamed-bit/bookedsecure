import { describe, expect, it } from "vitest";
import { buildChannelLessons, LESSONS_CHAR_CAP, type LessonsClip, metricValue, MIN_CLIPS_FOR_LESSONS } from "@/lib/channel-lessons";

const clip = (over: Partial<LessonsClip> = {}): LessonsClip => ({
  id: "c1", deleted: false, editKinds: [], score: null,
  original: { title: "T", startMs: 0, endMs: 1000, durationMs: 40000, score: 80, grades: null, reason: null, sceneAnalysis: null,
    layout: "auto", captionStyleId: "bold_white", zoom: "auto", focus: "speaker", aspect: "9:16",
    headline: null, hookLine: "A hook." },
  ...over,
});

describe("a single comparable score from a post's figures", () => {
  it("prefers average view percent when YouTube Analytics gave one", () => {
    expect(metricValue({ averageViewPercent: 58.4, views: 1000, engagements: 10 } as never)).toBe(58.4);
  });
  it("falls back to an engagement rate when there is no retention figure", () => {
    expect(metricValue({ averageViewPercent: null, views: 200, engagements: 40 } as never)).toBe(20);
  });
  it("is null without enough to compute anything", () => {
    expect(metricValue({ averageViewPercent: null, views: null, engagements: null } as never)).toBeNull();
    expect(metricValue({ averageViewPercent: null, views: 0, engagements: 0 } as never)).toBeNull();
  });
});

describe("not enough history yet", () => {
  it("is null below the minimum number of scored clips", () => {
    const clips = Array.from({ length: MIN_CLIPS_FOR_LESSONS - 1 }, (_, i) => clip({ id: `c${i}`, score: 50 }));
    expect(buildChannelLessons(clips)).toBeNull();
  });
  it("counts only clips with a score towards the minimum", () => {
    const clips = [
      ...Array.from({ length: MIN_CLIPS_FOR_LESSONS }, (_, i) => clip({ id: `c${i}`, score: null })),
      ...Array.from({ length: MIN_CLIPS_FOR_LESSONS - 1 }, (_, i) => clip({ id: `s${i}`, score: 50 })),
    ];
    expect(buildChannelLessons(clips)).toBeNull();
  });
});

function scored(n: number, scoreFor: (i: number) => number, over: (i: number) => Partial<LessonsClip> = () => ({})) {
  return Array.from({ length: n }, (_, i) => clip({ id: `c${i}`, score: scoreFor(i), ...over(i) }));
}

describe("with enough history", () => {
  it("names the best-performing hooks", () => {
    const clips = scored(6, (i) => i * 10, (i) => ({ original: { ...clip().original!, hookLine: `Hook ${i}` } }));
    const text = buildChannelLessons(clips);
    expect(text).toContain("Hook 5");
    expect(text).toContain("Hook 4");
    expect(text).not.toContain("Hook 0");
  });

  it("names the layout most used by the better half", () => {
    const clips = scored(6, (i) => i * 10, (i) => ({ original: { ...clip().original!, layout: i >= 3 ? "split" : "grid" } }));
    expect(buildChannelLessons(clips)).toContain("split");
  });

  it("names the length that does best", () => {
    const clips = scored(6, (i) => i * 10, (i) => ({ original: { ...clip().original!, durationMs: i >= 3 ? 50000 : 90000 } }));
    const text = buildChannelLessons(clips)!;
    expect(text).toMatch(/30.?s|45.?s|30-?60/);
  });

  it("gives deleted clips as examples to avoid, by title", () => {
    const clips = [
      ...scored(5, (i) => 50 + i * 5),
      clip({ id: "bad", score: null, deleted: true, original: { ...clip().original!, title: "Four people eat groceries" } }),
    ];
    expect(buildChannelLessons(clips)).toContain("Four people eat groceries");
  });

  it("notes a kind of edit the owner makes on most clips", () => {
    const clips = scored(6, (i) => 50 + i, () => ({ editKinds: ["layout_changed"] }));
    const text = buildChannelLessons(clips)!;
    expect(text.toLowerCase()).toContain("layout");
  });

  it("never mentions an edit kind only a few clips had", () => {
    const clips = scored(6, (i) => 50 + i, (i) => ({ editKinds: i === 0 ? ["zoom_changed"] : [] }));
    expect(buildChannelLessons(clips)!.toLowerCase()).not.toContain("zoom");
  });

  it("stays under the character cap", () => {
    const clips = scored(40, (i) => i, (i) => ({
      original: { ...clip().original!, hookLine: `A very long opening hook line number ${i} that goes on a fair bit` },
      editKinds: ["headline_changed"],
    }));
    const text = buildChannelLessons(clips)!;
    expect(text.length).toBeLessThanOrEqual(LESSONS_CHAR_CAP);
  });

  it("is deterministic for the same input", () => {
    const clips = scored(6, (i) => i * 7);
    expect(buildChannelLessons(clips)).toEqual(buildChannelLessons(clips));
  });
});
