import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; value: unknown }[],
  answers: {} as Record<string, Result>,
  reads: [] as string[],
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    let op = "select";
    const chain: Record<string, unknown> = {};
    const result = (): Result => state.answers[`${table}:${op}`] ?? { data: null, error: null };
    for (const m of ["select", "eq", "neq", "in", "is", "not", "lt", "gte", "limit", "order", "or"]) chain[m] = () => chain;
    for (const m of ["insert", "update", "upsert", "delete"]) chain[m] = (v: unknown) => { op = m; state.writes.push({ table, op, value: v }); return chain; };
    chain["maybeSingle"] = async () => result();
    chain["single"] = async () => result();
    chain["then"] = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return chain;
  }
  return { supabaseAdmin: { from: builder } };
});
vi.mock("./meta-direct.server", () => ({ loadMetaAccount: async () => ({}) }));
vi.mock("./meta-publish.server", () => ({
  graph: () => async (_method: string, path: string) => {
    state.reads.push(path);
    return { insights: { data: [{ name: "post_impressions", values: [{ value: 500 }] }] }, reactions: { summary: { total_count: 20 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } };
  },
  metaAuthor: () => null, metaPostProblem: () => null, ownImagePath: () => null, publishMetaPost: async () => ({}),
}));

import { refreshPostInsights, sweepPostInsights } from "./social-planner.server";

const BIZ = "11111111-1111-4111-8111-111111111111";
const POST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

beforeEach(() => {
  state.writes = [];
  state.answers = {};
  state.reads = [];
});

describe("Facebook and Instagram figures", () => {
  it("are kept as history with the post's age", async () => {
    state.answers["linkedin_posts:select"] = { data: { id: POST, platform: "facebook", status: "published", post_urn: "123_456", published_at: ago(50) }, error: null };
    await refreshPostInsights(BIZ, POST);
    const snap = state.writes.find((w) => w.table === "post_insight_snapshots")?.value as Record<string, unknown>[];
    expect(snap).toEqual([expect.objectContaining({ business_id: BIZ, post_id: POST, platform: "facebook", age_hours: 50, metrics: expect.objectContaining({ impressions: 500, likes: 20 }) })]);
  });

  it("follow the same schedule: an older post is read once a day", async () => {
    state.answers["linkedin_posts:select"] = { data: [
      { id: POST, business_id: BIZ, published_at: ago(10 * 24), insights_at: ago(12) },
    ], error: null };
    expect(await sweepPostInsights()).toEqual({ refreshed: 0 });
    expect(state.reads).toEqual([]);
    expect(state.writes).toEqual([]);
  });
});
