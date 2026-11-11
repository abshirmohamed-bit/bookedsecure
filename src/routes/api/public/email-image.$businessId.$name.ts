/**
 * Public pictures for booking confirmation emails.
 *
 * Email clients load images when the email is opened, so these have to be
 * readable by anyone with the address. The address names a business and an
 * unguessable file; only files of that exact shape, in that business's own
 * email folder, are ever served (see booking-email-images.server.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { TENANT_LOGO_BUCKET } from "@/lib/tenant-logo";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };

export const Route = createFileRoute("/api/public/email-image/$businessId/$name")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { businessId, name } = params;
        if (!UUID.test(businessId)) return new Response("Not found", { status: 404 });
        const { emailImagePath } = await import("@/lib/booking-email-images.server");
        const path = emailImagePath(businessId, name);
        if (!path) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const file = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).download(path);
        if (file.error || !file.data) return new Response("Not found", { status: 404 });

        const ext = name.split(".").pop() ?? "";
        return new Response(await file.data.arrayBuffer(), {
          headers: {
            "Content-Type": TYPES[ext] ?? "application/octet-stream",
            // Every upload gets a new name, so the file behind an address never changes.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
