/**
 * Owner action orchestration for the home-page assistant.
 *
 * The assistant may PROPOSE two things and nothing else: a win-back campaign
 * (draft rows only, no sends) and a bulk lead-status change. Both are applied
 * only when the owner confirms. Every read and write is scoped by `business_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { proposeOffer } from "@/lib/reactivation";
import type { LeadStatus } from "@/lib/domain";
import {
  describeStatusChange,
  isSafeStatusTarget,
  parseOwnerRequest,
  statusLabel,
  PROTECTED_SOURCE_STATUSES,
  type OwnerActionRequest,
} from "@/lib/owner-actions";

export type CampaignProposal = {
  kind: "campaign";
  campaignId: string;
  offerText: string;
  displayText?: string;
  summary: string;
  drafts: Array<{ id: string; leadName: string | null; mobileNumber: string; body: string }>;
};

export type StatusProposal = {
  kind: "status";
  from: LeadStatus | null;
  to: LeadStatus;
  count: number;
  maxLeads: number | null;
  summary: string;
};

import type { AddonLinkProposal } from "@/lib/catalog-actions.server";
import type { LeadUpdateProposal } from "@/lib/owner-lead-actions.server";
import type { SendTextProposal, ImportProposal, AssistantRequestProposal } from "@/lib/assistant-proposals";

export type OwnerProposal =
  | CampaignProposal
  | StatusProposal
  | AddonLinkProposal
  | LeadUpdateProposal
  | SendTextProposal
  | ImportProposal
  | AssistantRequestProposal;


/** How many leads a status change would touch right now. */
export async function countStatusTargets(input: {
  businessId: string;
  from: LeadStatus | null;
  maxLeads: number | null;
}): Promise<number> {
  const ids = await statusTargetIds(input);
  return ids.length;
}

async function statusTargetIds(input: {
  businessId: string;
  from: LeadStatus | null;
  maxLeads: number | null;
}): Promise<string[]> {
  let query = supabaseAdmin
    .from("leads")
    .select("id")
    .eq("business_id", input.businessId)
    .is("deleted_at", null)
    .is("opted_out_at", null)
    .is("sms_suppressed_at", null)
    .order("created_at", { ascending: true });
  if (input.from) query = query.eq("status", input.from);
  // No starting status named: never touch completed, scheduled or opted-out leads.
  else query = query.not("status", "in", `(${PROTECTED_SOURCE_STATUSES.join(",")})`);
  query = query.limit(input.maxLeads && input.maxLeads > 0 ? input.maxLeads : 2000);
  const { data } = await query;
  return (data ?? []).map((row) => row.id as string);
}

/** Applies a confirmed bulk status change. Sends nothing. */
export async function applyStatusChange(input: {
  businessId: string;
  userId: string;
  from: LeadStatus | null;
  to: LeadStatus;
  maxLeads: number | null;
}): Promise<{ updated: number }> {
  if (!isSafeStatusTarget(input.to)) throw new Error("That status cannot be set from here.");
  const ids = await statusTargetIds(input);
  if (ids.length === 0) return { updated: 0 };

  const { error } = await supabaseAdmin
    .from("leads")
    .update({ status: input.to })
    .eq("business_id", input.businessId)
    .in("id", ids);
  if (error) throw new Error(error.message);

  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId,
    event_type: "lead_status_bulk_changed",
    entity_type: "lead",
    metadata: { from: input.from, to: input.to, count: ids.length } as never,
  });

  return { updated: ids.length };
}

/** Prepares a draft campaign for the owner to review. Sends nothing. */
export async function proposeCampaign(input: {
  businessId: string;
  userId: string;
  percent: number | null;
  offerText?: string | null;
  campaignCopy?: string | null;
  maxLeads: number | null;
  olderThanDays: number | null;
  audience?: import("@/lib/reactivation.server").CampaignAudience;
  fresh?: boolean;
}): Promise<CampaignProposal | null> {
  const { draftReactivationCampaign } = await import("@/lib/reactivation.server");
  const offer =
    input.offerText && input.offerText.trim().length > 0
      ? input.offerText
      : input.percent
        ? proposeOffer({ percent: input.percent })
        : null;
  const view = await draftReactivationCampaign({
    businessId: input.businessId,
    userId: input.userId,
    offerText: offer,
    campaignCopy: input.campaignCopy ?? null,
    ...(input.maxLeads ? { maxLeads: input.maxLeads } : {}),
    ...(input.olderThanDays ? { olderThanDays: input.olderThanDays } : {}),
    ...(input.audience ? { audience: input.audience } : {}),
    ...(input.fresh ? { fresh: true } : {}),
  });
  if (!view.campaign) return null;

  const pending = view.drafts.filter((draft) => draft.status === "draft");
  const requestedCopy = input.campaignCopy?.trim().slice(0, 180) ?? "";
  const windowNote = input.olderThanDays
    ? ` who have not been contacted in the last ${input.olderThanDays} day${input.olderThanDays === 1 ? "" : "s"}`
    : "";
  return {
    kind: "campaign",
    campaignId: view.campaign.id,
    offerText: view.campaign.offerText,
    ...(requestedCopy ? { displayText: requestedCopy } : {}),
    summary:
      pending.length === 0
        ? "No contacts qualify for that message right now."
        : requestedCopy
          ? `${pending.length} contact${pending.length === 1 ? "" : "s"}${windowNote} ready with your requested campaign wording. Nothing sends until you approve.`
          : `${pending.length} contact${pending.length === 1 ? "" : "s"}${windowNote} ready to receive "${view.campaign.offerText}". Nothing sends until you approve.`,
    drafts: pending.map((draft) => ({
      id: draft.id,
      leadName: draft.leadName,
      mobileNumber: draft.mobileNumber,
      body: draft.body,
    })),
  };
}

