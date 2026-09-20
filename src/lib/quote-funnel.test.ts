import { describe, expect, it } from "vitest";
import {
  buildFunnel,
  furthestStage,
  isTestConversation,
  isUnfinishedProspect,
  opensBySource,
  readAttribution,
  unfinishedProspects,
  type ConversationRow,
} from "@/lib/quote-funnel";

function row(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "c1",
    status: "active",
    collected: {},
    leadId: null,
    consentOutcome: null,
    mobileCapturedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    lastActivityAt: "2026-09-01T00:00:00.000Z",
    customerMessages: 0,
    ...overrides,
  };
}

describe("furthestStage", () => {
  it("reports opened when nothing was answered", () => {
    expect(furthestStage({})).toBe("opened");
  });

  it("climbs with the answers actually given", () => {
    expect(furthestStage({ service_id: "s1" })).toBe("service");
    expect(furthestStage({ service_id: "s1", suburb: "Marrickville" })).toBe("details");
    expect(furthestStage({ service_id: "s1", suburb: "X", name: "Sam" })).toBe("contact");
    expect(furthestStage({ name: "Sam", mobile_number: "0412 987 654" })).toBe("mobile");
    expect(furthestStage({ mobile_number: "0412 987 654", reviewed: true })).toBe("review");
    expect(furthestStage({ reviewed: true, consent: "granted" })).toBe("consent");
    expect(furthestStage({ consent: "granted", booking_confirmed: true })).toBe("booked");
  });
});

describe("isTestConversation", () => {
  it("flags placeholder numbers only", () => {
    expect(isTestConversation({ collected: { mobile_number: "0400000000" } })).toBe(true);
    expect(isTestConversation({ collected: { mobile_number: "0412345678" } })).toBe(true);
    expect(isTestConversation({ collected: { mobile_number: "0412 987 654" } })).toBe(false);
    expect(isTestConversation({ collected: {} })).toBe(false);
  });
});

describe("buildFunnel", () => {
  it("counts bookings from confirmed jobs, never from conversation state", () => {
    const funnel = buildFunnel({
      rows: [
        row({ id: "a", status: "completed", collected: { consent: "granted", reviewed: true, mobile_number: "0412111222", name: "A", suburb: "X", service_id: "s" }, customerMessages: 6 }),
        row({ id: "b", status: "abandoned", collected: { service_id: "s" }, customerMessages: 1 }),
        row({ id: "c", status: "active", collected: {} }),
      ],
      opens: 40,
      confirmedBookings: 1,
    });

    expect(funnel.opens).toBe(40);
    expect(funnel.steps[0]).toMatchObject({ stage: "opened", count: 40 });
    expect(funnel.steps.at(-1)).toMatchObject({ stage: "booked", count: 1 });
    expect(funnel.finishedIntake).toBe(1);
    expect(funnel.interacted).toBe(2);
    expect(funnel.abandoned).toBe(1);
    expect(funnel.stillActive).toBe(1);
    expect(funnel.dropOffs[0]?.count).toBeGreaterThan(0);
  });

  it("excludes obvious test chats from every count", () => {
    const funnel = buildFunnel({
      rows: [row({ collected: { mobile_number: "0400000000" } })],
      opens: 0,
      confirmedBookings: 0,
    });
    expect(funnel.conversations).toBe(0);
    expect(funnel.testConversations).toBe(1);
  });
});

describe("unfinished prospects", () => {
  it("includes a mobile given without finishing", () => {
    expect(isUnfinishedProspect(row({ collected: { mobile_number: "0412987654" } }))).toBe(true);
  });

  it("excludes finished, declined, lead-linked and test rows", () => {
    expect(
      isUnfinishedProspect(row({ status: "completed", collected: { mobile_number: "0412987654" } })),
    ).toBe(false);
    expect(
      isUnfinishedProspect(
        row({ consentOutcome: "declined", collected: { mobile_number: "0412987654" } }),
      ),
    ).toBe(false);
    expect(
      isUnfinishedProspect(row({ leadId: "l1", collected: { mobile_number: "0412987654" } })),
    ).toBe(false);
    expect(isUnfinishedProspect(row({ collected: { mobile_number: "0400000000" } }))).toBe(false);
    expect(isUnfinishedProspect(row({ collected: {} }))).toBe(false);
  });

  it("lists most recently active first with the stage reached", () => {
    const list = unfinishedProspects([
      row({
        id: "old",
        lastActivityAt: "2026-09-01T00:00:00.000Z",
        collected: { mobile_number: "0413555210", name: "Old Sam" },
      }),
      row({
        id: "new",
        lastActivityAt: "2026-09-05T00:00:00.000Z",
        status: "abandoned",
        collected: {
          mobile_number: "0412222333",
          name: "New Sam",
          suburb: "Newtown",
          service_name: "Full detail",
          extra_service_names: ["Pet hair"],
        },
      }),
    ]);

    expect(list.map((entry) => entry.conversationId)).toEqual(["new", "old"]);
    expect(list[0]).toMatchObject({
      name: "New Sam",
      suburb: "Newtown",
      services: ["Full detail", "Pet hair"],
      stage: "mobile",
      abandoned: true,
    });
  });
});

describe("readAttribution", () => {
  it("reads campaign tags from the landing link", () => {
    const attribution = readAttribution({
      url: "https://bookedsecure.com/quote/acme?utm_source=facebook&utm_campaign=spring&fbclid=abc",
      referrer: "https://l.facebook.com/",
    });
    expect(attribution).toMatchObject({
      source: "facebook",
      campaign: "spring",
      landingUrl: "https://bookedsecure.com/quote/acme",
    });
    expect(attribution.utm["fbclid"]).toBe("abc");
  });

  it("falls back to direct with no tags or referrer", () => {
    expect(readAttribution({ url: "https://bookedsecure.com/quote/acme" }).source).toBe("direct");
  });

  it("groups opens by source and campaign", () => {
    expect(
      opensBySource([
        { source: "facebook", campaign: "spring" },
        { source: "facebook", campaign: "spring" },
        { source: "direct", campaign: null },
      ]),
    ).toEqual([
      { label: "facebook: spring", count: 2 },
      { label: "direct", count: 1 },
    ]);
  });
});
