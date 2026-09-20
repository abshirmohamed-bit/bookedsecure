// TRADE JOURNEYS — one pretend customer per trade, walked end to end.
//
// For each trade the platform serves, this walks the whole journey the way a
// real sole trader would take it:
//
//   1. Sign up      — brand new business, nothing saved yet.
//   2. Pick trade   — starting services and re-service cycle come from the trade.
//   3. Website read — the site is scraped and proposed for approval; anything
//                     already saved is never overwritten.
//   4. Compliance   — the details we must hold before a number can be issued.
//   5. Subscription — importing and campaigns stay shut until it is paid.
//   6. Import       — a messy contact row from their old list.
//   7. Campaign     — offer proposed, wording guarded, owner approval required.
//   8. Their customer — a quote-page enquiry through to a confirmed booking.
//
// Everything here is derived from the trade and the tenant's own data: no
// business name, price or identifier is hardcoded for a single tenant.

import { describe, expect, it } from "vitest";
import {
  PRIMARY_TRADE_IDS,
  TRADE_IDS,
  TRADE_PRESETS,
  reserviceCycleLabel,
  reserviceWindowDays,
  resolveTrade,
  type TradeId,
} from "@/lib/trades";
import { buildOnboardingSteps, onboardingComplete, type OnboardingFacts } from "@/lib/onboarding";
import { buildOnboardingProposal, markExistingServices, type ScrapedSite } from "@/lib/site-onboarding";
import { emptyIdentity, missingIdentityFields, normaliseAbn } from "@/lib/tenant-identity";
import { accessLevel, type SubscriptionState } from "@/lib/subscription";
import { parseCsv, prepareRow } from "@/lib/csv-import";
import {
  checkApproval,
  guardReactivationMessage,
  proposeOffer,
  renderReactivationMessage,
} from "@/lib/reactivation";
import {
  applyAnswer,
  nextStep,
  promptFor,
  reviewSummary,
  resolveOutcome,
  serviceAcknowledgement,
  type WebChatCollected,
  type WebChatService,
  type WebChatTenant,
} from "@/lib/web-chat";

/** A fictional business for a trade, built only from that trade's preset. */
function pretendBusiness(trade: TradeId) {
  const preset = TRADE_PRESETS[trade];
  const slug = trade.replace(/_/g, "-");
  return {
    trade,
    preset,
    name: `${preset.label} Test Co`,
    site: `https://${slug}.example.test/`,
    abn: "20 284 379 143",
  };
}

/** What their website would look like to the scraper. */
function pretendSite(trade: TradeId): ScrapedSite {
  const preset = TRADE_PRESETS[trade];
  return {
    businessName: `${preset.label} Test Co`,
    suburb: "Punchbowl",
    serviceArea: "South West Sydney",
    phone: "(02) 8800 1234",
    openingHours: "Mon-Fri 8am-5pm, Sat 9am-1pm",
    services: preset.serviceSeeds.map((seed, index) => ({
      name: seed.name,
      price: `from $${120 + index * 40}`,
      description: `${seed.name} for your ${preset.subjectNoun}.`,
      durationMinutes: seed.durationMinutes,
    })),
    addons: [{ name: "Extra — second visit discount", price: "+$40" }],
  };
}

function chatTenant(trade: TradeId, services: WebChatService[]): WebChatTenant {
  return {
    name: pretendBusiness(trade).name,
    flexibleRequestsEnabled: true,
    quoteSubjectLabel: TRADE_PRESETS[trade].subjectNoun,
    bookingEnabled: true,
    services,
  };
}

const fresh: OnboardingFacts = {
  tradeChosen: false,
  serviceCount: 0,
  complianceComplete: false,
  subscriptionActive: false,
  importedContacts: 0,
  campaignsCreated: 0,
};

const preview: SubscriptionState = {
  status: "preview",
  currentPeriodEnd: null,
  pastDueSince: null,
} as SubscriptionState;

const paid: SubscriptionState = {
  status: "active",
  currentPeriodEnd: null,
  pastDueSince: null,
} as SubscriptionState;

