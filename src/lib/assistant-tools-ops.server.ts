/**
 * Operational tools for the owner assistant: the lead inbox, customer history,
 * bookings, the quote funnel, unfinished prospects, performance and delivery
 * figures, campaign results, settings, messaging, automation, team access and
 * contact-file imports.
 *
 * Every read and write is closed over the authenticated business. Owner-only
 * writes check the caller's role server-side. Texts are never sent from here:
 * the assistant proposes and the owner confirms on screen.
 */
import { tool } from "ai";
import { executeAssistantOperation } from "@/lib/assistant-operations";
import { operationInputs } from "@/lib/assistant-operation-contracts";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { LEAD_STATUSES, SOURCE_CHANNELS } from "@/lib/domain";
import { SMS_LEAD_FILTERS } from "@/lib/sms/delivery";
import { formatInZone } from "@/lib/assistant-time";
import { executeSharedAction, settingsInput } from "@/lib/assistant-shared-actions";
import { QUOTE_MODES } from "@/lib/quote-mode";
import { fail, type AssistantToolContext } from "@/lib/assistant-tools.server";

function ownerOnly(ctx: AssistantToolContext) {
  return ctx.role === "owner" || ctx.role === "platform_admin"
    ? null
    : fail("Only the business owner can change that.");
}

async function audit(ctx: AssistantToolContext, eventType: string, metadata: Record<string, unknown>) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: ctx.businessId,
    user_id: ctx.userId,
    event_type: eventType,
    entity_type: "business",
    entity_id: ctx.businessId,
    metadata: { ...metadata, via: "assistant" } as never,
  });
}

