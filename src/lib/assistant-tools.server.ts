/**
 * The owner assistant's tools.
 *
 * Each tool is a thin wrapper over existing tenant-scoped server logic. The
 * business and the signed-in user are closed over from the authenticated
 * request, never taken from the model, so the assistant can only ever read or
 * change the caller's own records. Texts still go through `sendSms`, so consent,
 * opt-outs, quiet hours, credit balance and daily caps all still apply.
 */
import { tool } from "ai";
import { executeAssistantOperation } from "@/lib/assistant-operations";
import { operationInputs } from "@/lib/assistant-operation-contracts";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normaliseAuMobile, LEAD_STATUSES } from "@/lib/domain";
import { formatInZone, zonedWallTimeToIso } from "@/lib/assistant-time";
import { upcomingBookings, visibleNotes } from "@/lib/bookings";
import type { OwnerProposal } from "@/lib/owner-actions.server";
import { buildOperationsTools } from "@/lib/assistant-tools-ops.server";
import { executeSharedAction, prepareAssistantText, customerInput, serviceInput, addonInput, textInput } from "@/lib/assistant-shared-actions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type ExecutedAction = { summary: string };

export type AssistantToolContext = {
  client: SupabaseClient<Database>;
  businessId: string;
  userId: string;
  role: "owner" | "staff" | "platform_admin";
  timeZone: string;
  /** Collects a plain-English line for every change actually made. */
  record: (summary: string) => void;
  /** Hands a Confirm card back to the owner (texts, campaigns, imports). */
  propose: (proposal: OwnerProposal) => void;
  /** A contact file attached to this message, if any. Never model-supplied. */
  attachment: { filename: string; content: string } | null;
  /** The owner's own latest words, used to honour numbers they stated exactly. */
  request?: string;
};


const DATE = z
  .string()
  .describe("Local calendar date in the owner's own timezone, formatted YYYY-MM-DD.");
const TIME = z
  .string()
  .describe("Local 24-hour time in the owner's own timezone, formatted HH:MM. Use 09:00 when the owner gave a day but no time.");

export function fail(message: string) {
  return { ok: false as const, message };
}

