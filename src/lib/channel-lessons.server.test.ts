import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({ answers: {} as Record<string, Result> }));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    let op = "select";
    const chain: Record<string, unknown> = {};
    const result = (): Result => state.answers[`${table}:${op}`] ?? { data: [], error: null };
    for (const m of ["select", "eq", "neq", "in", "is", "not", "gte", "lte", "order", "limit"]) chain[m] = () => chain;
    for (const m of ["insert", "update", "upsert", "delete"]) chain[m] = () => { op = m; return chain; };
    chain["maybeSingle"] = async () => result();
    chain["single"] = async () => result();
    chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  }
  return { supabaseAdmin: { from: builder } };
});

import { channelLessons } from "./channel-lessons.server";

const BIZ = "11111111-1111-4111-8111-111111111111";

beforeEach(() => { state.answers = {}; });

function clipRow(i: number, over: Record<string, unknown> = {}) {
  return { id: `clip${i}`, job_id: `job${i}`, title: `Title ${i}`,
    original: { title: `Title ${i}`, hookLine: `Hook ${i}`, layout: "auto", durationMs: 40000, grades: null, score: null, reason: null, sceneAnalysis: null, captionStyleId: null, zoom: null, focus: null, aspect: null, headline: null },
    ...over };
}

describe("gathering one business's clip history", () => {
  it("is null when there isn't enough posted history", async () => {
    state.answers["video_clips:select"] = { data: [clipRow(1)], error: null };
    expect(await channelLessons(BIZ)).toBeNull();
  });

  it("joins a clip's events, posted stats and score into a usable summary", async () => {
    const clips = Array.from({ length: 6 }, (_, i) => clipRow(i, { original: { ...clipRow(i).original, hookLine: `Winning hook ${i}` } }));
    state.answers["video_clips:select"] = { data: clips, error: null };
    state.answers["linkedin_posts:select"] = {
      data: clips.map((c, i) => ({ id: `post${i}`, video_clip_id: c.id, platform: "youtube", insights: { views: 1000, engagements: 50 + i * 10, averageViewPercent: null } })),
      error: null,
    };
    state.answers["video_clip_events:select"] = { data: [], error: null };
    const text = await channelLessons(BIZ);
    expect(text).toBeTruthy();
    expect(text).toContain("Winning hook 5");
  });

  it("never throws, even if a query fails", async () => {
    state.answers["video_clips:select"] = { data: null, error: { message: "db down" } };
    await expect(channelLessons(BIZ)).resolves.toBeNull();
  });
});
