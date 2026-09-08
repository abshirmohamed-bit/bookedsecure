/**
 * Public logo image endpoint.
 *
 * Logos are branding, so they are readable by anyone who can see the tenant's
 * quote page. The files themselves live in private tenant-scoped storage: this
 * route only ever serves the logo recorded on the requested business row, so a
 * caller can never read another tenant's file by guessing a storage path.
 */
import { createFileRoute } from "@tanstack/react-router";
import { TENANT_LOGO_BUCKET, isOwnTenantLogoPath } from "@/lib/tenant-logo";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const Route = createFileRoute("/api/public/tenant-logo/$businessId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const businessId = params.businessId;
        if (!UUID.test(businessId)) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: business } = await supabaseAdmin
          .from("businesses")
          .select("logo_storage_path")
          .eq("id", businessId)
          .maybeSingle();

        const path = business?.logo_storage_path ?? null;
        if (!path || !isOwnTenantLogoPath(businessId, path)) {
          return new Response("Not found", { status: 404 });
        }

        const file = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).download(path);
        if (file.error || !file.data) return new Response("Not found", { status: 404 });

        return new Response(await file.data.arrayBuffer(), {
          headers: {
            "Content-Type": file.data.type || "image/png",
            // The URL carries a version marker, so the image itself is cacheable.
            "Cache-Control": "public, max-age=31536000, immutable",

          },
        });
      },
    },
  },
});
