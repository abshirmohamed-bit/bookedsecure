import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const state = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; value: unknown }[],
  /** Answers by "table:op"; a function gets the value written. */
  answers: {} as Record<string, Result | ((value: unknown, n: number) => Result)>,
  calls: {} as Record<string, number>,
  engine: [] as { method: string; path: string; body: unknown }[],
  engineAnswers: {} as Record<string, { ok: boolean; data?: unknown; error?: { code: string; message: string } }>,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    let op = "select";
    let value: unknown = null;
    const chain: Record<string, unknown> = {};
    const result = (): Result => {
      const key = `${table}:${op}`;
      state.calls[key] = (state.calls[key] ?? 0) + 1;
      const a = state.answers[key];
      if (typeof a === "function") return a(value, state.calls[key]!);
      return a ?? { data: null, error: null };
    };
    for (const m of ["select", "eq", "neq", "in", "is", "not", "lt", "gte", "limit", "order"]) chain[m] = () => chain;
    for (const m of ["insert", "update", "upsert", "delete"]) chain[m] = (v: unknown) => { op = m; value = v; state.writes.push({ table, op, value: v }); return chain; };
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
    return state.engineAnswers[`${method} ${path.replace(/\?.*$/, "")}`] ?? { ok: true, data: {} };
  },
}));

vi.mock("@/lib/clip-upload.server", () => ({
  browserUploadsReady: () => false, clipVideoKey: () => "k", publicUrlFor: () => "u", signedUploadUrl: async () => "s", uploadedSize: async () => 0,
}));

import { recordClipEvents } from "./clip-learning.server";
import { applyVideoEngineEvent, deleteClipJobs, renameClip, saveClipEdits } from "./video-clips.server";

const BIZ = "11111111-1111-4111-8111-111111111111";
const CLIP = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const events = () => state.writes.filter((w) => w.table === "video_clip_events" && w.op === "insert").flatMap((w) => w.value as Record<string, unknown>[]);

beforeEach(() => {
  state.writes = [];
  state.answers = {};
  state.calls = {};
  state.engine = [];
  state.engineAnswers = {};
});