describe.each(TRADE_IDS)("journey — %s", (trade) => {
  const business = pretendBusiness(trade);

  it("1. signs up with nothing saved and is sent to pick their trade first", () => {
    const steps = buildOnboardingSteps(fresh);
    expect(steps.find((step) => step.current)?.id).toBe("trade");
    expect(onboardingComplete(fresh)).toBe(false);
  });

  it("2. picking the trade gives real starting services and a sensible cycle", () => {
    const preset = resolveTrade(trade);
    expect(preset).not.toBeNull();
    expect(preset!.serviceSeeds.length).toBeGreaterThanOrEqual(2);
    expect(preset!.subjectNoun.trim().length).toBeGreaterThan(2);
    const window = reserviceWindowDays(trade, new Date("2026-09-20T00:00:00Z"));
    expect(window!.min).toBeGreaterThan(0);
    expect(window!.max).toBeGreaterThanOrEqual(window!.min);
    expect(reserviceCycleLabel(trade)).toMatch(/every \d/);
  });

  it("3. reads their website into services, prices and hours for approval", () => {
    const proposal = buildOnboardingProposal(pretendSite(trade), business.site);
    expect(proposal.business.name).toBe(business.name);
    expect(proposal.business.phone_number).toBe("+61288001234");
    expect(proposal.services.length).toBeGreaterThanOrEqual(2);
    expect(proposal.services.every((service) => service.price_guidance !== null)).toBe(true);
    expect(proposal.weeklyWindows.length).toBeGreaterThan(0);
    expect(proposal.addons.length).toBeGreaterThan(0);
  });

  it("3b. never overwrites a service the owner already saved", () => {
    const proposal = buildOnboardingProposal(pretendSite(trade), business.site);
    const firstName = proposal.services[0]!.name;
    const marked = markExistingServices(proposal, [firstName.toUpperCase()]);
    expect(marked.services[0]!.alreadyHave).toBe(true);
    expect(marked.services.slice(1).every((service) => !service.alreadyHave)).toBe(true);
  });

  it("4. cannot get a number until the compliance record is complete", () => {
    const partial = { ...emptyIdentity(), legalName: business.name };
    expect(missingIdentityFields(partial).length).toBeGreaterThan(0);

    const complete = {
      ...emptyIdentity(),
      legalName: business.name,
      abn: business.abn,
      addressLine1: "12 Example St",
      suburb: "Punchbowl",
      state: "NSW",
      postcode: "2196",
      website: business.site,
      contactName: "Test Owner",
      contactEmail: "owner@example.test",
      contactPhone: "0412 345 678",
      messageTypes: ["Follow-ups to past customers"],
      declarationAcceptedAt: new Date().toISOString(),
    };
    expect(normaliseAbn(complete.abn)).toHaveLength(11);
    expect(missingIdentityFields(complete)).toEqual([]);
  });

  it("5. importing and campaigns stay shut until the subscription is paid", () => {
    const setUp: OnboardingFacts = {
      ...fresh,
      tradeChosen: true,
      serviceCount: TRADE_PRESETS[trade].serviceSeeds.length,
      complianceComplete: true,
    };
    expect(accessLevel(preview)).toBe("preview");
    const blocked = buildOnboardingSteps(setUp);
    expect(blocked.find((step) => step.id === "subscribe")!.current).toBe(true);
    expect(blocked.find((step) => step.id === "import")!.blockedBy).toBe("subscribe");
    expect(blocked.find((step) => step.id === "campaign")!.blockedBy).toBe("subscribe");

    expect(accessLevel(paid)).toBe("full");
    const open = buildOnboardingSteps({ ...setUp, subscriptionActive: true });
    expect(open.find((step) => step.id === "import")!.blockedBy).toBeNull();
    expect(open.find((step) => step.id === "import")!.current).toBe(true);
  });

  it("6. imports a messy row from their old customer list", () => {
    const table = parseCsv(
      "Full Name,Mobile,Email address,Stage\n" + ` Jo  Sample ,0412 345 678, JO@Example.test ,completed\n`,
    );
    const row = prepareRow(table.headers, table.rows[0]!, 1, { filename: "old-list.csv" });
    expect(row.validation_errors).toEqual([]);
    expect(row.normalized_payload.proposed_status).toBe("completed");
    expect(row.normalized_payload.mobile_number).toBe("+61412345678");
    expect(row.normalized_payload.name).toBe("Jo Sample");
  });

  it("7. proposes a win-back offer that is guarded and needs owner approval", () => {
    const offer = proposeOffer();
    const message = renderReactivationMessage({
      businessName: business.name,
      leadName: "Jo",
      offerText: offer,
      quoteUrl: `https://example.test/quote/${trade}`,
    });
    expect(message).toContain(business.name);
    expect(message).toContain(offer);
    expect(message.length).toBeLessThanOrEqual(320);
    const guarded = guardReactivationMessage(message, offer);
    expect(guarded.flagged).toEqual([]);

    // Nothing sends without the owner attesting, on a draft, with a selection.
    expect(checkApproval({ attested: false, campaignStatus: "draft", approvedDraftCount: 5 }).ok).toBe(false);
    expect(checkApproval({ attested: true, campaignStatus: "draft", approvedDraftCount: 0 }).ok).toBe(false);
    expect(checkApproval({ attested: true, campaignStatus: "sent", approvedDraftCount: 5 }).ok).toBe(false);
    expect(checkApproval({ attested: true, campaignStatus: "draft", approvedDraftCount: 1 }).ok).toBe(true);
  });

  it("8. their own customer books through the quote page", () => {
    const services: WebChatService[] = TRADE_PRESETS[trade].serviceSeeds.map((seed, index) => ({
      id: `s${index}`,
      name: seed.name,
      description: null,
      included_items: null,
      excluded_items: null,
      qualification_note: null,
      price_guidance: `from $${120 + index * 40}`,
      campaign_eligible: true,
    }));
    const tenant = chatTenant(trade, services);

    const prompt = promptFor("service", tenant, {});
    expect(prompt.kind).toBe("choice");
    expect((prompt.options ?? []).length).toBeGreaterThanOrEqual(services.length);
    expect((prompt.options ?? []).map((option) => option.value)).toContain("s0");

    let collected: WebChatCollected = {};
    const answers: Record<string, string> = {
      service: "s0",
      vehicle: `Their ${TRADE_PRESETS[trade].subjectNoun}`,
      suburb: "Punchbowl",
      address: "12 Example St, Punchbowl NSW 2196",
      concerns: "skip",
      name: "Jo Sample",
      mobile: "0412 345 678",
      email: "jo@example.test",
    };
    for (let guard = 0; guard < 20; guard += 1) {
      const step = nextStep(collected);
      if (step === null || step === "review") break;
      const answer = answers[step];
      if (answer === undefined) break;
      const result = applyAnswer(collected, step, answer, tenant);
      expect(result.ok, `${step} rejected`).toBe(true);
      if (!result.ok) return;
      collected = result.collected;
    }

    expect(nextStep(collected)).toBe("review");
    expect(serviceAcknowledgement(tenant, collected)).toContain("from $120");
    expect(reviewSummary(collected).find((row) => row.label === "Service")?.value).toBe(services[0]!.name);
    expect(resolveOutcome(collected).requiresOwnerReview).toBe(false);

    // Nothing is booked until the server offers a slot and the customer confirms.
    const consented: WebChatCollected = { ...collected, reviewed: true, consent: "granted" };
    expect(nextStep(consented)).toBeNull();
    expect(nextStep({ ...consented, booking_offered: true })).toBe("booking");
    expect(nextStep({ ...consented, booking_offered: true, booking_selected: "2026-09-25T23:00:00.000Z" })).toBe(
      "booking_confirm",
    );
  });
});

describe("the five headline trades are all offered", () => {
  it("each has a distinct label and is a real preset", () => {
    expect(PRIMARY_TRADE_IDS).toHaveLength(5);
    const labels = new Set(PRIMARY_TRADE_IDS.map((trade) => TRADE_PRESETS[trade].label));
    expect(labels.size).toBe(5);
  });
});
