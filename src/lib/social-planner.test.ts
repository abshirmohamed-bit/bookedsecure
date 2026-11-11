import { describe, expect, it } from "vitest";
import { engagementRate, facebookInsights, instagramInsights, localDay, monthWeeks, plannerAt } from "@/lib/social-planner";

describe("social planner", () => {
  it("puts a post on the day it went out, else its planned day, else when it was written", () => {
    expect(plannerAt({ published_at: "2026-11-10T01:00:00Z", scheduled_for: "2026-11-12T01:00:00Z", created_at: "2026-11-01T00:00:00Z" })).toBe("2026-11-10T01:00:00Z");
    expect(plannerAt({ published_at: null, scheduled_for: "2026-11-12T01:00:00Z", created_at: "2026-11-01T00:00:00Z" })).toBe("2026-11-12T01:00:00Z");
    expect(plannerAt({ created_at: "2026-11-01T00:00:00Z" })).toBe("2026-11-01T00:00:00Z");
  });

  it("shows the business's own day, not UTC's", () => {
    expect(localDay("2026-11-11T14:30:00Z", "Australia/Sydney")).toBe("2026-11-12");
  });

  it("lays a month out in Monday-first weeks that cover every day of it", () => {
    const weeks = monthWeeks(2026, 11);
    expect(weeks[0]![0]).toBe("2026-10-26");
    expect(weeks.flat()).toContain("2026-11-30");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it("reads Facebook figures and leaves missing ones empty", () => {
    const i = facebookInsights({
      insights: { data: [{ name: "post_impressions", values: [{ value: 1200 }] }, { name: "post_impressions_unique", values: [{ value: 900 }] }] },
      reactions: { summary: { total_count: 40 } }, comments: { summary: { total_count: 5 } }, shares: { count: 3 },
    });
    expect(i).toMatchObject({ impressions: 1200, reach: 900, clicks: null, likes: 40, comments: 5, shares: 3, engagements: 48 });
    expect(engagementRate(i)).toBe(5.3);
  });

  it("reads Instagram figures from media fields and insights", () => {
    const i = instagramInsights({ like_count: 30, comments_count: 4 }, [{ name: "reach", values: [{ value: 500 }] }, { name: "saved", total_value: { value: 6 } }]);
    expect(i).toMatchObject({ reach: 500, likes: 30, comments: 4, saves: 6, shares: null, engagements: 40 });
    expect(engagementRate(i)).toBe(8);
  });
});
