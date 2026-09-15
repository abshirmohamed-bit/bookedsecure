import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const QuoteSchema = z.object({
  slug: z.string().min(2).max(40),
  name: z.string().min(2).max(80),
  mobile_number: z.string().min(8).max(20),
  email: z.string().email().max(120).optional().nullable(),
  suburb: z.string().min(2).max(80),
  service_address: z.string().max(200).optional().nullable(),
  vehicle_type: z.string().max(60).optional().nullable(),
  last_cleaned_at: z.string().max(60).optional().nullable(),
  main_concerns: z.string().max(500).optional().nullable(),
  request_type: z.enum(["quote", "service", "recommendation"]),
  approved_service_id: z.string().uuid().optional().nullable(),
  flexible_request_text: z.string().max(500).optional().nullable(),
  consent: z.literal(true),
  submission_nonce: z.string().min(8).max(40),
  form_url: z.string().max(300).optional().nullable(),
  referrer: z.string().max(300).optional().nullable(),
  /** Raw query string values from the landing URL; preserved as attribution. */
  params: z.record(z.string(), z.string().max(200)).optional().nullable(),
  // Honeypot: real customers never see or fill this field.
  company: z.string().max(200).optional().nullable(),
});

export const submitQuoteRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => QuoteSchema.parse(input))
  .handler(async ({ data }) => {
    const { normaliseAuMobile } = await import("@/lib/domain");
    const {
      buildAttribution,
      formIdempotencyKey,
      requiresOwnerReview,
      validateSelection,
      REQUEST_TYPE_LABELS,
    } = await import("@/lib/quote-form");

    // Silently accept honeypot hits so bots get no signal.
    if (data.company && data.company.trim().length > 0) {
      return { ok: true as const, duplicate: false as const, acknowledgementSent: false, note: null };
    }

    const mobile = normaliseAuMobile(data.mobile_number);
    if (!mobile) {
      return { ok: false as const, error: "Please enter a valid Australian mobile number." };
    }

    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";

    const { allowPublicFormAttempt } = await import("@/lib/rate-limit.server");
    const allowed = await allowPublicFormAttempt(ip);
    if (!allowed) {
      return { ok: false as const, error: "Too many enquiries from this device. Please try again shortly." };
    }

    try {
      // Tenant identity comes only from the slug; never from a client-supplied business id.
      const { resolvePublicTenant, resolveTenantService } = await import("@/lib/quote-form.server");
      const tenant = await resolvePublicTenant(data.slug);
      if (!tenant) {
        return { ok: false as const, error: "This enquiry form is not available." };
      }

      const issues = validateSelection(
        {
          request_type: data.request_type,
          approved_service_id: data.approved_service_id ?? null,
          flexible_request_text: data.flexible_request_text ?? null,
        },
        { flexibleEnabled: tenant.flexibleRequestsEnabled },
      );
      if (issues.length > 0) {
        return {
          ok: false as const,
          error:
            issues[0] === "flexible_not_enabled"
              ? "Please choose one of the listed services."
              : "Please tell us which service you need, or describe what you're after.",
        };
      }

      let serviceId: string | null = null;
      let serviceName: string | null = null;
      if (data.approved_service_id) {
        const service = await resolveTenantService(tenant.businessId, data.approved_service_id);
        serviceId = service.id;
        serviceName = service.name;
      }

      const attribution = buildAttribution({
        slug: tenant.slug,
        params: data.params ?? {},
        formUrl: data.form_url ?? null,
        referrer: data.referrer ?? null,
      });

      const externalId = formIdempotencyKey({
        businessId: tenant.businessId,
        mobile,
        requestType: data.request_type,
        nonce: data.submission_nonce,
      });

      const ownerReview = requiresOwnerReview({
        request_type: data.request_type,
        approved_service_id: serviceId,
      });

      const consentText = `I agree to ${tenant.name} contacting me by SMS about this enquiry. Reply STOP at any time to opt out.`;

      const { captureLead } = await import("@/lib/lead-engine.server");
      const result = await captureLead({
        businessId: tenant.businessId,
        name: data.name,
        mobile_number: mobile,
        email: data.email ?? null,
        suburb: data.suburb,
        service_address: data.service_address ?? null,
        vehicle_type: data.vehicle_type ?? null,
        last_cleaned_at: data.last_cleaned_at ?? null,
        main_concerns: data.main_concerns ?? null,
        service_intent: serviceName ?? REQUEST_TYPE_LABELS[data.request_type],
        source_channel: attribution.source_channel,
        source_form: attribution.source_form,
        source_campaign: attribution.source_campaign,
        utm_source: attribution.utm_source,
        utm_campaign: attribution.utm_campaign,
        source_metadata: { quote_form: attribution.metadata },
        request_type: data.request_type,
        approved_service_id: serviceId,
        service_name_snapshot: serviceName,
        flexible_request_text: data.flexible_request_text ?? null,
        requires_owner_review: ownerReview,
        lead_origin: "inbound_form",
        external_id: externalId,
        consent: true,
        consent_text: consentText,
        consent_source_url: data.form_url ?? null,
      });

      // Duplicate protection stays in captureLead (soft-deleted leads included,
      // 30-minute window unchanged). Nothing was created on this path, so report
      // it explicitly instead of letting the form claim success.
      if (result.duplicate) {
        const { duplicateQuoteResponse } = await import("@/lib/quote-duplicate");
        return duplicateQuoteResponse();
      }

      return {
        ok: true as const,
        duplicate: false as const,
        acknowledgementSent: result.acknowledgementSent,
        note: result.note ?? null,
      };
    } catch (error) {
      console.error("[quote] capture failed", error);
      return { ok: false as const, error: "We couldn't send your enquiry. Please try again shortly." };
    }
  });

/** Public tenant + service catalogue for rendering the form. No PII, active tenants only. */
export const getPublicQuoteForm = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ slug: z.string().min(1).max(60) }).parse(input))
  .handler(async ({ data }) => {
    const { resolvePublicTenant } = await import("@/lib/quote-form.server");
    const tenant = await resolvePublicTenant(data.slug);
    if (!tenant) return null;
    return {
      slug: tenant.slug,
      name: tenant.name,
      logoUrl: tenant.logoUrl,
      serviceArea: tenant.serviceArea,
      privacyPolicyUrl: tenant.privacyPolicyUrl,
      flexibleRequestsEnabled: tenant.flexibleRequestsEnabled,
      quoteMode: tenant.quoteMode,
      quoteSubjectLabel: tenant.quoteSubjectLabel,
      quoteSubjectOptions: tenant.quoteSubjectOptions,
      services: tenant.services,
    };
  });
