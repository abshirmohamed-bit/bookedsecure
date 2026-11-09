import { describe, expect, it } from "vitest";
import { buildFeed, cleanLeadLines, feedSections, kindsForFeedFilter, unreadGroupCount, unreadLeadCount, leadPushContent, type FeedRow } from "./notification-feed";

let n = 0;
const row = (over: Partial<FeedRow>): FeedRow => ({
  id: `n${++n}`,
  lead_id: null,
  kind: "social_message",
  title: "New Instagram message",
  body: "imabshir: hi",
  metadata: null,
  created_at: "2026-11-09T05:00:00Z",
  read_at: null,
  ...over,
});

describe("notification feed", () => {
  it("folds every DM from one person into a single conversation", () => {
    const rows = [
      row({ body: "imabshir: Lmfao", created_at: "2026-11-09T05:03:00Z" }),
      row({ body: "imabshir: Good idea! I like this!", created_at: "2026-11-09T05:02:00Z" }),
      row({ body: "imabshir: https://www.instagram.com/x?utm_source=ig", created_at: "2026-11-09T05:04:00Z" }),
      row({ body: "someone: hello", created_at: "2026-11-09T05:01:00Z" }),
    ];
    const feed = buildFeed(rows);
    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatchObject({ title: "imabshir", count: 3, countLabel: "3 new", action: "Reply" });
    expect(feed[0]!.preview.at(-1)).toContain("instagram.com");
    expect(feed[0]!.link).toEqual({ to: "/social", search: { view: "messages" } });
    expect(unreadGroupCount(rows)).toBe(2);
  });

  it("bundles a day's comments per platform", () => {
    const feed = buildFeed([
      row({ kind: "social_comment", title: "New Instagram comment to review", body: "jxantana: 🔥🔥" }),
      row({ kind: "social_comment", title: "New Instagram comment to review", body: "dt_carcare.nl: Nice" }),
      row({ kind: "social_comment", title: "New Facebook comment to review", body: "Great job" }),
    ]);
    expect(feed.map((g) => g.title).sort()).toEqual(["2 Instagram comments to review", "Facebook comment to review"]);
  });

  it("shows leads in plain words, without timestamps or option keys", () => {
    const fromMeta = cleanLeadLines(
      row({ kind: "new_lead", title: "Quote request: Syed", body: "x", metadata: { name: "Syed Rasheed", service_intent: "full_detail_(starting_$280)", suburb: "Parramatta", mobile_number: "+61435933991" } }),
    );
    expect(fromMeta).toEqual({ name: "Syed Rasheed", lines: ["Full detail (starting $280)", "Parramatta · +61435933991"] });
    const fromBody = cleanLeadLines(
      row({ kind: "new_lead", title: "Returning customer — Quote request: Abshir", body: "Service: full_detail_(starting_$280)\nTiming: within_the_next_2_weeks\nReceived: 2026-11-09T01:51:36.166Z" }),
    );
    expect(fromBody.lines).toEqual(["Service: Full detail (starting $280)", "Timing: Within the next 2 weeks"]);
  });

  it("puts unread first, then read items by day", () => {
    const now = new Date("2026-11-09T12:00:00");
    const feed = buildFeed([
      row({ kind: "new_lead", lead_id: "a", title: "New lead: Old", read_at: "x", created_at: new Date("2026-11-01T10:00:00").toISOString() }),
      row({ kind: "new_lead", lead_id: "b", title: "New lead: Fresh", created_at: new Date("2026-11-08T10:00:00").toISOString() }),
      row({ kind: "new_lead", lead_id: "c", title: "New lead: Seen", read_at: "x", created_at: new Date("2026-11-09T09:00:00").toISOString() }),
    ]);
    expect(feed.map((g) => g.title)).toEqual(["Fresh", "Seen", "Old"]);
    expect(feedSections(feed, now).map((s) => s.label)).toEqual(["New leads", "Recent leads", "Older"]);
  });

  it("groups repeat alerts for the same lead and maps filters to kinds", () => {
    const feed = buildFeed([
      row({ kind: "customer_reply", lead_id: "L", title: "Text from Sam", body: "Yes please" }),
      row({ kind: "customer_reply", lead_id: "L", title: "Text from Sam", body: "Tuesday?", created_at: "2026-11-09T06:00:00Z" }),
    ]);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ title: "Sam", countLabel: "2 texts", preview: ["Yes please", "Tuesday?"] });
    expect(kindsForFeedFilter("messages")).toEqual(["customer_reply", "social_message"]);
    expect(kindsForFeedFilter("all")).toBeNull();
  });
});

describe("leads come first", () => {
  it("shows unread leads above newer messages, and read leads above everything else", () => {
    const now = new Date("2026-11-09T12:00:00");
    const at = (h: number) => new Date(`2026-11-09T${String(h).padStart(2, "0")}:00:00`).toISOString();
    const rows = [
      row({ body: "imabshir: newest dm", created_at: at(11) }),
      row({ kind: "new_lead", lead_id: "L1", title: "Quote request: Syed", created_at: at(6) }),
      row({ kind: "new_lead", lead_id: "L2", title: "New lead: Nouha", read_at: "x", created_at: at(5) }),
      row({ kind: "social_comment", title: "New Instagram comment to review", body: "a: hi", read_at: "x", created_at: at(10) }),
    ];
    const sections = feedSections(buildFeed(rows), now);
    expect(sections.map((s) => [s.label, s.groups.map((g) => g.title)])).toEqual([
      ["New leads", ["Syed"]],
      ["Recent leads", ["Nouha"]],
      ["Everything else", ["imabshir"]],
      ["Today", ["Instagram comment to review"]],
    ]);
    expect(unreadLeadCount(rows)).toBe(1);
  });

  it("caps recent leads in the bell and says how many more", () => {
    const now = new Date("2026-11-09T12:00:00");
    const rows = [1, 2, 3, 4].map((i) => row({ kind: "new_lead", lead_id: `R${i}`, title: `New lead: P${i}`, read_at: "x", created_at: new Date(`2026-11-09T0${i}:00:00`).toISOString() }));
    const [recent] = feedSections(buildFeed(rows), now, { recentLeadLimit: 3 });
    expect(recent).toMatchObject({ label: "Recent leads", more: 1 });
    expect(recent!.groups).toHaveLength(3);
  });
});

describe("lead push", () => {
  it("says who and what without the phone number, and opens the lead", () => {
    const leadId = "0d74c6e9-43dd-4463-90d7-1d1476a29ef3";
    expect(
      leadPushContent({ title: "Quote request: Syed", leadId, metadata: { service_intent: "full_detail_(starting_$280)", suburb: "Parramatta", mobile_number: "+61435933991" } }),
    ).toEqual({ title: "Quote request: Syed", body: "Full detail (starting $280) · Parramatta. Tap to reply.", path: `/leads/${leadId}` });
    expect(leadPushContent({ title: "New lead: Sam", leadId: null, metadata: null })).toEqual({ title: "New lead: Sam", body: "New enquiry. Tap to reply.", path: "/leads" });
  });
});
