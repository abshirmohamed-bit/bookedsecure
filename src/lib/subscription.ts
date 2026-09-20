/**
 * Subscription access model. client-safe types and pure helpers.
 *
 * Every business is in exactly one state:
 *  - preview   : signed up, not paying. View-only (CSV upload allowed).
 *  - active    : paying. Full access to everything its plan includes.
 *  - past_due  : a renewal failed. Full access for a short grace window,
 *                then preview until Stripe collects.
 *  - canceled  : ends at the period end; full access until then.
 *
 * The same logic runs on the server (gates) and in the shell (banners), so
 * the UI never promises something the server will refuse.
 */
import type { Plan } from "@/lib/plans";

export type SubscriptionStatus = "preview" | "active" | "past_due" | "canceled";
export type BillingInterval = "month" | "year";
export type AccessLevel = "full" | "preview";

/** Days a past-due business keeps full access while Stripe retries the card. */
export const PAST_DUE_GRACE_DAYS = 7;

export type SubscriptionState = {
  status: SubscriptionStatus;
  planId: string;
  interval: BillingInterval;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pastDueSince: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
};

/** Which plan capabilities can be gated. */
export type PlanFeature = "reactivation" | "campaigns" | "automation_custom" | "team";

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  reactivation: "Bringing past customers back",
  campaigns: "Bulk text campaigns",
  automation_custom: "Customising follow-up timing and wording",
  team: "More team members",
};

export const PREVIEW_MESSAGE =
  "Your workspace is in preview. Choose a plan to start booking, texting and using your assistant.";

export function accessLevel(state: Pick<SubscriptionState, "status" | "currentPeriodEnd" | "pastDueSince">, now: Date = new Date()): AccessLevel {
  switch (state.status) {
    case "active":
      return "full";
    case "canceled":
      return state.currentPeriodEnd && new Date(state.currentPeriodEnd) > now ? "full" : "preview";
    case "past_due": {
      const since = state.pastDueSince ? new Date(state.pastDueSince) : now;
      const graceEnd = since.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000;
      return now.getTime() < graceEnd ? "full" : "preview";
    }
    default:
      return "preview";
  }
}

export function planIncludes(plan: Plan, feature: PlanFeature): boolean {
  switch (feature) {
    case "reactivation":
      return plan.reactivationEnabled;
    case "campaigns":
      return plan.campaignsEnabled;
    case "automation_custom":
      return plan.automationCustomEnabled;
    case "team":
      return plan.teamMemberLimit === null;
  }
}

export function upgradeMessage(feature: PlanFeature): string {
  return `${PLAN_FEATURE_LABELS[feature]} is part of the Pro plan. Upgrade to turn it on.`;
}

/** Plain-language status line for the billing page and shell banner. */
export function describeSubscription(
  state: SubscriptionState,
  planName: string,
  now: Date = new Date(),
): { headline: string; detail: string; tone: "neutral" | "warning" | "danger" } {
  const end = state.currentPeriodEnd ? new Date(state.currentPeriodEnd) : null;
  const endLabel = end ? end.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : null;
  switch (state.status) {
    case "active":
      return {
        headline: `${planName} · ${state.interval === "year" ? "yearly" : "monthly"}`,
        detail: state.cancelAtPeriodEnd
          ? `Ends ${endLabel ?? "at the end of this period"}. You keep everything until then.`
          : `Renews ${endLabel ?? "at the end of this period"}.`,
        tone: state.cancelAtPeriodEnd ? "warning" : "neutral",
      };
    case "past_due":
      return {
        headline: `${planName} · payment failed`,
        detail:
          accessLevel(state, now) === "full"
            ? `Update your card within ${PAST_DUE_GRACE_DAYS} days to keep access.`
            : "Access is paused until your card is updated.",
        tone: "danger",
      };
    case "canceled":
      return {
        headline: `${planName} · cancelled`,
        detail:
          accessLevel(state, now) === "full"
            ? `You keep access until ${endLabel ?? "the end of the period"}.`
            : "Your subscription has ended. Choose a plan to pick up where you left off.",
        tone: "warning",
      };
    default:
      return { headline: "Preview", detail: PREVIEW_MESSAGE, tone: "warning" };
  }
}
