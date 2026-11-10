import { createFileRoute } from "@tanstack/react-router";

/**
 * Receives one piece of an image, video or document for a LinkedIn post and
 * passes it to LinkedIn with the business's token, which never reaches the
 * browser. The caller must be signed in, be the business owner who started the
 * upload, and send the signed ticket from startLinkedInMediaUpload.
 */
const MAX_PART_BYTES = 32 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const Route = createFileRoute("/api/linkedin/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!ticket || ticket.length > 4096 || token.split(".").length !== 3) return json(401, { error: "Sign in again to upload." });
        const length = Number(request.headers.get("content-length") ?? "0");
        if (length > MAX_PART_BYTES) return json(413, { error: "That piece of the file is too big." });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: user, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user?.user) return json(401, { error: "Sign in again to upload." });
        try {
          const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
          const ctx = await requireAppContext(supabaseAdmin, user.user.id);
          requireOwner(ctx);
          const bytes = await request.arrayBuffer();
          if (bytes.byteLength > MAX_PART_BYTES) return json(413, { error: "That piece of the file is too big." });
          const { uploadLinkedInPart, verifyUploadTicket } = await import("@/lib/linkedin.server");
          const pass = verifyUploadTicket(ticket);
          if (!pass || pass.businessId !== ctx.businessId) return json(403, { error: "This upload link has expired. Try attaching the file again." });
          const result = await uploadLinkedInPart({ ticket, userId: ctx.userId, bytes });
          return json(200, { etag: result.etag });
        } catch (e) {
          return json(400, { error: e instanceof Error ? e.message : "The upload didn't work." });
        }
      },
    },
  },
});
