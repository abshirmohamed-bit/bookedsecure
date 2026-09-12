import { describe, expect, it } from "vitest";
import {
  classifyOwnerQuestion,
  guardAssistantAnswer,
  isBannedAnswerSentence,
  buildOwnerAssistantSystem,
  buildAssistantSystemPrompt,
  normaliseOwnerQuestion,
  renderSnapshotAnswer,
  type OwnerSnapshot,
} from "@/lib/owner-assistant";

const snapshot: OwnerSnapshot = {
  businessName: "Acme Detailing",
  generatedAt: "2026-01-01T00:00:00.000Z",
  timezone: null,
  leads: { total: 12, new: 3, last7Days: 5, awaitingReply: 2 },
  bookings: {
    upcoming: 1,
    nextScheduledAt: "2026-01-02T00:00:00.000Z",
    completedLast30Days: 4,
    revenueLast30Days: 900,
  },
  campaigns: { total: 2, openStatus: "sent", openOffer: "15% off", drafted: 0, sent: 8, replied: 1 },
};

const empty: OwnerSnapshot = {
  businessName: null,
  generatedAt: "2026-01-01T00:00:00.000Z",
  timezone: null,
  leads: { total: 0, new: 0, last7Days: 0, awaitingReply: 0 },
  bookings: { upcoming: 0, nextScheduledAt: null, completedLast30Days: 0, revenueLast30Days: 0 },
  campaigns: { total: 0, openStatus: null, openOffer: null, drafted: 0, sent: 0, replied: 0 },
};

describe("classifyOwnerQuestion", () => {
  it("routes booking questions", () => {
    expect(classifyOwnerQuestion("How many bookings this week?")).toBe("bookings");
    expect(classifyOwnerQuestion("what revenue did I make")).toBe("bookings");
  });

  it("routes campaign questions", () => {
    expect(classifyOwnerQuestion("How did the win-back campaign go?")).toBe("campaigns");
  });

  it("routes reply questions", () => {
    expect(classifyOwnerQuestion("Anything waiting on a reply?")).toBe("replies");
  });

  it("routes lead questions", () => {
    expect(classifyOwnerQuestion("how many new leads")).toBe("leads");
  });

  it("falls back to an overview", () => {
    expect(classifyOwnerQuestion("hello")).toBe("overview");
    expect(classifyOwnerQuestion("")).toBe("overview");
  });
});

describe("renderSnapshotAnswer", () => {
  it("quotes only snapshot numbers", () => {
    const answer = renderSnapshotAnswer(snapshot, "leads");
    expect(answer).toContain("12 active leads");
    expect(answer).toContain("3 still marked new");
  });

  it("uses the tenant's own name and never a hardcoded business", () => {
    expect(renderSnapshotAnswer(snapshot, "bookings")).toContain("Acme Detailing");
    expect(renderSnapshotAnswer(empty, "bookings")).toContain("your business");
  });

  it("states an empty state instead of inventing activity", () => {
    expect(renderSnapshotAnswer(empty, "campaigns")).toContain("No reactivation campaigns");
    expect(renderSnapshotAnswer(empty, "replies")).toContain("Nothing is waiting");
  });

  it("gives a single-sentence overview", () => {
    expect(renderSnapshotAnswer(snapshot, "overview")).toContain("1 upcoming booking");
  });
});

describe("guardAssistantAnswer", () => {
  it("strips claims that the assistant acted", () => {
    const guarded = guardAssistantAnswer("You have 2 leads waiting. I've texted them for you.");
    expect(guarded).toBe("You have 2 leads waiting.");
  });

  it("strips promises and guarantees", () => {
    expect(guardAssistantAnswer("This will guarantee more bookings.")).toBe("");
    expect(guardAssistantAnswer("I will send the follow-ups tonight.")).toBe("");
  });

  it("keeps factual phrasing intact", () => {
    const text = "You have 3 new leads and 1 upcoming booking.";
    expect(guardAssistantAnswer(text)).toBe(text);
  });

  it("recognises banned sentences directly", () => {
    expect(isBannedAnswerSentence("I have approved the campaign.")).toBe(true);
    expect(isBannedAnswerSentence("Two leads replied yesterday.")).toBe(false);
  });
});

describe("buildOwnerAssistantSystem", () => {
  it("carries the snapshot and never claims an action", () => {
    const system = buildOwnerAssistantSystem(snapshot);
    expect(system).toContain("Acme Detailing");
    expect(system).toContain("Never claim you did it");
    expect(system).toContain('"total":12');
  });
});

describe("buildAssistantSystemPrompt", () => {
  it("tells the assistant it acts, and gives it the tenant's own local time", () => {
    const system = buildAssistantSystemPrompt({
      businessName: "Acme Detailing",
      timeZone: "Australia/Sydney",
      localDate: "2026-09-15",
      localTime: "08:30",
      localWeekday: "Tuesday",
    });
    expect(system).toContain("Acme Detailing");
    expect(system).toContain("Tuesday 2026-09-15");
    expect(system).toContain("Australia/Sydney");
    expect(system).toContain("never say you cannot act");
    expect(system).not.toContain("read-only helper.\n- You cannot");
  });
});

describe("normaliseOwnerQuestion", () => {
  it("collapses whitespace and caps length", () => {
    expect(normaliseOwnerQuestion("  how   many  leads ")).toBe("how many leads");
    expect(normaliseOwnerQuestion(null)).toBe("");
    expect(normaliseOwnerQuestion("x".repeat(900)).length).toBe(500);
  });
});
