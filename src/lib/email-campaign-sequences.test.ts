import { describe, expect, it } from "vitest";
import {
  bookedRecipients,
  CAMPAIGN_AUDIENCES,
  followUpDue,
  followUpSkipReason,
  NEVER_EMAIL_STATUSES,
  parseCampaignDraft,
  scheduleTimeProblem,
} from "./email-campaigns";

const now = new Date("2026-11-20T00:00:00Z");

describe("campaign follow-ups", () => {
  it("is due only once the delay has passed since the first email", () => {
    expect(followUpDue("2026-11-17T00:00:00Z", 3, now)).toBe(true);
    expect(followUpDue("2026-11-17T00:00:01Z", 3, now)).toBe(false);
    expect(followUpDue(null, 3, now)).toBe(false);
    expect(followUpDue("2026-11-01T00:00:00Z", null, now)).toBe(false);
  });

  it("never follows up unsubscribed, deleted or booked customers", () => {
    const base = { unsubscribed: false, leadDeleted: false, bookedSinceFirstEmail: false, stopOnBooking: true, campaignStatus: "sent" };
    expect(followUpSkipReason(base)).toBeNull();
    expect(followUpSkipReason({ ...base, unsubscribed: true })).toBe("Unsubscribed");
    expect(followUpSkipReason({ ...base, leadDeleted: true })).toBe("Customer was deleted");
    expect(followUpSkipReason({ ...base, bookedSinceFirstEmail: true })).toBe("Booked after the first email");
    expect(followUpSkipReason({ ...base, bookedSinceFirstEmail: true, stopOnBooking: false })).toBeNull();
    expect(followUpSkipReason({ ...base, campaignStatus: "cancelled" })).toBe("Campaign is not sent");
  });
});

describe("campaign results", () => {
  it("counts a booking made within 30 days after the email, once per customer", () => {
    const recipients = [
      { leadId: "a", sentAt: "2026-11-01T00:00:00Z" },
      { leadId: "b", sentAt: "2026-11-01T00:00:00Z" },
      { leadId: "c", sentAt: "2026-11-01T00:00:00Z" },
      { leadId: "d", sentAt: null },
    ];
    const jobs = [
      { lead_id: "a", created_at: "2026-11-03T00:00:00Z", completion_status: "scheduled" },
      { lead_id: "a", created_at: "2026-11-05T00:00:00Z", completion_status: "completed" },
      { lead_id: "b", created_at: "2026-10-30T00:00:00Z", completion_status: "scheduled" },
      { lead_id: "c", created_at: "2026-11-04T00:00:00Z", completion_status: "cancelled" },
      { lead_id: "d", created_at: "2026-11-04T00:00:00Z", completion_status: "scheduled" },
    ];
    expect([...bookedRecipients(recipients, jobs)]).toEqual(["a"]);
  });
});

describe("audiences and scheduling", () => {
  it("never targets opted-out or invalid leads", () => {
    for (const audience of CAMPAIGN_AUDIENCES) {
      for (const status of NEVER_EMAIL_STATUSES) {
        expect((audience.statuses ?? []) as readonly string[]).not.toContain(status);
      }
    }
  });

  it("only schedules between 5 minutes and 60 days ahead", () => {
    expect(scheduleTimeProblem(new Date(now.getTime() + 60_000), now)).toMatch(/5 minutes/);
    expect(scheduleTimeProblem(new Date(now.getTime() + 3_600_000), now)).toBeNull();
    expect(scheduleTimeProblem(new Date(now.getTime() + 61 * 86_400_000), now)).toMatch(/60 days/);
    expect(scheduleTimeProblem(new Date("nope"), now)).toMatch(/valid/);
  });
});

describe("AI drafts", () => {
  it("reads the subject and body and strips placeholders", () => {
    expect(parseCampaignDraft("SUBJECT: Openings this week\nBODY:\nHi there,\n\nBook [today].\n\nThanks,\nGlocast")).toEqual({
      subject: "Openings this week",
      bodyText: "Hi there,\n\nBook today.\n\nThanks,\nGlocast",
    });
    expect(parseCampaignDraft("Here is an email")).toBeNull();
  });
});
