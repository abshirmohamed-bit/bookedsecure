import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AffiliateProduct = {
  id: string;
  brand: string;
  title: string;
  category: string;
  shortDescription: string;
  imageUrl: string | null;
  destinationUrl: string;
  priceLabel: string | null;
  disclosureLabel: string;
  isAffiliate: boolean;
};

export const listAffiliateProducts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    await requireAppContext(context.supabase, context.userId);

    const { data, error } = await context.supabase
      .from("affiliate_products")
      .select(
        "id, brand, title, category, short_description, image_url, destination_url, price_label, disclosure_label, is_affiliate",
      )
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw new Error(error.message);

    return (data ?? []).map((product) => ({
      id: product.id,
      brand: product.brand,
      title: product.title,
      category: product.category,
      shortDescription: product.short_description,
      imageUrl: product.image_url,
      destinationUrl: product.destination_url,
      priceLabel: product.price_label,
      disclosureLabel: product.disclosure_label,
      isAffiliate: product.is_affiliate,
    })) satisfies AffiliateProduct[];
  });

export const recordAffiliateProductEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        productIds: z.array(z.string().uuid()).min(1).max(12),
        eventKind: z.enum(["impression", "click"]),
        pagePath: z.string().trim().max(200).default("/dashboard"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const rows = data.productIds.map((productId) => ({
      business_id: app.businessId,
      user_id: app.userId,
      product_id: productId,
      event_kind: data.eventKind,
      page_path: data.pagePath,
    }));
    const { error } = await context.supabase.from("affiliate_product_events").insert(rows);
    if (error) throw new Error(error.message);
    return { recorded: rows.length };
  });