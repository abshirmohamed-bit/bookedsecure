/**
 * The customer agent's tools.
 *
 * Every tool is a thin wrapper over the same tenant-scoped server logic the
 * deterministic quote flow uses. The business, the slug and the conversation are
 * closed over from the resolved public tenant, never taken from the model, so a
 * tool can only ever read or change this tenant's own records. Slots and
 * bookings stay server-computed and server-committed.
 */
import { tool } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { addonsForService } from "@/lib/service-addons";
import type { PilotOffer } from "@/lib/web-chat-booking";
import type { WebChatCollected, WebChatTenant } from "@/lib/web-chat";

export type QuoteAgentToolContext = {
  businessId: string;
  slug: string;
  tenantName: string;
  conversationId: string;
  formUrl: string | null;
  tenant: WebChatTenant;
  /** Live conversation state, mutated in place as tools succeed. */
  collected: WebChatCollected;
  leadId: string | null;
  /** Plain-English line for each change actually made, for the audit trail. */
  record: (summary: string) => void;
  /** Set when a booking was committed on this turn. */
  onBooked: (slotStart: string, confirmation: string) => void;
  /** Set when the conversation must be handed to the owner. */
  onHandoff: (reason: string) => void;
  /** Times offered on this turn, so the reply can show them as buttons. */
  onOffers: (offers: PilotOffer[]) => void;
  /** Persists the mutated conversation state. */
  save: (patch: Record<string, unknown>) => Promise<void>;
};

function fail(message: string) {
  return { ok: false as const, message };
}

