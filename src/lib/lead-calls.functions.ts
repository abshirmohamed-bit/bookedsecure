import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Recent calls (the team can read) and the business's word for the thing it services. */
export const getLeadCalls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const { listCalls } = await import("@/lib/lead-calls.server");
    return { ...(await listCalls(app.businessId)), subjectLabel: await subjectLabelFor(app.businessId) };
  });

async function subjectLabelFor(businessId: string): Promise<string> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { nicheKitFor } = await import("@/lib/niche");
    const { readSavedProfile } = await import("@/lib/business-profile");
    const { data } = await supabaseAdmin.from("businesses").select("trade, quote_subject_label").eq("id", businessId).maybeSingle();
    const own = ((data?.quote_subject_label as string | null) ?? "").trim();
    if (own) return own;
    const { data: p } = await supabaseAdmin.from("businesses").select("business_profile").eq("id", businessId).maybeSingle()
      .then((r) => r, () => ({ data: null }));
    const profile = readSavedProfile((p as { business_profile?: unknown } | null)?.business_profile);
    return nicheKitFor({ trade: (data?.trade as string | null) ?? null, model: profile?.model ?? null, suggestedSubject: profile?.enquirySubject ?? null, flow: profile?.enquiryFlow ?? null }).subjectLabel;
  } catch {
    return "Job";
  }
}

export const getLeadCall = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ callId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const { getCall } = await import("@/lib/lead-calls.server");
    return getCall(app.businessId, data.callId);
  });

export const logLeadCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    text: z.string().trim().min(10).max(20_000),
    direction: z.enum(["outbound", "inbound"]),
    durationMinutes: z.number().min(0).max(600).optional(),
    leadId: z.string().uuid().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    const { logCall } = await import("@/lib/lead-calls.server");
    return logCall({ businessId: app.businessId, userId: app.userId, ...data });
  });

export const saveLeadCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ callId: z.string().uuid(), fields: z.record(z.string(), z.string().max(1000)) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    const { saveCallToLead } = await import("@/lib/lead-calls.server");
    return saveCallToLead({ businessId: app.businessId, userId: app.userId, callId: data.callId, fields: data.fields });
  });
