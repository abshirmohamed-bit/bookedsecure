/**
 * In-app Assistant (Co-Work) tools for the whole email campaign workflow, from
 * picking customers and writing the email to sending it, built on the shared
 * campaignActions so ChatGPT and Claude behave exactly the same way.
 * Sending and scheduling need the confirmation code from
 * preview_email_campaign_send, given only after the owner says yes.
 */
import { tool } from "ai";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { AssistantToolContext } from "@/lib/assistant-tools.server";
import { CAMPAIGN_AUDIENCES, type CampaignAudienceId } from "@/lib/email-campaigns";
import { campaignNeedsClarification, CAMPAIGN_CLARIFICATION } from "@/lib/assistant-request-guard";
import { zonedWallTimeToIso } from "@/lib/assistant-time";
import { campaignActions } from "@/lib/email-campaign-actions.server";

const AUDIENCE_IDS = CAMPAIGN_AUDIENCES.map((a) => a.id) as [CampaignAudienceId, ...CampaignAudienceId[]];
const STYLE = z.array(z.enum(["Keep it short", "Mention our offer", "Ask for a reply", "Casual tone", "Professional tone", "No discounts"])).max(6).default([]);
const FOLLOW_UP = z.object({
  subject: z.string().min(2).max(160),
  bodyText: z.string().min(2).max(5000),
  delayDays: z.number().int().min(1).max(30),
  stopOnBooking: z.boolean().default(true),
});
const CAMPAIGN_ID = z.string().uuid().describe("From list_email_campaigns or draft_email_campaign. Never show it to the owner.");

const fail = (message: string) => ({ ok: false as const, message });