/**
 * Turns one owner request into an answer. The tool-using assistant carries the
 * work out directly and reports what it did; the older phrase-matching path is
 * kept only as a fallback for when the assistant itself is unavailable, so the
 * owner still gets a Confirm card instead of an error.
 */
export async function handleOwnerRequest(input: {
  client: SupabaseClient<Database>;
  businessId: string;
  userId: string;
  role: "owner" | "staff" | "platform_admin";
  question: string;
  history?: Array<{ role: "user" | "assistant"; text: string }>;
  /** A contact file the owner attached to this message, if any. */
  attachment?: { filename: string; content: string } | null;
  /** True when the file above came from an earlier upload, not this message. */
  attachmentRemembered?: boolean;
}): Promise<{ answer: string; proposals: OwnerProposal[]; executed: string[] }> {
  try {
    const { runAssistantAgent } = await import("@/lib/assistant-agent.server");
    const result = await runAssistantAgent({
    client: input.client,
      businessId: input.businessId,
      userId: input.userId,
      role: input.role,
      question: input.question,
      ...(input.history ? { history: input.history } : {}),
      ...(input.attachment ? { attachment: input.attachment } : {}),
      ...(input.attachmentRemembered ? { attachmentRemembered: true } : {}),
    });
    if (result.answer.length > 0 || result.executed.length > 0 || result.proposals.length > 0) {
      return {
        answer: result.answer.length > 0 ? result.answer : result.executed.join(" "),
        proposals: result.proposals as OwnerProposal[],
        executed: result.executed,
      };
    }
  } catch (error) {
    console.error("owner assistant agent failed", error);
  }

  return handleOwnerRequestFallback(input);
}

/**
 * Deterministic fallback. Same behaviour the assistant had before tools existed:
 * a proposal the owner confirms on screen.
 */
export async function handleOwnerRequestFallback(input: {
  businessId: string;
  userId: string;
  question: string;
}): Promise<{ answer: string; proposals: OwnerProposal[]; executed: string[] }> {
  // Catalogue questions and add-on linking are handled deterministically first.
  const { parseCatalogRequest } = await import("@/lib/catalog-actions");
  const catalogRequest = parseCatalogRequest(input.question);
  if (catalogRequest) {
    const { answerCatalogList, proposeAddonLinks } = await import("@/lib/catalog-actions.server");
    if (catalogRequest.kind === "list_catalog") {
      return { answer: await answerCatalogList(input.businessId), proposals: [], executed: [] };
    }
    const result = await proposeAddonLinks({
      businessId: input.businessId,
      request: catalogRequest,
    });
    return {
      answer: result.message,
      proposals: result.proposal ? [result.proposal] : [],
      executed: [],
    };
  }

  // A single-customer instruction ("Andrew's detail is done, he paid $450, book
  // him again on 12 March") is proposed before anything is written.
  const { parseLeadUpdateRequest } = await import("@/lib/owner-lead-actions");
  const leadRequest = parseLeadUpdateRequest(input.question);
  if (leadRequest) {
    const { proposeLeadUpdate } = await import("@/lib/owner-lead-actions.server");
    const result = await proposeLeadUpdate({ businessId: input.businessId, request: leadRequest });
    return {
      answer: result.message,
      proposals: result.proposal ? [result.proposal] : [],
      executed: [],
    };
  }

  const requests: OwnerActionRequest[] = parseOwnerRequest(input.question);
  if (requests.length === 0) {
    const { answerOwnerQuestion } = await import("@/lib/owner-assistant.server");
    const result = await answerOwnerQuestion({
      businessId: input.businessId,
      question: input.question,
    });
    return { answer: result.answer, proposals: [], executed: [] };
  }

  const proposals: OwnerProposal[] = [];
  const lines: string[] = [];

  for (const request of requests) {
    if (request.kind === "draft_campaign") {
      const proposal = await proposeCampaign({
        businessId: input.businessId,
        userId: input.userId,
        percent: request.percent,
        campaignCopy: null,
        maxLeads: request.maxLeads,
        olderThanDays: request.olderThanDays,
      });
      if (proposal) {
        proposals.push(proposal);
        lines.push(proposal.summary);
      } else {
        lines.push("I could not prepare a win-back campaign just now.");
      }
    } else {
      const count = await countStatusTargets({
        businessId: input.businessId,
        from: request.from,
        maxLeads: request.maxLeads,
      });
      if (count === 0) {
        lines.push(
          request.from
            ? `No leads are currently marked ${statusLabel(request.from)}.`
            : "No leads match that change.",
        );
      } else {
        proposals.push({
          kind: "status",
          from: request.from,
          to: request.to,
          count,
          maxLeads: request.maxLeads,
          summary: describeStatusChange({ from: request.from, to: request.to, count }),
        });
        lines.push(describeStatusChange({ from: request.from, to: request.to, count }));
      }
    }
  }

  return { answer: lines.join(" "), proposals, executed: [] };
}
