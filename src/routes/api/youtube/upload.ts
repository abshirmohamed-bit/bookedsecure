import { createFileRoute } from "@tanstack/react-router";

/**
 * Receives one piece of a video for YouTube and passes it on with the
 * business's token, which never reaches the browser. The caller must be signed
 * in, be the business owner who started the upload, and send the signed ticket
 * from startYouTubeVideoUpload plus the piece's first byte (?start=).
 */
const MAX_PART_BYTES = 16 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/youtube/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const ticket = params.get("ticket") ?? "";
        const start = Number(params.get("start") ?? "NaN");
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!ticket || ticket.length > 4096 || token.split(".").length !== 3) return json(401, { error: "Sign in again to upload." });
        if (!Number.isInteger(start) || start < 0) return json(400, { error: "That piece of the video doesn't fit." });
        const length = Number(request.headers.get("content-length") ?? "0");
        if (length > MAX_PART_BYTES) return json(413, { error: "That piece of the video is too big." });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: user, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user?.user) return json(401, { error: "Sign in again to upload." });
        try {
          const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
          const ctx = await requireAppContext(supabaseAdmin, user.user.id);
          requireOwner(ctx);
          const { uploadYouTubeChunk, verifyYouTubeTicket } = await import("@/lib/youtube.server");
          const pass = verifyYouTubeTicket(ticket);
          if (!pass || pass.businessId !== ctx.businessId) return json(403, { error: "This upload link has expired. Choose the video again." });
          const bytes = await request.arrayBuffer();
          if (bytes.byteLength > MAX_PART_BYTES) return json(413, { error: "That piece of the video is too big." });
          return json(200, await uploadYouTubeChunk({ ticket, userId: ctx.userId, start, bytes }));
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : "The upload didn't work." });
        }
      },
    },
  },
});