export function buildCampaignTools(ctx: AssistantToolContext) {
  const actor = { businessId: ctx.businessId, userId: ctx.userId };
  const owner = ctx.role !== "staff";
  const ownerOnly = () => fail("Only the business owner can do this with email campaigns.");

  async function run<T>(label: string | null, work: () => Promise<T>) {
    try {
      const result = await work();
      if (label) ctx.record(label);
      return { ok: true as const, ...(result as object) };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "That didn't work. Nothing was changed.");
    }
  }

  async function audit(action: string, campaignId: string | null, metadata: Record<string, unknown> = {}) {
    await supabaseAdmin.from("audit_events").insert({
      business_id: ctx.businessId, user_id: ctx.userId, event_type: `assistant_email_${action}`,
      entity_type: "email_campaign", entity_id: campaignId, metadata: metadata as Json,
    }).then(() => undefined, () => undefined);
  }

  return {
    email_campaign_audience: tool({
      description: "Count and list customers in a quick email audience: all (everyone with an email), enquiries (open enquiries), quoted (quoted, not booked), booked, past (past customers), lost. Unsubscribed and opted-out customers are excluded.",
      inputSchema: z.object({ audience: z.enum(AUDIENCE_IDS) }),
      execute: async ({ audience }) => run(null, () => campaignActions.audience(actor, { audience })),
    }),

    write_campaign_email: tool({
      description: "Write the wording of a campaign email (kind first) or its follow-up (kind follow_up, pass the first email) from the owner's brief. Returns subject and body only; nothing is saved. Never invent prices or offers the owner didn't give.",
      inputSchema: z.object({ kind: z.enum(["first", "follow_up"]), instructions: z.string().max(2000), style: STYLE, firstEmail: z.object({ subject: z.string().max(160), bodyText: z.string().max(5000) }).optional() }),
      execute: async (input) => (owner ? run(null, () => campaignActions.write(actor, input)) : ownerOnly()),
    }),

    draft_email_campaign: tool({
      description: "Create an email campaign draft for an audience (all, enquiries, quoted, booked, past, lost) or named customers (leadIds from find_customers; never pick recipients from a partial search). Optional followUp goes to customers who haven't booked after delayDays. replyTo sets where customer replies go. Nothing is emailed until send_email_campaign.",
      inputSchema: z.object({
        name: z.string().min(2).max(120), subject: z.string().min(2).max(160), bodyText: z.string().min(2).max(5000),
        audience: z.enum(AUDIENCE_IDS).optional(), leadIds: z.array(z.string().uuid()).min(1).max(500).optional(),
        followUp: FOLLOW_UP.optional(), replyTo: z.string().email().optional(),
      }),
      execute: async (input) => {
        if (campaignNeedsClarification(ctx.request ?? "", ctx.requestHasContext)) return fail(CAMPAIGN_CLARIFICATION);
        if (!owner) return ownerOnly();
        const result = await run(`Drafted email campaign "${input.name}".`, () => campaignActions.create(actor, input));
        if (result.ok) await audit("draft", (result as { campaignId?: string }).campaignId ?? null);
        return result;
      },
    }),

    update_email_campaign: tool({
      description: "Change a draft or scheduled campaign: name, subject, body, replyTo, add or change the follow-up (followUp) or remove it (removeFollowUp), add or remove customers (addLeadIds/removeLeadIds), or replace all recipients with an audience (replaceWithAudience). Any change means a new preview is needed before sending.",
      inputSchema: z.object({
        campaignId: CAMPAIGN_ID,
        name: z.string().min(2).max(120).optional(), subject: z.string().min(2).max(160).optional(), bodyText: z.string().min(2).max(5000).optional(),
        replyTo: z.string().email().optional(), followUp: FOLLOW_UP.optional(), removeFollowUp: z.boolean().optional(),
        addLeadIds: z.array(z.string().uuid()).max(500).optional(), removeLeadIds: z.array(z.string().uuid()).max(500).optional(),
        replaceWithAudience: z.enum(AUDIENCE_IDS).optional(),
      }),
      execute: async (input) => {
        if (!owner) return ownerOnly();
        const result = await run("Updated an email campaign draft.", () => campaignActions.update(actor, input));
        if (result.ok) await audit("update", input.campaignId);
        return result;
      },
    }),

    list_email_campaigns: tool({
      description: "List email campaigns with status (draft, scheduled, sending, sent, cancelled), recipients, sent, failed, follow-ups and bookings within 30 days. Use for 'how did my emails do' and to find a campaign to change or send.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
      execute: async ({ limit }) => run(null, () => campaignActions.list(actor, { limit })),
    }),

    email_campaign_details: tool({
      description: "Read one email campaign in full: wording, follow-up, recipients with each person's send and follow-up status, and results.",
      inputSchema: z.object({ campaignId: CAMPAIGN_ID }),
      execute: async ({ campaignId }) => run(null, () => campaignActions.details(actor, { campaignId })),
    }),

    preview_email_campaign_send: tool({
      description: "Step 1 of sending or scheduling: returns exactly what will go out (subject, body, number of recipients, first names, follow-up) and a confirmationCode. Show the summary to the owner and ask them to confirm. Never send without their clear yes in this conversation.",
      inputSchema: z.object({ campaignId: CAMPAIGN_ID }),
      execute: async ({ campaignId }) => (owner ? run(null, () => campaignActions.previewSend(actor, { campaignId })) : ownerOnly()),
    }),

    send_email_campaign: tool({
      description: "Step 2: send the campaign now. Only after preview_email_campaign_send AND the owner explicitly said yes to that summary. Pass its confirmationCode. Report the sent and failed counts this returns.",
      inputSchema: z.object({ campaignId: CAMPAIGN_ID, confirmationCode: z.string().min(4).max(16) }),
      execute: async ({ campaignId, confirmationCode }) => {
        if (!owner) return ownerOnly();
        const result = await run(null, () => campaignActions.send(actor, { campaignId, confirmationCode }));
        if (result.ok) {
          const r = result as unknown as { sent: number; failed: number };
          ctx.record(`Sent an email campaign: ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ""}.`);
          await audit("send", campaignId, { sent: r.sent, failed: r.failed });
        }
        return result;
      },
    }),

    schedule_email_campaign: tool({
      description: "Step 2 (alternative): schedule the campaign for a local date and time instead of sending now. Only after preview_email_campaign_send and the owner's explicit yes; pass its confirmationCode. Between 5 minutes and 60 days ahead.",
      inputSchema: z.object({
        campaignId: CAMPAIGN_ID, confirmationCode: z.string().min(4).max(16),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Local date YYYY-MM-DD"),
        time: z.string().regex(/^\d{2}:\d{2}$/).describe("Local time HH:MM; ask if the owner didn't say"),
      }),
      execute: async ({ campaignId, confirmationCode, date, time }) => {
        if (!owner) return ownerOnly();
        const sendAt = zonedWallTimeToIso(date, time, ctx.timeZone);
        if (!sendAt) return fail("That date or time isn't valid.");
        const result = await run(`Scheduled an email campaign for ${date} ${time}.`, () => campaignActions.schedule(actor, { campaignId, confirmationCode, sendAt }));
        if (result.ok) await audit("schedule", campaignId, { sendAt });
        return result;
      },
    }),

    unschedule_email_campaign: tool({
      description: "Move a scheduled campaign back to a draft so it doesn't send.",
      inputSchema: z.object({ campaignId: CAMPAIGN_ID }),
      execute: async ({ campaignId }) => (owner ? run("Moved a scheduled email campaign back to drafts.", () => campaignActions.unschedule(actor, { campaignId })) : ownerOnly()),
    }),

    cancel_email_campaign: tool({
      description: "Cancel a draft or scheduled campaign so it is never sent. Only when the owner asks.",
      inputSchema: z.object({ campaignId: CAMPAIGN_ID }),
      execute: async ({ campaignId }) => {
        if (!owner) return ownerOnly();
        const result = await run("Cancelled an email campaign.", () => campaignActions.cancel(actor, { campaignId }));
        if (result.ok) await audit("cancel", campaignId);
        return result;
      },
    }),

    list_email_replies: tool({
      description: "List customer replies to campaign emails (the Replies inbox under Campaigns), newest first, with the latest message and unread count.",
      inputSchema: z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(50).default(20) }),
      execute: async (input) => run(null, () => campaignActions.replies(actor, input)),
    }),

    email_reply_thread: tool({
      description: "Read one email conversation with a customer (recipientId from list_email_replies): the campaign and every message, oldest first.",
      inputSchema: z.object({ recipientId: z.string().uuid() }),
      execute: async ({ recipientId }) => run(null, () => campaignActions.replyThread(actor, { recipientId })),
    }),

    preview_email_reply: tool({
      description: "Step 1 of answering a customer's email: returns exactly what will be emailed and a confirmationCode. Show the owner the wording and ask them to confirm before sending.",
      inputSchema: z.object({ recipientId: z.string().uuid(), bodyText: z.string().trim().min(1).max(10000) }),
      execute: async (input) => (owner ? run(null, () => campaignActions.previewReply(actor, input)) : ownerOnly()),
    }),

    send_email_reply: tool({
      description: "Step 2: email the answer to the customer, threaded with their reply. Only after preview_email_reply and the owner's clear yes to that exact wording; pass the same bodyText and its confirmationCode.",
      inputSchema: z.object({ recipientId: z.string().uuid(), bodyText: z.string().trim().min(1).max(10000), confirmationCode: z.string().min(4).max(16) }),
      execute: async (input) => {
        if (!owner) return ownerOnly();
        const result = await run("Answered a customer's email reply.", () => campaignActions.sendReply(actor, input));
        if (result.ok) await audit("reply", null, { recipientId: input.recipientId });
        return result;
      },
    }),

    stop_email_campaign_follow_ups: tool({
      description: "Stop every follow-up email of a sent campaign that hasn't gone out yet.",
      inputSchema: z.object({ campaignId: CAMPAIGN_ID }),
      execute: async ({ campaignId }) => (owner ? run("Stopped an email campaign's waiting follow-ups.", () => campaignActions.stopFollowUps(actor, { campaignId })) : ownerOnly()),
    }),
  };
}
