// Short personal campaign link: /b/<token>.
//
// The contact's private token identifies their lead record, so this loader
// resolves their tenant's own quote page and redirects there with the token
// attached. the chat then recognises them exactly as with the long link.
// Universal: no tenant identifier lives in code; an unknown token simply
// lands on the home page.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const Route = createFileRoute("/b/$token")({
  loader: async ({ params }) => {
    const token = params.token.trim();
    if (token) {
      const { data: lead } = await supabaseAdmin
        .from("leads")
        .select("business_id")
        .eq("public_token", token)
        .is("deleted_at", null)
        .maybeSingle();
      if (lead?.business_id) {
        const { data: business } = await supabaseAdmin
          .from("businesses")
          .select("slug")
          .eq("id", lead.business_id)
          .maybeSingle();
        const slug = typeof business?.slug === "string" ? business.slug.trim() : "";
        if (slug) {
          throw redirect({
            href: `/quote/${encodeURIComponent(slug)}?c=${encodeURIComponent(token)}`,
          });
        }
      }
    }
    throw redirect({ href: "/" });
  },
  component: () => null,
});
