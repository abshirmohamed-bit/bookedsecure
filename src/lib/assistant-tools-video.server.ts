/**
 * Co-Work's video tools. The business is closed over from the signed-in request,
 * so jobs and clips of another business can't be named. Finished clips are
 * posted by the owner from the Social media page; nothing here publishes.
 */
import { tool } from "ai";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { controlEngine, isEngineOperator, readEngineState } from "@/lib/engine-control.server";
import { z } from "zod";
import type { AssistantToolContext } from "@/lib/assistant-tools.server";
import { jobStatusLabel, VIDEO_ASPECTS } from "@/lib/video-clips";
import { clipFromLink, engineConfigured, listVideoJobs, renderClip, requestClips } from "@/lib/video-clips.server";

const OPTIONS = {
  aspect: z.enum(VIDEO_ASPECTS).default("9:16").describe("9:16 for Reels, TikTok and Shorts unless the owner chose otherwise."),
  clipCount: z.number().int().min(1).max(20).nullable().default(null).describe("How many clips. Null lets the Engine decide."),
  instructions: z.string().max(1000).default("").describe("What to look for, and the style the owner chose. Their words only."),
};
const fail = (message: string) => ({ ok: false as const, message });
const NOT_ON = "Video clipping isn't switched on for this workspace yet.";

export function buildVideoTools(ctx: AssistantToolContext) {
  async function run<T extends object>(label: string | null, work: () => Promise<T>) {
    try {
      const result = await work();
      if (label) ctx.record(label);
      return { ok: true as const, ...result };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "That didn't work.");
    }
  }

  return {
    clip_uploaded_video: tool({
      description: "Cut a video the owner attached on the Social media page into short clips with captions. Use the attached video id from the request. They own a video they uploaded, so don't ask about rights. The best clips render automatically and appear in Results.",
      inputSchema: z.object({ videoId: z.string().uuid().describe("The attached video id from the request."), ...OPTIONS }),
      execute: async ({ videoId, ...options }) => {
        if (!engineConfigured()) return fail(NOT_ON);
        return run("Started cutting your video into clips.", async () => {
          const job = await requestClips(ctx.businessId, videoId, options);
          return { videoId: job.id, status: jobStatusLabel(job) };
        });
      },
    }),

    clip_video_from_link: tool({
      description: "Cut a video at a public link (YouTube and similar) into short clips. Only call with rightsConfirmed true after the owner has said in this conversation that they own the video or have permission to clip it; if they haven't, ask them first.",
      inputSchema: z.object({
        url: z.string().url().max(2000),
        name: z.string().max(200).optional(),
        rightsConfirmed: z.boolean().describe("True only if the owner has explicitly said they hold the rights."),
        ...OPTIONS,
      }),
      execute: async ({ url, name, rightsConfirmed, ...options }) => {
        if (!engineConfigured()) return fail(NOT_ON);
        if (!rightsConfirmed) return fail("Ask the owner to confirm they own this video or have permission to clip it.");
        return run("Started cutting that video into clips.", async () => {
          const job = await clipFromLink({ businessId: ctx.businessId, userId: ctx.userId, url, name, options });
          return { videoId: job.id, status: jobStatusLabel(job) };
        });
      },
    }),

    video_clips_status: tool({
      description: "The videos being clipped and the clips made so far: progress, titles, why each was picked, and which are ready to watch. Use before answering any question about clips.",
      inputSchema: z.object({}),
      execute: async () => run(null, async () => ({
        switchedOn: engineConfigured(),
        videos: (await listVideoJobs(ctx.businessId)).map((job) => ({
          videoId: job.id, name: job.source_name, status: jobStatusLabel(job), progress: job.progress, problem: job.error,
          clips: job.clips.map((c) => ({ clipId: c.id, title: c.title, why: c.reason, seconds: c.duration_ms ? Math.round(c.duration_ms / 1000) : null, state: c.status === "READY" ? "ready" : c.status === "EXPORTING" ? "rendering" : c.status === "FAILED" ? "failed" : "not rendered yet" })),
        })),
      })),
    }),

    video_engine_status: tool({
      description: "Whether the video engine is on, idle (asleep, and wakes by itself when a video needs cutting) or off (needs attention).",
      inputSchema: z.object({}),
      execute: async () => run(null, async () => {
        const reading = await readEngineState();
        return (await isEngineOperator(ctx.userId)) ? reading : { state: reading.state, label: reading.label };
      }),
    }),

    control_video_engine: tool({
      description: "Start, stop or restart the video engine, which every business shares. Only for people allowed to run it. Stopping or restarting needs the person's clear yes. If it reports jobs in progress, tell them what would be interrupted and pass force true only if they then say to go ahead. Stopping is a sleep: it wakes by itself when a video needs cutting.",
      inputSchema: z.object({ action: z.enum(["start", "stop", "restart"]), force: z.boolean().default(false) }),
      execute: async ({ action, force }) => {
        if (!(await isEngineOperator(ctx.userId))) return fail("Only the people who run BookedSecure can control the video engine. Clipping a video wakes it by itself.");
        try {
          const result = await controlEngine(action, force);
          if (!result.ok) return fail(result.message);
          ctx.record(result.message);
          await supabaseAdmin.from("audit_events").insert({ business_id: ctx.businessId, user_id: ctx.userId, event_type: "assistant_engine_control", entity_type: "business", entity_id: ctx.businessId, metadata: { action, force } })
            .then(() => undefined, () => undefined);
          return { ok: true as const, message: result.message };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "The engine couldn't be changed.");
        }
      },
    }),

    render_video_clip: tool({
      description: "Render one clip that isn't ready yet so it can be watched and posted. Use the clipId from video_clips_status.",
      inputSchema: z.object({ clipId: z.string().uuid() }),
      execute: async ({ clipId }) => run("Started rendering that clip.", async () => { await renderClip(ctx.businessId, clipId); return { status: "rendering" }; }),
    }),
  };
}
