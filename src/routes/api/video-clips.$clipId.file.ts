import { createFileRoute } from "@tanstack/react-router";

/**
 * Passes a finished clip to the signed-in member's browser so it can go into
 * the posting tools, streamed so the server never holds the whole video.
 */
export const Route = createFileRoute("/api/video-clips/$clipId/file")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (token.split(".").length !== 3) return new Response("Sign in again.", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: user, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user?.user) return new Response("Sign in again.", { status: 401 });
        try {
          const { requireAppContext } = await import("@/lib/app-context.server");
          const ctx = await requireAppContext(supabaseAdmin, user.user.id);
          const { data: clip } = await supabaseAdmin.from("video_clips").select("video_url").eq("id", params.clipId).eq("business_id", ctx.businessId).eq("status", "READY").maybeSingle();
          if (!clip?.video_url) return new Response("That clip isn't ready.", { status: 404 });
          const file = await fetch(clip.video_url);
          if (!file.ok || !file.body) return new Response("That clip couldn't be read.", { status: 502 });
          return new Response(file.body, { headers: { "Content-Type": "video/mp4", "Cache-Control": "no-store", ...(file.headers.get("content-length") ? { "Content-Length": file.headers.get("content-length") as string } : {}) } });
        } catch {
          return new Response("That clip couldn't be read.", { status: 403 });
        }
      },
    },
  },
});
