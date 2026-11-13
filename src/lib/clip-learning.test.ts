import { describe, expect, it } from "vitest";
import { clipOriginal, deletedEvent, editEvents, hookLine, lookAfter, postedEvent, titleEvent, type ClipLook } from "@/lib/clip-learning";

/** A clip as the Engine's autoclip.completed webhook reports it (full: true). */
const engineClip = {
  project_id: "prj_1", index: 3, title: "Four people must eat a whole grocery store",
  start_ms: 1000, end_ms: 46000, duration_ms: 45000, source_start_ms: 1656304, source_end_ms: 1701304,
  score: 98, grades: { hook: "A+", flow: "A", value: "B", trend: "C" },
  scene_analysis: "The challenge is revealed.", reason: "Instant stakes.",
  finish: {
    captions: [
      { text: "You", start_ms: 0, end_ms: 200 }, { text: "have", start_ms: 200, end_ms: 400 },
      { text: "to", start_ms: 400, end_ms: 500 }, { text: "eat", start_ms: 500, end_ms: 700 },
      { text: "everything.", start_ms: 700, end_ms: 1200 }, { text: "Ready?", start_ms: 1500, end_ms: 1900 },
    ],
    caption_style_id: "bold_white", caption_options: { position: "lower", size: 1.1 },
    title_text: "EAT THE WHOLE STORE", title_style: "bold_band",
    aspect: "9:16", layout: "auto", framing: { mode: "auto", focus: "everyone", zoom: "auto" },
  },
};

describe("what the Engine made, kept to compare later edits with", () => {
  it("keeps the finder's judgement and the look it chose", () => {
    const o = clipOriginal(engineClip, { aspect: "9:16", options: null });
    expect(o).toMatchObject({
      title: "Four people must eat a whole grocery store", startMs: 1656304, endMs: 1701304, durationMs: 45000,
      score: 98, grades: { hook: "A+", flow: "A", value: "B", trend: "C" }, reason: "Instant stakes.",
      layout: "auto", captionStyleId: "bold_white", zoom: "auto", focus: "everyone", aspect: "9:16",
      headline: { text: "EAT THE WHOLE STORE", style: "bold_band" },
      hookLine: "You have to eat everything.",
    });
  });

  it("falls back to the job's own choices when the Engine sent the short form", () => {
    const short = { project_id: "prj_2", title: "A", start_ms: 0, end_ms: 30000, duration_ms: 30000, score: null };
    const o = clipOriginal(short, { aspect: "1:1", options: { layout: "split", zoom: "off", captionStyleId: "karaoke" } });
    expect(o).toMatchObject({ layout: "split", zoom: "off", captionStyleId: "karaoke", aspect: "1:1", hookLine: null, grades: null });
  });

  it("never stores anything that isn't plain data", () => {
    const o = clipOriginal({ ...engineClip, grades: "not an object", score: "98" }, { aspect: "9:16", options: null });
    expect(o.grades).toBeNull();
    expect(o.score).toBeNull();
  });
});

describe("the hook line: what is said first", () => {
  it("stops at the end of the first sentence", () => {
    expect(hookLine([{ text: "So." }, { text: "Next" }])).toBe("So.");
  });
  it("stops after 14 words when nobody pauses", () => {
    const words = Array.from({ length: 30 }, (_, i) => ({ text: `w${i}` }));
    expect(hookLine(words)?.split(" ")).toHaveLength(14);
  });
  it("is null without words", () => {
    expect(hookLine([])).toBeNull();
  });
});

const before: ClipLook = {
  inMs: 1000, outMs: 46000, layout: "auto", zoom: "auto", aspect: "9:16",
  styleId: "bold_white", captionsOn: true, captionPosition: "lower", captionSize: 1, captionY: null,
  headline: { text: "EAT THE WHOLE STORE", enabled: true, style: "bold_band", position: "auto" },
};

describe("what an owner's save changed", () => {
  it("records a trim with the old and new times", () => {
    const after = lookAfter(before, {}, { inMs: 3000, outMs: 40000 });
    expect(editEvents(before, after, ["trim"])).toEqual([
      { kind: "trimmed", before: { inMs: 1000, outMs: 46000, durationMs: 45000 }, after: { inMs: 3000, outMs: 40000, durationMs: 37000 } },
    ]);
  });

  it("gives each kind of change its own row, once", () => {
    const after = lookAfter(before, { layout: "split", zoom: "off", captionPosition: "middle", styleId: "karaoke" }, { inMs: 1000, outMs: 46000 });
    const events = editEvents(before, after, ["layout", "zoom", "caption position", "caption style"]);
    expect(events.map((e) => e.kind)).toEqual(["layout_changed", "zoom_changed", "caption_changed"]);
    expect(events[0]).toEqual({ kind: "layout_changed", before: { layout: "auto" }, after: { layout: "split" } });
    expect(events[2]?.after).toMatchObject({ styleId: "karaoke", position: "middle", changes: ["caption position", "caption style"] });
  });

  it("keeps the headline the owner rewrote", () => {
    const after = lookAfter(before, { headlineText: "They ate EVERYTHING" }, { inMs: 1000, outMs: 46000 });
    expect(editEvents(before, after, ["headline"])).toEqual([{
      kind: "headline_changed",
      before: { text: "EAT THE WHOLE STORE", enabled: true, style: "bold_band", position: "auto" },
      after: { text: "They ate EVERYTHING", enabled: true, style: "bold_band", position: "auto", changes: ["headline"] },
    }]);
  });

  it("notes corrected caption words without copying the words", () => {
    const events = editEvents(before, before, ["caption words"]);
    expect(events).toEqual([{ kind: "caption_changed", before: expect.any(Object), after: expect.objectContaining({ changes: ["caption words"] }) }]);
  });

  it("records nothing when nothing changed", () => {
    expect(editEvents(before, before, [])).toEqual([]);
  });
});

describe("renames, posts and deletes", () => {
  it("a rename keeps both titles", () => {
    expect(titleEvent("Old", "New")).toEqual({ kind: "title_changed", before: { title: "Old" }, after: { title: "New" } });
  });
  it("a rename to the same title is nothing", () => {
    expect(titleEvent("Same", "Same")).toBeNull();
  });
  it("a post keeps where it went and the title it went out with", () => {
    expect(postedEvent({ title: "Clip title" }, { platform: "youtube", title: "Posted title", postId: "p1" })).toEqual({
      kind: "posted", before: { title: "Clip title" }, after: { platform: "youtube", title: "Posted title", postId: "p1" },
    });
  });
  it("a delete keeps what the Engine made, since the clip row goes with it", () => {
    const original = clipOriginal(engineClip, { aspect: "9:16", options: null });
    expect(deletedEvent({ title: "T", status: "READY", original }, "video")).toEqual({
      kind: "deleted", before: { title: "T", status: "READY", original }, after: { scope: "video" },
    });
  });
});
