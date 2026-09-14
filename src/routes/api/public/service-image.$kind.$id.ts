/**
 * Public service / add-on picture endpoint.
 *
 * Pictures are shown on the customer quote page, so they are readable by
 * anyone. Files live in private tenant-scoped storage: this route only serves
 * the picture recorded on the requested row, never an arbitrary path.
 */
import { createFileRoute } from "@tanstack/react-router";
import { TENANT_LOGO_BUCKET } from "@/lib/tenant-logo";
import { isOwnServiceImagePath, isServiceImageKind } from "@/lib/service-images";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const Route = createFileRoute("/api/public/service-image/$kind/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { kind, id } = params;
        if (!isServiceImageKind(kind) || !UUID.test(id)) return new Response("Not found", { status: 404 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const table = kind === "service" ? "services" : "service_addons";
        const { data: row } = await supabaseAdmin
          .from(table)
          .select("business_id, image_storage_path")
          .eq("id", id)
          .maybeSingle();

        const path = row?.image_storage_path ?? null;
        if (!row || !path || !isOwnServiceImagePath(row.business_id, path)) {
          return new Response("Not found", { status: 404 });
        }

        const file = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).download(path);
        if (file.error || !file.data) return new Response("Not found", { status: 404 });

        return new Response(await file.data.arrayBuffer(), {
          headers: {
            "Content-Type": file.data.type || "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      },
    },
  },
});
