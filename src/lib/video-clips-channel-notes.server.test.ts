import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({
  answers: {} as Record<string, Result>,
  engine: [] as { method: string; path: string; body: unknown }[],
  notes: null as string | null,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    let op = "select";
    const chain: Record<string, unknown> = {};
    const result = (): Result => state.answers[`${table}:${op}`] ?? { data: null, error: null };
    for (const m of ["select", "eq", "neq", "in", "is", "not", "lt", "gte", "limit", "order"]) chain[m] = () => chain;
    for (const m of ["insert", "update", "upsert", "delete"]) chain[m] = () => { op = m; return chain; };
    chain["maybeSingle"] = async () => result();
    chain["single"] = async () => result();
    chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  }
  return { supabaseAdmin: { from: builder } };
});

vi.mock("@/lib/engine.server", () => ({
  engineConfigured: () => true,
  engineClient: async (method: string, path: string, body?: unknown) => {
    state.engine.push({ method, path, body });
    return { ok: true, data: { id: "engine_job_1" } };
  },
}));

vi.mock("@/lib/channel-lessons.server", () => ({ channelLessons: async () => state.notes }));

import { requestClips } from "./video-clips.server";

const BIZ = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  state.answers = {};
  state.engine = [];
  state.notes = null;
  state.answers["video_clip_jobs:select"] = { data: { id: JOB, business_id: BIZ, status: "WAITING", engine_asset_id: "ast_1", clip_count: null, aspect: "9:16", instructions: null, options: null }, error: null };
  state.answers["video_clip_jobs:update"] = (() => {
    let n = 0;
    return { get data() { n++; return n === 1 ? { id: JOB, business_id: BIZ, status: "QUEUED", clip_requested: true, engine_asset_id: "ast_1", clip_count: null, aspect: "9:16", instructions: null, options: null } : { id: JOB }; }, error: null };
  })();
});

describe("submitting an autoclip job", () => {
  it("carries the channel's lessons when there are any", async () => {
    state.notes = "Best hooks here ask a question.";
    await requestClips(BIZ, JOB, {});
    const call = state.engine.find((e) => e.path === "/v1/autoclip");
    expect((call?.body as Record<string, unknown>)?.["channel_notes"]).toBe("Best hooks here ask a question.");
  });

  it("sends nothing extra when there isn't enough history yet", async () => {
    state.notes = null;
    await requestClips(BIZ, JOB, {});
    const call = state.engine.find((e) => e.path === "/v1/autoclip");
    expect(call?.body).not.toHaveProperty("channel_notes");
  });
});