export function buildAssistantTools(ctx: AssistantToolContext) {
  const { businessId, userId, timeZone } = ctx;

  async function resolveStart(date: string, time: string) {
    const iso = zonedWallTimeToIso(date, time, timeZone);
    return iso;
  }

  async function findLeads(query: string, limit = 6) {
    const term = query.trim();
    const like = `%${term}%`;
    const { data } = await supabaseAdmin
      .from("leads")
      .select(
        "id, name, mobile_number, email, suburb, service_address, vehicle_type, service_intent, status, booking_status, notes, opted_out_at, created_at",
      )
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .or(`name.ilike.${like},mobile_number.ilike.${like},email.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data ?? [];
  }

  return {
    find_customers: tool({
      description:
        "Search this business's own customers by name, mobile or email. Always use this before changing or booking anything, so the right person is chosen.",
      inputSchema: z.object({
        query: z.string().describe("Part of the customer's name, mobile number or email."),
      }),
      execute: async ({ query }) => {
        const rows = await findLeads(query);
        if (rows.length === 0) return { matches: [], message: "No customer matches that." };
        const jobs = await supabaseAdmin
          .from("jobs")
          .select("id, lead_id, scheduled_at, completion_status, completed_value")
          .eq("business_id", businessId)
          .in(
            "lead_id",
            rows.map((row) => row.id as string),
          )
          .order("scheduled_at", { ascending: true });
        return {
          matches: rows.map((row) => ({
            leadId: row.id,
            name: row.name,
            mobile: row.mobile_number,
            email: row.email,
            suburb: row.suburb,
            address: row.service_address,
            vehicle: row.vehicle_type,
            requestedService: row.service_intent,
            status: row.status,
            bookingStatus: row.booking_status,
            optedOut: Boolean(row.opted_out_at),
            notes: visibleNotes(row.notes as string | null),
            jobs: (jobs.data ?? [])
              .filter((job) => job.lead_id === row.id)
              .map((job) => ({
                jobId: job.id,
                state: job.completion_status,
                when: job.scheduled_at ? formatInZone(job.scheduled_at as string, timeZone) : null,
                scheduledAt: job.scheduled_at,
                amount: job.completed_value,
              })),
          })),
        };
      },
    }),

    list_upcoming_bookings: tool({
      description: "List this business's upcoming bookings, soonest first.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).nullable(),
      }),
      execute: async ({ limit }) => {
        const { loadBookings } = await import("@/lib/bookings.server");
        const all = await loadBookings(businessId);
        return {
          bookings: upcomingBookings(all, new Date().toISOString())
            .slice(0, limit ?? 10)
            .map((entry) => ({
              jobId: entry.jobId,
              leadId: entry.leadId,
              customer: entry.customerName,
              service: entry.serviceName,
              when: entry.scheduledAt ? formatInZone(entry.scheduledAt, timeZone) : null,
              scheduledAt: entry.scheduledAt,
              suburb: entry.suburb,
            })),
        };
      },
    }),

    business_snapshot: tool({
      description:
        "Current counts for this business: leads, upcoming bookings, completed work, revenue and campaign state. Use it for any question about numbers.",
      inputSchema: z.object({}),
      execute: async () => {
        const { loadOwnerSnapshot } = await import("@/lib/owner-assistant.server");
        return await loadOwnerSnapshot(businessId);
      },
    }),

    list_services: tool({
      description: "This business's own services and add-ons, with current add-on availability.",
      inputSchema: z.object({}),
      execute: async () => {
        const { loadCatalog } = await import("@/lib/catalog-actions.server");
        const catalog = await loadCatalog(businessId);
        const { data: detail } = await supabaseAdmin
          .from("services")
          .select("id, name, price_guidance, duration_minutes, category, active")
          .eq("business_id", businessId)
          .order("name");
        return { services: detail ?? [], addons: catalog.addons };
      },
    }),

    create_customer: tool({
      description: "Add a new customer to this business's leads.",
      inputSchema: customerInput,
      execute: async (input) => {
        try {
          const result = await executeSharedAction(ctx.client, 'create_customer', input);
          ctx.record(`Added ${result.name} to your customers.`);
          return { ok: true, leadId: result.id };
        } catch (error) { return fail(error instanceof Error ? error.message : 'Nothing was saved.'); }
      },
    }),

    update_customer: tool({
      description:
        "Change a customer's details or status. Only the fields you pass are changed; leave the rest null.",
      inputSchema: operationInputs.update_customer,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'update_customer', input);
          ctx.record('Updated that customer.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    book_job: tool({
      description: "Book this customer in at a date and time. Use find_customers first.",
      inputSchema: operationInputs.book_job,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'book_job', input);
          ctx.record('Saved that booking.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    reschedule_job: tool({
      description: "Move an existing booking to a new date and time.",
      inputSchema: operationInputs.reschedule_job,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'reschedule_job', input);
          ctx.record('Moved that booking.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    cancel_job: tool({
      description:
        "Cancel a booking, including one already marked completed (a completed job cancelled this way has its recorded amount cleared from the totals). The customer is not messaged.",
      inputSchema: operationInputs.cancel_job,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'cancel_job', input);
          ctx.record('Cancelled that booking.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    delete_job: tool({
      description:
        "Permanently delete a job record from this business, whatever its state. use this when the owner says a booking or completed job was logged by mistake, was not requested, or should be removed from their totals. Get jobId from find_customers or list_upcoming_bookings. The customer and their messages are kept.",
      inputSchema: operationInputs.delete_job,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'delete_job', input);
          ctx.record('Deleted that job record.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    complete_job: tool({
      description:
        "Mark a customer's work as done, optionally recording what they paid. Leave jobId null to complete their most recent job.",
      inputSchema: operationInputs.complete_job,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'complete_job', input);
          ctx.record('Marked that job completed.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    upsert_service: tool({
      description: "Add or update a service using the owner's stated details. Pass serviceId to update.",
      inputSchema: serviceInput,
      execute: async (input) => {
        try {
          const result = await executeSharedAction(ctx.client, 'upsert_service', input);
          ctx.record(`Saved the service "${result.name}".`);
          return { ok: true, serviceId: result.id };
        } catch (error) { return fail(error instanceof Error ? error.message : 'Nothing was saved.'); }
      },
    }),

    upsert_addon: tool({
      description: "Add or update an optional extra. Pass addonId to update. Linking to services is separate.",
      inputSchema: addonInput,
      execute: async (input) => {
        try {
          const result = await executeSharedAction(ctx.client, 'upsert_addon', input);
          ctx.record(`Saved the extra "${result.name}".`);
          return { ok: true, addonId: result.id };
        } catch (error) { return fail(error instanceof Error ? error.message : 'Nothing was saved.'); }
      },
    }),

    set_addon_availability: tool({
      description:
        "Make an add-on available with named services, or remove it from them. Use list_services first for the exact ids.",
      inputSchema: operationInputs.set_addon_availability,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'set_addon_availability', input);
          ctx.record('Updated add-on availability.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    send_text: tool({
      description: "Prepare one text for the owner to confirm. Nothing sends until Confirm; existing SMS safeguards apply at send time.",
      inputSchema: textInput,
      execute: async (input) => {
        try {
          const proposal = await prepareAssistantText(ctx.client, businessId, input);
          ctx.propose(proposal);
          return { ok: true, awaitingConfirmation: true, to: proposal.leadName };
        } catch (error) { return fail(error instanceof Error ? error.message : 'Text could not be prepared.'); }
      },
    }),

    draft_campaign: tool({
      description:
        "Prepare or replace an SMS campaign for a group of this business's consented leads and show the actual saved messages to the owner for approval. If the owner supplies campaign wording, pass its editable middle section in campaignCopy so the saved drafts use it exactly; never merely repeat requested wording in your reply. Audiences: 'dormant' (past customers with no history on file), 'uncontacted' (leads never texted, e.g. a fresh import), 'status' (one inbox status such as new or contacted), or 'leads' (specific lead ids from find_customers or query_leads). Opt-outs, suppressed numbers and deleted leads are always excluded. Nothing sends until the owner approves on screen.",
      inputSchema: z.object({
        audience: z.enum(["dormant", "uncontacted", "status", "leads"]),
        status: z.enum(LEAD_STATUSES).nullable().describe("Required when audience is 'status'."),
        leadIds: z.array(z.string().uuid()).nullable().describe("Required when audience is 'leads'."),
        percent: z.number().int().min(1).max(90).nullable().describe("Discount percentage for the offer, if the owner named one."),
        offerText: z.string().max(120).nullable().describe("Exact offer wording if the owner gave one, e.g. '15% off your next detail'."),
        campaignCopy: z
          .string()
          .max(500)
          .nullable()
          .describe(
            "The owner's requested wording. Prefer only the editable middle section; if they paste the whole template, pass it and the server safely removes placeholder greeting/link/footer fields before personalising every draft.",
          ),
        maxLeads: z.number().int().min(1).max(500).nullable(),
        olderThanDays: z.number().int().min(1).max(3650).nullable(),
      }),
      execute: async (input) => {
        {
          const { planGateMessage } = await import("@/lib/subscription.server");
          const blocked = await planGateMessage(businessId, "campaigns");
          if (blocked) return fail(blocked);
        }
        const { proposeCampaign } = await import("@/lib/owner-actions.server");
        const audience =
          input.audience === "status"
            ? input.status
              ? ({ kind: "status", status: input.status } as const)
              : null
            : input.audience === "leads"
              ? input.leadIds && input.leadIds.length > 0
                ? ({ kind: "leads", leadIds: input.leadIds } as const)
                : null
              : ({ kind: input.audience } as const);
        if (!audience) return fail("Say which status or which customers the campaign is for.");
        // Whatever the model chose, the owner's own stated numbers win.
        const { parseCampaignNumbers } = await import("@/lib/owner-actions");
        const asked = parseCampaignNumbers(ctx.request ?? "");
        const percent = asked.percent ?? input.percent;
        const offerText =
          asked.percent !== null &&
          (!input.offerText || !input.offerText.includes(String(asked.percent)))
            ? null
            : input.offerText;
        const proposal = await proposeCampaign({
          businessId,
          userId,
          percent,
          offerText,
          campaignCopy: input.campaignCopy,
          maxLeads: asked.maxLeads ?? input.maxLeads,
          olderThanDays: asked.olderThanDays ?? input.olderThanDays,
          audience,
          fresh: true,
        });
        if (!proposal) return fail("A campaign could not be prepared right now.");
        if (proposal.drafts.length > 0) ctx.propose(proposal);

        return {
          ok: true,
          awaitingConfirmation: proposal.drafts.length > 0,
          campaignId: proposal.campaignId,
          offer: proposal.offerText,
          drafted: proposal.drafts.length,
          summary: proposal.summary,
          recipients: proposal.drafts.slice(0, 20).map((d) => d.leadName ?? d.mobileNumber),
        };
      },
    }),

    draft_email_campaign: tool({
      description:
        "Prepare an email campaign to this business's customers. Use find_customers first to pick the recipients, then pass their lead ids. The email is saved as a draft on the Email campaigns page; nothing sends until the owner reviews it there and presses Send. Customers without an email address or who unsubscribed are skipped automatically.",
      inputSchema: z.object({
        leadIds: z.array(z.string().uuid()).min(1).max(500),
        name: z.string().min(2).max(120).describe("Short internal name for the campaign."),
        subject: z.string().min(2).max(160),
        bodyText: z.string().min(2).max(5000).describe("The email body in the owner's words."),
      }),
      execute: async (input) => {
        const { createEmailCampaign } = await import("@/lib/email-campaigns.server");
        try {
          const result = await createEmailCampaign({
            businessId,
            userId,
            name: input.name,
            subject: input.subject,
            bodyText: input.bodyText,
            leadIds: input.leadIds,
          });
          ctx.record(
            `Drafted email campaign "${input.name}" for ${result.emailable} customer${result.emailable === 1 ? "" : "s"}.`,
          );
          return {
            ok: true,
            awaitingConfirmation: true,
            campaignId: result.campaignId,
            emailable: result.emailable,
            skippedNoEmail: result.skippedNoEmail,
            skippedUnsubscribed: result.skippedUnsubscribed,
            summary:
              "Draft saved on the Email campaigns page. Review it there and press Send when you're happy — nothing has been emailed yet.",
          };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "Could not draft the email campaign.");
        }
      },
    }),

    ...buildOperationsTools(ctx),
  };
}