export function buildQuoteAgentTools(ctx: QuoteAgentToolContext) {
  return {
    list_services: tool({
      description:
        "This business's own services and extras, with the prices and inclusions exactly as the business wrote them. Use before answering anything about what they do or what it costs.",
      inputSchema: z.object({}),
      execute: async () => ({
        services: ctx.tenant.services.map((service) => ({
          id: service.id,
          name: service.name,
          price: service.price_guidance ?? null,
          minutes: service.duration_minutes ?? null,
          about: service.description,
          includes: service.included_items,
          excludes: service.excluded_items,
          note: service.qualification_note,
          extras: addonsForService(ctx.tenant.addons ?? [], service.id).map((addon) => ({
            name: addon.name,
            price: addon.price_guidance ?? null,
            available: addon.active !== false,
          })),
        })),
      }),
    }),

    save_enquiry: tool({
      description:
        "Save this customer's enquiry against this business. Call once you have their name, mobile number and what they want, and again later to add details. Requires that they have agreed to be contacted.",
      inputSchema: z.object({
        name: z.string().describe("The customer's name as they gave it."),
        mobile: z.string().describe("Their Australian mobile number as they gave it."),
        email: z.string().nullable(),
        service_id: z
          .string()
          .nullable()
          .describe("Id of the chosen service from list_services, or null if they described something else."),
        described_request: z
          .string()
          .nullable()
          .describe("What they asked for in their own words, when no listed service fits."),
        suburb: z.string().nullable(),
        address: z.string().nullable(),
        details: z.string().nullable().describe("Anything else useful: condition, size, vehicle, concerns."),
        consent_given: z.boolean().describe("True only if the customer agreed to be contacted, including by SMS."),
      }),
      execute: async (input) => {
        if (!input.consent_given) return fail("Ask for their agreement to be contacted first, then call again.");
        const { normaliseAuMobile } = await import("@/lib/domain");
        const mobile = normaliseAuMobile(input.mobile);
        if (!mobile) return fail("That mobile number does not look like an Australian mobile. Ask again.");

        const service = input.service_id
          ? (ctx.tenant.services.find((row) => row.id === input.service_id) ?? null)
          : null;
        if (input.service_id && !service) return fail("That service id is not one of this business's services.");

        const consentText = `I agree to ${ctx.tenantName} contacting me about this enquiry, including by SMS. Reply STOP at any time to opt out.`;
        const { captureLead } = await import("@/lib/lead-engine.server");

        if (!ctx.leadId) {
          const result = await captureLead({
            businessId: ctx.businessId,
            channel: "web",
            name: input.name.trim() || "Web visitor",
            mobile_number: mobile,
            email: input.email,
            suburb: input.suburb,
            service_address: input.address,
            main_concerns: input.details,
            service_intent: service?.name ?? input.described_request ?? "AI quote conversation",
            source_channel: "website",
            source_form: `ai_agent:${ctx.slug}`,
            source_metadata: {
              ai_chat: {
                tenant_slug: ctx.slug,
                web_conversation_id: ctx.conversationId,
                form_url: ctx.formUrl,
                agent: true,
              },
            },
            request_type: service ? "service" : "recommendation",
            approved_service_id: service?.id ?? null,
            service_name_snapshot: service?.name ?? null,
            flexible_request_text: input.described_request,
            requires_owner_review: !service,
            lead_origin: "ai_web_chat",
            // Deterministic per conversation: a retried save reuses the lead.
            external_id: `webchat:${ctx.conversationId}`,
            consent: true,
            consent_text: consentText,
            consent_source_url: ctx.formUrl,
          });
          ctx.leadId = result.leadId;
          ctx.record(`Saved the enquiry for ${input.name.trim() || "a web visitor"}.`);
        } else {
          await supabaseAdmin
            .from("leads")
            .update({
              name: input.name.trim() || undefined,
              mobile_number: mobile,
              email: input.email ?? undefined,
              suburb: input.suburb ?? undefined,
              service_address: input.address ?? undefined,
              main_concerns: input.details ?? undefined,
              service_intent: service?.name ?? input.described_request ?? undefined,
              approved_service_id: service?.id ?? undefined,
              service_name_snapshot: service?.name ?? undefined,
              flexible_request_text: input.described_request ?? undefined,
            } as never)
            .eq("id", ctx.leadId)
            .eq("business_id", ctx.businessId);
          ctx.record("Updated the saved enquiry with new details.");
        }

        ctx.collected.name = input.name.trim();
        ctx.collected.mobile_number = mobile;
        ctx.collected.email = input.email ?? null;
        ctx.collected.suburb = input.suburb ?? null;
        ctx.collected.service_address = input.address ?? null;
        ctx.collected.concerns = input.details ?? null;
        ctx.collected.service_id = service?.id ?? null;
        ctx.collected.service_name = service?.name ?? null;
        ctx.collected.typed_request = input.described_request ?? null;
        ctx.collected.consent = "granted";
        await ctx.save({
          lead_id: ctx.leadId,
          selected_service_id: service?.id ?? null,
          service_name_snapshot: service?.name ?? null,
          consent_outcome: "granted",
          requires_owner_review: !service,
        });
        return { ok: true as const, saved: true, hasService: Boolean(service) };
      },
    }),

    offer_times: tool({
      description:
        "Real open appointment times for the saved enquiry, computed from this business's own availability. Offer only these, and only after save_enquiry succeeded.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.leadId) return fail("Save the enquiry first with save_enquiry.");
        const { openBookingStep } = await import("@/lib/web-chat-booking.server");
        const booking = await openBookingStep({
          businessId: ctx.businessId,
          slug: ctx.slug,
          leadId: ctx.leadId,
        });
        if (!booking.offered || booking.offers.length === 0) {
          return { ok: true as const, times: [], message: "No times can be offered here; say the team will be in touch with times." };
        }
        ctx.collected.pilot_offers = booking.offers;
        ctx.collected.booking_offered = true;
        ctx.onOffers(booking.offers);
        await ctx.save({});
        return {
          ok: true as const,
          times: booking.offers.map((offer) => ({ when: offer.label, offer_id: offer.offer_id })),
        };
      },
    }),

    confirm_booking: tool({
      description:
        "Book the exact time the customer chose from offer_times. Only after this returns ok may you tell them the visit is booked.",
      inputSchema: z.object({
        when: z.string().describe("The chosen time exactly as offer_times worded it, or its offer_id."),
      }),
      execute: async ({ when }) => {
        if (!ctx.leadId) return fail("Save the enquiry first with save_enquiry.");
        const offers = ctx.collected.pilot_offers ?? [];
        const wanted = when.trim().toLowerCase();
        const match =
          offers.find((offer) => offer.offer_id === when.trim()) ??
          offers.find((offer) => offer.label.toLowerCase() === wanted) ??
          offers.find((offer) => offer.label.toLowerCase().includes(wanted)) ??
          null;
        if (!match) return fail("That time was not one of the offered times. Call offer_times again and offer those.");

        const { commitWebChatBooking, bookingConfirmationText, refreshBookingOffers } = await import(
          "@/lib/web-chat-booking.server"
        );
        const commit = await commitWebChatBooking({
          businessId: ctx.businessId,
          leadId: ctx.leadId,
          conversationId: ctx.conversationId,
          offerId: match.offer_id,
        });
        if (!commit.ok) {
          const fresh = await refreshBookingOffers({ businessId: ctx.businessId, leadId: ctx.leadId });
          ctx.collected.pilot_offers = fresh;
          if (fresh.length > 0) ctx.onOffers(fresh);
          await ctx.save({});
          return {
            ok: false as const,
            message:
              fresh.length > 0
                ? "That time has just gone. Apologise briefly and offer these instead."
                : "That time has just gone and nothing else is open. Say the team will be in touch with times.",
            times: fresh.map((offer) => ({ when: offer.label, offer_id: offer.offer_id })),
          };
        }

        const confirmation = await bookingConfirmationText({
          businessId: ctx.businessId,
          leadId: ctx.leadId,
          slotStart: commit.slotStart,
        });
        ctx.collected.booking_selected = match.offer_id;
        ctx.record(`Booked ${match.label}.`);
        ctx.onBooked(commit.slotStart, confirmation);
        return { ok: true as const, booked: match.label, replay: commit.replay };
      },
    }),

    hand_to_owner: tool({
      description:
        "Pass this conversation to the business owner: anything unusual, out of area, a complaint, or a change to a booking that already exists.",
      inputSchema: z.object({ reason: z.string() }),
      execute: async ({ reason }) => {
        ctx.onHandoff(reason);
        await ctx.save({ requires_owner_review: true });
        ctx.record(`Flagged for the owner: ${reason}`);
        return { ok: true as const, handedOver: true };
      },
    }),
  };
}
