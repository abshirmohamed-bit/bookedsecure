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
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normaliseAuMobile, LEAD_STATUSES } from "@/lib/domain";
import { formatInZone, zonedWallTimeToIso } from "@/lib/assistant-time";
import { upcomingBookings, visibleNotes } from "@/lib/bookings";
import type { OwnerProposal } from "@/lib/owner-actions.server";
import { buildOperationsTools } from "@/lib/assistant-tools-ops.server";

export type ExecutedAction = { summary: string };

export type AssistantToolContext = {
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
      inputSchema: z.object({
        name: z.string(),
        mobile: z.string().describe("Australian mobile number as the owner said it."),
        email: z.string().nullable(),
        suburb: z.string().nullable(),
        address: z.string().nullable(),
        vehicle: z.string().nullable(),
        requestedService: z.string().nullable(),
        notes: z.string().nullable(),
      }),
      execute: async (input) => {
        const { data, error } = await supabaseAdmin
          .from("leads")
          .insert({
            business_id: businessId,
            name: input.name,
            mobile_number: normaliseAuMobile(input.mobile) ?? input.mobile,
            ...(input.email ? { email: input.email } : {}),
            ...(input.suburb ? { suburb: input.suburb } : {}),
            ...(input.address ? { service_address: input.address } : {}),
            ...(input.vehicle ? { vehicle_type: input.vehicle } : {}),
            ...(input.requestedService ? { service_intent: input.requestedService } : {}),
            ...(input.notes ? { notes: input.notes } : {}),
            lead_context: "manually_added_contact" as never,
            manual_entry_by: userId,
          } as never)
          .select("id")
          .single();
        if (error || !data) return fail(error?.message ?? "That customer could not be added.");
        ctx.record(`Added ${input.name} to your customers.`);
        return { ok: true, leadId: data.id };
      },
    }),

    update_customer: tool({
      description:
        "Change a customer's details or status. Only the fields you pass are changed; leave the rest null.",
      inputSchema: z.object({
        leadId: z.string().uuid(),
        name: z.string().nullable(),
        mobile: z.string().nullable(),
        email: z.string().nullable(),
        suburb: z.string().nullable(),
        address: z.string().nullable(),
        vehicle: z.string().nullable(),
        requestedService: z.string().nullable(),
        notes: z.string().nullable(),
        status: z.enum(LEAD_STATUSES).nullable(),
        clearOptOut: z
          .boolean()
          .nullable()
          .describe("Only true when the owner explicitly says this customer has agreed to receive texts again. Never infer it from a status change."),
      }),
      execute: async (input) => {
        const patch: Record<string, unknown> = {};
        if (input.name) patch["name"] = input.name;
        if (input.mobile) patch["mobile_number"] = normaliseAuMobile(input.mobile) ?? input.mobile;
        if (input.email) patch["email"] = input.email;
        if (input.suburb) patch["suburb"] = input.suburb;
        if (input.address) patch["service_address"] = input.address;
        if (input.vehicle) patch["vehicle_type"] = input.vehicle;
        if (input.requestedService) patch["service_intent"] = input.requestedService;
        if (input.notes) patch["notes"] = input.notes;
        if (input.status) patch["status"] = input.status;
        // "Opted out" is a real do-not-text flag, not just a label: setting it
        // blocks every send. Clearing it needs the owner's explicit say-so.
        if (input.status === "opted_out") {
          patch["opted_out_at"] = new Date().toISOString();
          patch["consent_status"] = "opted_out";
        }
        if (input.clearOptOut === true) {
          patch["opted_out_at"] = null;
          patch["consent_status"] = "granted";
        }
        if (Object.keys(patch).length === 0) return fail("Nothing was named to change.");

        const { data, error } = await supabaseAdmin
          .from("leads")
          .update(patch as never)
          .eq("business_id", businessId)
          .eq("id", input.leadId)
          .is("deleted_at", null)
          .select("id, name")
          .maybeSingle();
        if (error) return fail(error.message);
        if (!data) return fail("That customer is not in your leads.");

        await supabaseAdmin.from("audit_events").insert({
          business_id: businessId,
          user_id: userId,
          event_type: "owner_assistant_lead_updated",
          entity_type: "lead",
          entity_id: input.leadId,
          metadata: { fields: Object.keys(patch) } as never,
        } as never);
        ctx.record(`Updated ${data.name ?? "that customer"} (${Object.keys(patch).length} detail${Object.keys(patch).length === 1 ? "" : "s"}).`);
        return { ok: true };
      },
    }),

    book_job: tool({
      description: "Book this customer in at a date and time. Use find_customers first.",
      inputSchema: z.object({
        leadId: z.string().uuid(),
        date: DATE,
        time: TIME,
        serviceName: z.string().nullable().describe("The service booked, as the owner named it."),
        notes: z.string().nullable(),
      }),
      execute: async (input) => {
        const startsAt = await resolveStart(input.date, input.time);
        if (!startsAt) return fail("That date or time was not clear enough to book.");
        const { createBooking } = await import("@/lib/bookings-write.server");
        try {
          const result = await createBooking({
            businessId,
            userId,
            leadId: input.leadId,
            startsAt,
            serviceName: input.serviceName,
            notes: input.notes,
          });
          const when = formatInZone(startsAt, timeZone);
          ctx.record(
            `Booked for ${when}${input.serviceName ? `. ${input.serviceName}` : ""}.${result.clash ? " Another job is already booked at that time." : ""}`,
          );
          return { ok: true, jobId: result.jobId, when, clash: result.clash };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "That booking could not be saved.");
        }
      },
    }),

    reschedule_job: tool({
      description: "Move an existing booking to a new date and time.",
      inputSchema: z.object({
        jobId: z.string().uuid(),
        date: DATE,
        time: TIME,
      }),
      execute: async (input) => {
        const startsAt = await resolveStart(input.date, input.time);
        if (!startsAt) return fail("That date or time was not clear enough to move the booking.");
        const { rescheduleBooking } = await import("@/lib/bookings-write.server");
        try {
          const result = await rescheduleBooking({ businessId, userId, jobId: input.jobId, startsAt });
          const when = formatInZone(startsAt, timeZone);
          ctx.record(`Moved a booking to ${when}.${result.clash ? " Another job is already booked at that time." : ""}`);
          return { ok: true, when, clash: result.clash };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "That booking could not be moved.");
        }
      },
    }),

    cancel_job: tool({
      description:
        "Cancel a booking, including one already marked completed (a completed job cancelled this way has its recorded amount cleared from the totals). The customer is not messaged.",
      inputSchema: z.object({
        jobId: z.string().uuid(),
        reason: z.string().nullable(),
      }),
      execute: async (input) => {
        const { cancelBooking } = await import("@/lib/bookings-write.server");
        try {
          await cancelBooking({ businessId, userId, jobId: input.jobId, reason: input.reason });
          ctx.record("Cancelled that booking.");
          return { ok: true };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "That booking could not be cancelled.");
        }
      },
    }),

    delete_job: tool({
      description:
        "Permanently delete a job record from this business, whatever its state. use this when the owner says a booking or completed job was logged by mistake, was not requested, or should be removed from their totals. Get jobId from find_customers or list_upcoming_bookings. The customer and their messages are kept.",
      inputSchema: z.object({
        jobId: z.string().uuid(),
        reason: z.string().nullable(),
      }),
      execute: async (input) => {
        const { deleteBooking } = await import("@/lib/bookings-write.server");
        try {
          await deleteBooking({ businessId, userId, jobId: input.jobId, reason: input.reason });
          ctx.record("Deleted that job record, so it no longer counts towards your totals.");
          return { ok: true };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "That job could not be deleted.");
        }
      },
    }),


    complete_job: tool({
      description:
        "Mark a customer's work as done, optionally recording what they paid. Leave jobId null to complete their most recent job.",
      inputSchema: z.object({
        leadId: z.string().uuid(),
        jobId: z.string().uuid().nullable(),
        paidAmount: z.number().positive().max(1_000_000).nullable(),
        serviceName: z.string().nullable(),
      }),
      execute: async (input) => {
        const { completeJob } = await import("@/lib/bookings-write.server");
        try {
          const result = await completeJob({
            businessId,
            userId,
            leadId: input.leadId,
            jobId: input.jobId,
            paidAmount: input.paidAmount,
            serviceName: input.serviceName,
          });
          ctx.record(
            `Marked the job completed${
              result.paidAmount === null ? "" : ` and recorded $${result.paidAmount} paid`
            }.`,
          );
          return { ok: true, jobId: result.jobId };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "That job could not be completed.");
        }
      },
    }),

    upsert_service: tool({
      description:
        "Add a service, or rename, reprice, regroup or deactivate an existing one. Pass serviceId to change an existing service.",
      inputSchema: z.object({
        serviceId: z.string().uuid().nullable(),
        name: z.string().nullable(),
        price: z.string().nullable().describe("Price as the owner stated it, e.g. \"$250\" or \"from $180\"."),
        durationMinutes: z.number().int().min(5).max(1440).nullable(),
        category: z.string().nullable().describe("The heading this service sits under, e.g. Interior."),
        description: z.string().nullable(),
        active: z.boolean().nullable(),
      }),
      execute: async (input) => {
        const patch: Record<string, unknown> = {};
        if (input.name) patch["name"] = input.name;
        if (input.price) patch["price_guidance"] = input.price;
        if (input.durationMinutes) patch["duration_minutes"] = input.durationMinutes;
        if (input.category) patch["category"] = input.category;
        if (input.description) patch["description"] = input.description;
        if (input.active !== null) patch["active"] = input.active;

        if (input.serviceId) {
          if (Object.keys(patch).length === 0) return fail("Nothing was named to change.");
          const { data, error } = await supabaseAdmin
            .from("services")
            .update(patch as never)
            .eq("business_id", businessId)
            .eq("id", input.serviceId)
            .select("id, name")
            .maybeSingle();
          if (error) return fail(error.message);
          if (!data) return fail("That service does not belong to your business.");
          ctx.record(`Updated the service "${data.name}".`);
          return { ok: true, serviceId: data.id };
        }

        if (!input.name) return fail("A new service needs a name.");
        const { data, error } = await supabaseAdmin
          .from("services")
          .insert({ business_id: businessId, active: true, ...patch } as never)
          .select("id, name")
          .single();
        if (error || !data) return fail(error?.message ?? "That service could not be added.");
        ctx.record(`Added the service "${data.name}".`);
        return { ok: true, serviceId: data.id };
      },
    }),

    upsert_addon: tool({
      description:
        "Add an optional extra (add-on), or rename, reprice or switch off an existing one. Pass addonId to change an existing extra (get ids from list_services). An extra is only offered on the quote page once it is linked to services with set_addon_availability.",
      inputSchema: z.object({
        addonId: z.string().uuid().nullable(),
        name: z.string().nullable(),
        price: z.string().nullable().describe("Price as the owner stated it, e.g. \"$40\"."),
        durationMinutes: z.number().int().min(5).max(1440).nullable(),
        category: z.string().nullable(),
        description: z.string().nullable(),
        active: z.boolean().nullable(),
      }),
      execute: async (input) => {
        const patch: Record<string, unknown> = {};
        if (input.name) patch["name"] = input.name;
        if (input.price) patch["price_guidance"] = input.price;
        if (input.durationMinutes) patch["duration_minutes"] = input.durationMinutes;
        if (input.category) patch["category"] = input.category;
        if (input.description) patch["description"] = input.description;
        if (input.active !== null) patch["active"] = input.active;

        if (input.addonId) {
          if (Object.keys(patch).length === 0) return fail("Nothing was named to change.");
          const { data, error } = await supabaseAdmin
            .from("service_addons")
            .update(patch as never)
            .eq("business_id", businessId)
            .eq("id", input.addonId)
            .select("id, name")
            .maybeSingle();
          if (error) return fail(error.message);
          if (!data) return fail("That extra does not belong to your business.");
          ctx.record(`Updated the extra "${data.name}".`);
          return { ok: true, addonId: data.id };
        }

        if (!input.name) return fail("A new extra needs a name.");
        const { data, error } = await supabaseAdmin
          .from("service_addons")
          .insert({ business_id: businessId, active: true, ...patch } as never)
          .select("id, name")
          .single();
        if (error || !data) return fail(error?.message ?? "That extra could not be added.");
        ctx.record(`Added the extra "${data.name}".`);
        return { ok: true, addonId: data.id };
      },
    }),

    set_addon_availability: tool({
      description:
        "Make an add-on available with named services, or remove it from them. Use list_services first for the exact ids.",
      inputSchema: z.object({
        addonId: z.string().uuid(),
        serviceIds: z.array(z.string().uuid()).min(1).max(200),
        remove: z.boolean(),
      }),
      execute: async (input) => {
        const { applyAddonLinks } = await import("@/lib/catalog-actions.server");
        try {
          const result = await applyAddonLinks({
            businessId,
            userId,
            addonId: input.addonId,
            serviceIds: input.serviceIds,
            remove: input.remove,
          });
          ctx.record(
            input.remove
              ? `Removed that extra from ${result.changed} service${result.changed === 1 ? "" : "s"}.`
              : `That extra is now offered with ${result.changed} service${result.changed === 1 ? "" : "s"}.`,
          );
          return { ok: true, changed: result.changed };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "That change could not be applied.");
        }
      },
    }),

    send_text: tool({
      description:
        "Prepare one text message to a customer from this business's own number. The owner sees the exact message and must press Confirm before it sends; consent, opt-outs, quiet hours, credits and daily caps still apply at send time. Nothing sends when this tool runs.",
      inputSchema: z.object({
        leadId: z.string().uuid(),
        message: z.string().min(2).max(600),
      }),
      execute: async (input) => {
        const { data: lead } = await supabaseAdmin
          .from("leads")
          .select("id, name, mobile_number, opted_out_at, sms_suppressed_at")
          .eq("id", input.leadId)
          .eq("business_id", businessId)
          .is("deleted_at", null)
          .maybeSingle();
        if (!lead) return fail("That customer is not in this business's records.");
        if (lead.opted_out_at) return fail(`${lead.name ?? "That customer"} has opted out of texts.`);
        if (lead.sms_suppressed_at) return fail(`${lead.name ?? "That customer"}'s number is suppressed after delivery failures.`);
        if (!lead.mobile_number) return fail("There is no mobile number on record for that customer.");
        const leadName = lead.name ?? "Customer";
        ctx.propose({
          kind: "send_text",
          leadId: lead.id,
          leadName,
          mobileNumber: lead.mobile_number,
          message: input.message.trim(),
          summary: `Text to ${leadName} ready. It sends only when you confirm.`,
        });
        return { ok: true, awaitingConfirmation: true, to: leadName };
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