describe("recording never gets in the way", () => {
  it("drops the rows quietly while the table doesn't exist yet", async () => {
    state.answers["video_clip_events:insert"] = { data: null, error: { code: "PGRST205", message: "no table" } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordClipEvents(BIZ, [{ kind: "posted", before: null, after: null, clipId: CLIP, jobId: JOB }])).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("a rename", () => {
  it("records the old and new title", async () => {
    state.answers["video_clips:select"] = { data: { id: CLIP, job_id: JOB, business_id: BIZ, title: "Engine title", status: "READY" }, error: null };
    state.answers["video_clips:update"] = { data: { id: CLIP }, error: null };
    await renameClip(BIZ, CLIP, "  My   title ");
    expect(events()).toEqual([expect.objectContaining({
      business_id: BIZ, clip_id: CLIP, job_id: JOB, kind: "title_changed", before: { title: "Engine title" }, after: { title: "My title" },
    })]);
  });
});

describe("deleting a video", () => {
  it("keeps what the Engine made for each of its clips", async () => {
    const original = { title: "T", layout: "auto", hookLine: "Hello." };
    state.answers["video_clips:select"] = { data: [{ id: CLIP, job_id: JOB, title: "T", status: "READY", original }], error: null };
    state.answers["video_clip_jobs:delete"] = { data: [{ id: JOB }], error: null };
    expect(await deleteClipJobs(BIZ, JOB)).toBe(1);
    expect(events()).toEqual([expect.objectContaining({
      kind: "deleted", clip_id: CLIP, job_id: JOB, before: { title: "T", status: "READY", original }, after: { scope: "video" },
    })]);
  });

  it("records nothing when the delete fails", async () => {
    state.answers["video_clips:select"] = { data: [{ id: CLIP, job_id: JOB, title: "T", status: "READY", original: null }], error: null };
    state.answers["video_clip_jobs:delete"] = { data: null, error: { message: "boom" } };
    await expect(deleteClipJobs(BIZ, JOB)).rejects.toThrow("boom");
    expect(events()).toEqual([]);
  });
});

describe("clips arriving from the Engine", () => {
  const webhook = {
    type: "autoclip.completed",
    data: { autoclip_id: "job_e", clips: [{
      project_id: "prj_1", index: 1, title: "A hook", start_ms: 0, end_ms: 30000, duration_ms: 30000, score: 90,
      grades: { hook: "A" }, finish: { layout: "split", caption_style_id: "bold_white", framing: { zoom: "auto", focus: "speaker" },
        captions: [{ text: "Wait." }], title_text: "WAIT", title_style: "bold_band", aspect: "9:16" },
    }] },
  };

  it("keep the Engine's own picks on the clip", async () => {
    state.answers["video_clip_jobs:select"] = { data: { id: JOB, business_id: BIZ, aspect: "9:16", options: null, status: "PROCESSING" }, error: null };
    await applyVideoEngineEvent(webhook);
    const upsert = state.writes.find((w) => w.table === "video_clips" && w.op === "upsert");
    expect((upsert?.value as Record<string, unknown>[])[0]?.["original"]).toMatchObject({ layout: "split", focus: "speaker", hookLine: "Wait.", score: 90 });
  });

  it("are still saved before the column exists", async () => {
    state.answers["video_clip_jobs:select"] = { data: { id: JOB, business_id: BIZ, aspect: "9:16", options: null, status: "PROCESSING" }, error: null };
    state.answers["video_clips:upsert"] = (_v, n) => (n === 1 ? { data: null, error: { code: "PGRST204", message: "no column original" } } : { data: null, error: null });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await applyVideoEngineEvent(webhook);
    warn.mockRestore();
    const upserts = state.writes.filter((w) => w.table === "video_clips" && w.op === "upsert").map((w) => (w.value as Record<string, unknown>[])[0]);
    expect(upserts).toHaveLength(2);
    expect(upserts[1]).not.toHaveProperty("original");
    expect(upserts[1]).toMatchObject({ engine_project_id: "prj_1", title: "A hook" });
  });
});

describe("saving the editor's changes", () => {
  const project = {
    in_ms: 0, out_ms: 30000, aspect: "9:16", layout: "auto", caption_style_id: "bold_white",
    caption_options: { position: "lower" }, captions: [], framing: { zoom: "auto" }, title: { text: "WAIT", enabled: true, style: "bold_band" },
  };
  beforeEach(() => {
    state.answers["video_clips:select"] = { data: { id: CLIP, job_id: JOB, business_id: BIZ, status: "READY", engine_project_id: "prj_1", engine_export_id: "exp_0", error: null, title: "A hook" }, error: null };
    state.answers["video_clips:update"] = { data: { id: CLIP }, error: null };
    state.answers["video_clip_jobs:select"] = { data: { duration_ms: 600000 }, error: null };
    state.engineAnswers["GET /v1/projects/prj_1"] = { ok: true, data: project };
    state.engineAnswers["POST /v1/projects/prj_1/export"] = { ok: true, data: { id: "exp_1" } };
  });

  it("records each kind of change once it is saved", async () => {
    await saveClipEdits(BIZ, CLIP, { layout: "split", headlineText: "They ate it ALL" });
    expect(events().map((e) => e["kind"])).toEqual(["layout_changed", "headline_changed"]);
    expect(events()[0]).toMatchObject({ clip_id: CLIP, job_id: JOB, before: { layout: "auto" }, after: { layout: "split" } });
    expect(events()[1]).toMatchObject({ before: { text: "WAIT" }, after: { text: "They ate it ALL" } });
  });

  it("records nothing when the Engine refused the change", async () => {
    state.engineAnswers["PATCH /v1/projects/prj_1"] = { ok: false, error: { code: "VALIDATION_ERROR", message: "nope" } };
    await expect(saveClipEdits(BIZ, CLIP, { layout: "split" })).rejects.toThrow("nope");
    expect(events()).toEqual([]);
  });
});