export function buildOperationsTools(ctx: AssistantToolContext) {
  const { businessId, userId, timeZone } = ctx;
  const when = (iso: string | null | undefined) => (iso ? formatInZone(iso, timeZone) : null);
  const localDate = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

  return {
    query_leads: tool({
      description:
        "List and count this business's leads from the lead inbox, filtered by status (new, contacted, waiting_for_customer, replied, quote_ready, quote_sent, scheduled, completed, lost, opted_out, invalid), by source (meta, godaddy, website, hosted_page, manual, import) and by text delivery state (sms_delivered, sms_pending, sms_failed, sms_undelivered, sms_suppressed, no_reply_after_delivery). Use it for 'who opted out', 'how many new leads', 'who replied', 'which leads never got a text' and similar. Returns the total count and up to `limit` rows with lead ids.",
      inputSchema: z.object({
        status: z.enum([...LEAD_STATUSES, "all"]).nullable(),
        source: z.enum([...SOURCE_CHANNELS, "all"]).nullable().describe("Source channel. Imported contacts keep their original channel; their origin field says 'import'."),
        sms: z.enum(SMS_LEAD_FILTERS).nullable(),
        limit: z.number().int().min(1).max(100).nullable(),
      }),
      execute: async (input) => {
        const { queryLeadInbox } = await import("@/lib/lead-query.server");
        const filters = {
          status: input.status ?? "all",
          source: input.source ?? "all",
          sms: (input.sms ?? "all") as never,
          scope: "active" as const,
        };
        const wanted = input.limit ?? 25;
        // The inbox pages at a fixed size; walk pages until we have enough rows.
        const first = await queryLeadInbox(supabaseAdmin, { businessId, filters, page: 1 });
        const leads = [...first.leads];
        let pageNo = 1;
        while (leads.length < wanted && pageNo < first.page.pageCount) {
          pageNo += 1;
          const next = await queryLeadInbox(supabaseAdmin, { businessId, filters, page: pageNo });
          leads.push(...next.leads);
        }
        const shown = leads.slice(0, wanted);
        return {
          total: first.page.totalCount,
          showing: shown.length,
          leads: shown.map((lead) => ({
            leadId: lead.id,
            name: lead.name,
            mobile: lead.mobile_number,
            email: lead.email,
            suburb: lead.suburb,
            status: lead.status,
            source: lead.source_channel,
            origin: lead.lead_origin,
            addedAt: when(lead.created_at),
            lastTextStatus: lead.last_outbound_sms_status,
            lastTextAt: when(lead.last_outbound_sms_at),
            lastReplyAt: when(lead.last_reply_at ?? lead.last_inbound_reply_at),
            suppressed: Boolean(lead.sms_suppressed_at),
            followUpsPaused: lead.conversation?.automation_paused ?? null,
            nextFollowUpAt: when(lead.conversation?.next_follow_up_at),
          })),
        };
      },
    }),

    bulk_update_lead_status: tool({
      description:
        "Change the status of MANY leads at once for this business. Use this whenever the owner asks for a whole group to be restatused (for example 'treat every imported lead as previous lead', 'mark all new leads as previous lead'). Never refuse a bulk status change and never tell the owner to do it by hand. Filter by the statuses the leads are in now, by source channel and by how they were added (origin). Leave a filter null to mean 'any'. It only changes the status field; it never texts anyone and never changes consent or opt-out flags.",
      inputSchema: operationInputs.bulk_update_lead_status,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'bulk_update_lead_status', input);
          ctx.record('Updated the requested bulk update lead status.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    customer_history: tool({
      description:
        "Everything on file for one customer: their details, every text sent and received (with delivery status), bookings and jobs, campaigns they were included in, and their follow-up sequence state. Use find_customers first to get the leadId.",
      inputSchema: z.object({ leadId: z.string().uuid() }),
      execute: async ({ leadId }) => {
        const [{ data: lead }, { data: messages }, { data: jobs }, { data: drafts }, { data: conversation }] =
          await Promise.all([
            supabaseAdmin
              .from("leads")
              .select(
                "id, name, mobile_number, email, suburb, service_address, vehicle_type, service_intent, main_concerns, status, booking_status, source_channel, lead_origin, notes, opted_out_at, sms_suppressed_at, created_at, first_contacted_at, first_reply_at, last_reply_at",
              )
              .eq("id", leadId)
              .eq("business_id", businessId)
              .is("deleted_at", null)
              .maybeSingle(),
            supabaseAdmin
              .from("messages")
              .select("direction, body, delivery_status, message_kind, message_source, created_at, failure_reason")
              .eq("business_id", businessId)
              .eq("lead_id", leadId)
              .order("created_at", { ascending: false })
              .limit(30),
            supabaseAdmin
              .from("jobs")
              .select("id, scheduled_at, completion_status, completed_at, completed_value, services(name)")
              .eq("business_id", businessId)
              .eq("lead_id", leadId)
              .order("scheduled_at", { ascending: false }),
            supabaseAdmin
              .from("reactivation_drafts")
              .select("status, sent_at, created_at, reactivation_campaigns(offer_text, status)")
              .eq("business_id", businessId)
              .eq("lead_id", leadId)
              .order("created_at", { ascending: false }),
            supabaseAdmin
              .from("conversations")
              .select("status, automation_paused, next_follow_up_at, last_message_at")
              .eq("business_id", businessId)
              .eq("lead_id", leadId)
              .maybeSingle(),
          ]);
        if (!lead) return fail("That customer is not in this business's records.");
        return {
          customer: {
            ...lead,
            addedAt: when(lead.created_at),
            optedOut: Boolean(lead.opted_out_at),
            suppressed: Boolean(lead.sms_suppressed_at),
          },
          texts: (messages ?? []).map((m) => ({
            direction: m.direction,
            at: when(m.created_at),
            body: m.body,
            status: m.delivery_status,
            kind: m.message_kind,
            source: m.message_source,
            failure: m.failure_reason,
          })),
          jobs: (jobs ?? []).map((j) => ({
            jobId: j.id,
            service: (j as { services?: { name?: string } | null }).services?.name ?? null,
            scheduledAt: when(j.scheduled_at),
            status: j.completion_status,
            completedAt: when(j.completed_at),
            paid: j.completed_value,
          })),
          campaigns: (drafts ?? []).map((d) => {
            const c = (d as { reactivation_campaigns?: { offer_text?: string; status?: string } | null })
              .reactivation_campaigns;
            return { offer: c?.offer_text ?? null, campaignStatus: c?.status ?? null, messageStatus: d.status, sentAt: when(d.sent_at) };
          }),
          followUps: conversation
            ? {
                status: conversation.status,
                paused: conversation.automation_paused,
                nextAt: when(conversation.next_follow_up_at),
                lastMessageAt: when(conversation.last_message_at),
              }
            : null,
        };
      },
    }),

    list_bookings: tool({
      description:
        "All bookings and jobs for this business between two local dates (inclusive), including completed and cancelled ones. Use list_upcoming_bookings for just what is coming up.",
      inputSchema: z.object({
        fromDate: z.string().describe("YYYY-MM-DD local date"),
        toDate: z.string().describe("YYYY-MM-DD local date"),
      }),
      execute: async (input) => {
        const { loadBookings } = await import("@/lib/bookings.server");
        const all = await loadBookings(businessId);
        const rows = all.filter((b) => {
          if (!b.scheduledAt) return false;
          const local = localDate(b.scheduledAt);
          return local >= input.fromDate && local <= input.toDate;
        });
        return {
          count: rows.length,
          bookings: rows.map((b) => ({
            jobId: b.jobId,
            leadId: b.leadId,
            customer: b.customerName,
            phone: b.phone,
            service: b.serviceName,
            at: when(b.scheduledAt),
            state: b.state,
            paid: b.completedValue,
            suburb: b.suburb,
          })),
        };
      },
    }),

    quote_funnel: tool({
      description:
        "Quote page funnel for the last N days: opens, who typed, chose a service, gave a mobile, saw times, booked, and where opens came from by source. Use for 'how is the quote page doing' and 'where do people stop'.",
      inputSchema: z.object({ days: z.number().int().min(1).max(365).nullable() }),
      execute: async ({ days }) => {
        const { loadQuoteFunnel } = await import("@/lib/quote-funnel.server");
        return loadQuoteFunnel(businessId, days ?? 30);
      },
    }),

    unfinished_prospects: tool({
      description:
        "People who started the quote page but did not finish, with how far they got (stage), the services they picked, and whether they left a mobile number. Returns each prospect's id for delete_unfinished_prospects.",
      inputSchema: z.object({ days: z.number().int().min(1).max(365).nullable() }),
      execute: async ({ days }) => {
        const { loadUnfinishedProspects } = await import("@/lib/quote-funnel.server");
        const rows = await loadUnfinishedProspects(businessId, days ?? 90);
        const withMobile = rows.filter((r) => r.mobile).length;
        const byStage: Record<string, number> = {};
        for (const r of rows) byStage[r.stageLabel] = (byStage[r.stageLabel] ?? 0) + 1;
        return {
          total: rows.length,
          gaveMobile: withMobile,
          stoppedBeforeMobile: rows.length - withMobile,
          byStage,
          prospects: rows.slice(0, 60).map((r) => ({
            id: r.conversationId,
            name: r.name,
            mobile: r.mobile || null,
            suburb: r.suburb,
            services: r.services,
            stage: r.stageLabel,
            lastActivity: when(r.lastActivityAt),
          })),
        };
      },
    }),

    delete_unfinished_prospects: tool({
      description:
        "Remove unfinished prospects from the list (test runs, junk, irrelevant entries). Pass the ids from unfinished_prospects. Only removes entries that match what the owner asked for; never touches real leads in the inbox. Acts immediately.",
      inputSchema: z.object({ conversationIds: z.array(z.string().uuid()).min(1).max(200) }),
      execute: async ({ conversationIds }) => {
        const { deleteUnfinishedConversations } = await import("@/lib/quote-funnel.server");
        const result = await deleteUnfinishedConversations({ businessId, userId, conversationIds });
        if (result.deleted > 0) {
          ctx.record(
            `Removed ${result.deleted} unfinished prospect${result.deleted === 1 ? "" : "s"}.`,
          );
        }
        return result;
      },
    }),

    performance_metrics: tool({
      description:
        "Lead and messaging performance for a period: total enquiries, contacted, replied, quote ready/sent, scheduled, completed, lost, response and reply rates, completed revenue, opt-outs, delivery failures and a breakdown by source. Also the SMS delivery summary (delivered, pending, failed, undelivered, suppressed).",
      inputSchema: z.object({
        days: z.number().int().min(1).max(365).nullable(),
        source: z.string().nullable().describe("Restrict to one source channel, or null for all."),
      }),
      execute: async (input) => {
        const { computeMetrics } = await import("@/lib/reporting.server");
        const { summariseDelivery } = await import("@/lib/sms/delivery");
        const from = input.days
          ? new Date(Date.now() - input.days * 86400000).toISOString()
          : null;
        const [metrics, messages, suppressed] = await Promise.all([
          computeMetrics(businessId, { from, to: null, source: input.source ?? null }),
          supabaseAdmin
            .from("messages")
            .select("delivery_status, failure_class, message_source")
            .eq("business_id", businessId)
            .eq("direction", "outbound")
            .then((r) => r.data ?? []),
          supabaseAdmin
            .from("leads")
            .select("id", { count: "exact", head: true })
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .not("sms_suppressed_at", "is", null)
            .then((r) => r.count ?? 0),
        ]);
        return { ...metrics, smsDelivery: { ...summariseDelivery(messages), suppressedLeads: suppressed } };
      },
    }),

    campaign_report: tool({
      description:
        "Every SMS campaign this business has run, with the offer, how many were drafted, sent, failed and replied. Use it to compare offers (e.g. 10% vs 20%) and say which worked.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).nullable() }),
      execute: async ({ limit }) => {
        const { data: campaigns } = await supabaseAdmin
          .from("reactivation_campaigns")
          .select("id, offer_text, status, created_at, approved_at")
          .eq("business_id", businessId)
          .order("created_at", { ascending: false })
          .limit(limit ?? 20);
        const ids = (campaigns ?? []).map((c) => c.id);
        const { data: drafts } = ids.length
          ? await supabaseAdmin
              .from("reactivation_drafts")
              .select("campaign_id, status")
              .eq("business_id", businessId)
              .in("campaign_id", ids)
          : { data: [] };
        return (campaigns ?? []).map((c) => {
          const rows = (drafts ?? []).filter((d) => d.campaign_id === c.id);
          const count = (s: string) => rows.filter((d) => d.status === s).length;
          const sent = count("sent") + count("replied");
          const replied = count("replied");
          return {
            campaignId: c.id,
            offer: c.offer_text,
            status: c.status,
            createdAt: when(c.created_at),
            approvedAt: when(c.approved_at),
            drafted: rows.length,
            sent,
            failed: count("failed"),
            replied,
            replyRate: sent > 0 ? Math.round((replied / sent) * 100) : null,
          };
        });
      },
    }),

    read_settings: tool({
      description:
        "This business's current settings: business details, quiet hours, timezone, quote page mode, whether automated sending is paused, the SMS number and credit balance, follow-up sequence rules, bookable availability and team members.",
      inputSchema: z.object({}),
      execute: async () => {
        const { getTextoAccount, listAssignedNumbers } = await import("@/lib/sms/texto-accounts.server");
        const { getPlanForBusiness } = await import("@/lib/plans.server");
        const { getCommercialConfig, getPilotForBusiness } = await import("@/lib/commercial.server");
        const [{ data: business }, { data: rules }, { data: availability }, { data: team }, account, numbers, senders, plan, config, pilot] =
          await Promise.all([
            supabaseAdmin
              .from("businesses")
              .select(
                "name, phone_number, service_area, opening_hours, sms_signature, privacy_policy_url, timezone, automation_enabled, quiet_hours_start, quiet_hours_end, quote_mode, slug, owner_notification_number, owner_notification_name",
              )
              .eq("id", businessId)
              .maybeSingle(),
            supabaseAdmin
              .from("automation_rules")
              .select("id, rule_type, step, delay_minutes, message_template, active")
              .eq("business_id", businessId)
              .order("step", { ascending: true }),
            supabaseAdmin
              .from("booking_availability")
              .select("active, lead_time_minutes, horizon_days, offer_ttl_minutes, weekly_windows")
              .eq("business_id", businessId)
              .maybeSingle(),
            supabaseAdmin
              .from("profiles")
              .select("id, name, email, active")
              .eq("business_id", businessId),
            getTextoAccount(businessId),
            listAssignedNumbers(businessId),
            supabaseAdmin
              .from("sms_senders")
              .select("phone_number, provider, is_primary, active")
              .eq("business_id", businessId)
              .eq("active", true),
            getPlanForBusiness(businessId),
            getCommercialConfig(),
            getPilotForBusiness(businessId),
          ]);
        // Same figures the Messaging page shows: included texts come from the
        // terms this business was accepted under, usage from the current period.
        const includedTexts = pilot?.includedSmsSegments ?? config.includedSmsSegments;
        let usedTexts = 0;
        if (pilot) {
          const { data: period } = await supabaseAdmin
            .from("sms_usage_periods")
            .select("segments_used")
            .eq("pilot_application_id", pilot.id)
            .order("period_start", { ascending: false })
            .limit(1)
            .maybeSingle();
          usedTexts = period?.segments_used ?? 0;
        }
        const sendingNumbers = [
          ...(senders.data ?? []).map((s) => ({ number: s.phone_number, primary: s.is_primary, status: "active" })),
          ...numbers
            .filter((n) => !(senders.data ?? []).some((s) => s.phone_number === n.number))
            .map((n) => ({ number: n.number, primary: false, status: n.status })),
        ];
        return {
          business,
          quotePageMode: business?.quote_mode ?? "manual_sms",
          sendingPaused: business ? !business.automation_enabled : null,
          messaging: {
            numbers: sendingNumbers,
            plan: {
              name: plan.name,
              monthlyPrice: `${plan.currency.toUpperCase()} ${(plan.monthlyPriceMinorUnits / 100).toFixed(2)}`,
              includedTextsPerMonth: includedTexts,
              textsUsedThisPeriod: usedTexts,
              extraTextCents: plan.overageCents,
            },
            purchasedCreditBalance: account?.credit_balance ?? null,
            dailySendCap: account?.daily_send_cap ?? null,
            note: "Contact BookedSecure for account access or credit help. These changes cannot be made through the assistant.",
          },
          followUpRules: rules ?? [],
          availability,
          team: (team ?? []).map((p) => ({ profileId: p.id, name: p.name, email: p.email, active: p.active, isYou: p.id === userId })),
        };
      },
    }),

    update_business_settings: tool({
      description: "Owner only. Update the named business details; null leaves a field unchanged.",
      inputSchema: settingsInput,
      execute: async (input) => {
        try {
          const result = await executeSharedAction(ctx.client, 'update_business_settings', input);
          ctx.record('Updated your business settings.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : 'Nothing was saved.'); }
      },
    }),

    set_quote_page_mode: tool({
      description:
        "Owner only. Switch the public quote page between 'manual_sms' (manual quote form with SMS) and 'ai_chat' (AI quote conversation).",
      inputSchema: operationInputs.set_quote_page_mode,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'set_quote_page_mode', input);
          ctx.record('Updated the requested set quote page mode.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    set_sending_paused: tool({
      description:
        "Owner only. Pause or resume all automated texting for this business (follow-up sequences and scheduled sends). Manual texts the owner confirms are unaffected.",
      inputSchema: operationInputs.set_sending_paused,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'set_sending_paused', input);
          ctx.record('Updated the requested set sending paused.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    update_follow_up_rule: tool({
      description:
        "Owner only. Edit one step of the automated follow-up sequence (get ids from read_settings): its delay in minutes, its message text, or whether it is switched on.",
      inputSchema: operationInputs.update_follow_up_rule,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'update_follow_up_rule', input);
          ctx.record('Updated the requested update follow up rule.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    set_customer_follow_ups: tool({
      description:
        "Pause or resume the automated follow-up sequence for one customer. Resuming schedules the next follow-up about an hour from now.",
      inputSchema: operationInputs.set_customer_follow_ups,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'set_customer_follow_ups', input);
          ctx.record('Updated the requested set customer follow ups.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    customise_customer_follow_up: tool({
      description:
        "Change the wording or timing of one follow-up step for ONE customer only, without changing the business-wide sequence (use update_follow_up_rule for everyone). step is the sequence step number from read_settings (e.g. 1 or 2). delayMinutes is measured from the previous message. Pass null to leave a field as is; pass reset=true to return the step to the business-wide default. Templates may use {{first_name}} and {{business_name}}. This only changes future follow-ups; it never sends a text.",
      inputSchema: operationInputs.customise_customer_follow_up,
      execute: async (input) => {
        try {
          const result = await executeAssistantOperation(ctx.client, 'customise_customer_follow_up', input);
          ctx.record('Updated the requested customise customer follow up.');
          return result;
        } catch (error) { return fail(error instanceof Error ? error.message : "Nothing was saved."); }
      },
    }),

    set_team_member_access: tool({
      description:
        "Owner only. Switch a team member's access on or off (get profileId from read_settings; match the person by name or email). Use this for 'remove access', 'disable', 'block' or 'restore access'. Owners cannot remove their own access. New members are added by signing up with an invite from the Team access page.",
      inputSchema: z.object({ profileId: z.string().uuid(), active: z.boolean() }),
      execute: async ({ profileId, active }) => {
        const denied = ownerOnly(ctx);
        if (denied) return denied;
        const { setTeamMemberAccess } = await import("@/lib/team.server");
        const result = await setTeamMemberAccess(
          { businessId, userId, role: ctx.role, via: "assistant" },
          profileId,
          active,
        );
        if (!result.ok) return fail(result.error);
        ctx.record(`${active ? "Restored" : "Removed"} access for ${result.name}.`);
        return { ok: true };
      },
    }),

    delete_team_member: tool({
      description:
        "Owner only. Permanently delete a team member from this business: their sign-in, profile and role are removed (get profileId from read_settings). Leads, bookings and messages are kept. Only use when the owner clearly says delete/remove them completely rather than just remove access. Owners cannot delete themselves.",
      inputSchema: z.object({ profileId: z.string().uuid() }),
      execute: async ({ profileId }) => {
        const denied = ownerOnly(ctx);
        if (denied) return denied;
        const { deleteTeamMember } = await import("@/lib/team.server");
        const result = await deleteTeamMember(
          { businessId, userId, role: ctx.role, via: "assistant" },
          profileId,
        );
        if (!result.ok) return fail(result.error);
        ctx.record(`Deleted ${result.name} from your team.`);
        return { ok: true };
      },
    }),


    preview_import: tool({
      description:
        "Owner only. Check the contact file the owner attached to this message (CSV/TSV): reads names, mobiles, emails and source, repairs Australian numbers, drops rows without a usable mobile and flags duplicates. Nothing is imported until the owner confirms on screen. Call this whenever a file is attached.",
      inputSchema: z.object({}),
      execute: async () => {
        const denied = ownerOnly(ctx);
        if (denied) return denied;
        if (!ctx.attachment) return fail("No file is attached to this message. Ask the owner to attach a CSV.");
        const { previewCrmCsv } = await import("@/lib/csv-import.server");
        try {
          const preview = await previewCrmCsv(supabaseAdmin, {
            businessId,
            userId,
            filename: ctx.attachment.filename,
            content: ctx.attachment.content,
          });
          const b = preview.batch;
          const summary = `${b.valid_rows} of ${b.total_rows} row${b.total_rows === 1 ? "" : "s"} can be imported${b.duplicate_rows ? `, ${b.duplicate_rows} already in your inbox (gaps will be filled)` : ""}${b.invalid_rows ? `, ${b.invalid_rows} skipped for no usable mobile` : ""}.`;
          if (b.valid_rows > 0 || b.duplicate_rows > 0) {
            ctx.propose({
              kind: "import",
              batchId: b.id,
              filename: b.filename ?? ctx.attachment.filename,
              totalRows: b.total_rows,
              validRows: b.valid_rows,
              invalidRows: b.invalid_rows,
              duplicateRows: b.duplicate_rows,
              summary,
            });
          }
          return {
            ok: true,
            awaitingConfirmation: b.valid_rows > 0 || b.duplicate_rows > 0,
            summary,
            columnsFound: preview.headers,
            unmappedColumns: preview.unmapped_columns,
            sample: preview.rows.slice(0, 5),
          };
        } catch (error) {
          return fail(error instanceof Error ? error.message : "That file could not be read.");
        }
      },
    }),
  };
}
