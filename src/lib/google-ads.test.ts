import { describe, expect, it } from "vitest";
import { buildGoogleAdsAuthorizeUrl, campaignDailyQuery, formatCustomerId, isGoogleAdVisit, matchCampaign, normaliseCustomerId, toSpendRow } from "@/lib/google-ads";
import { buildAdPerformance } from "@/lib/meta-ads";

describe("Google Ads", () => {
  it("asks Google for lasting, read-capable access", () => {
    const url = new URL(buildGoogleAdsAuthorizeUrl({ clientId: "c", redirectUri: "https://bookedsecure.com/api/public/google-ads/oauth/callback", state: "s" }));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adwords");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("reads customer ids in either spelling", () => {
    expect(normaliseCustomerId("969-219-8133")).toBe("9692198133");
    expect(normaliseCustomerId("customers/9692198133")).toBeNull();
    expect(formatCustomerId("9692198133")).toBe("969-219-8133");
  });

  it("builds the daily query only from real dates", () => {
    expect(campaignDailyQuery("2026-11-01", "2026-11-12")).toContain("BETWEEN '2026-11-01' AND '2026-11-12'");
    expect(() => campaignDailyQuery("2026-11-01' OR 1=1 --", "2026-11-12")).toThrow();
  });

  it("turns cost micros into money", () => {
    expect(toSpendRow({ campaign: { id: "123", name: "Brand" }, segments: { date: "2026-11-10" }, metrics: { costMicros: "12345678", clicks: "9", impressions: "400", conversions: 1.5 } }))
      .toEqual({ campaign_id: "123", campaign_name: "Brand", date: "2026-11-10", spend: 12.35, clicks: 9, impressions: 400, conversions: 1.5 });
    expect(toSpendRow({ metrics: {} })).toBeNull();
  });

  it("recognises a visit from a Google ad, and nothing else", () => {
    expect(isGoogleAdVisit({ source: "google", medium: "paid", utm: { gclid: "abc" } })).toBe(true);
    expect(isGoogleAdVisit({ source: "google", medium: "cpc", utm: {} })).toBe(true);
    expect(isGoogleAdVisit({ source: "google.com", medium: null, utm: {} })).toBe(false);
    expect(isGoogleAdVisit({ source: "facebook", medium: "paid", utm: { fbclid: "x" } })).toBe(false);
  });

  it("matches a lead's utm_campaign to a campaign by id or name", () => {
    const known = [{ id: "111", name: "Summer Detail" }, { id: "222", name: null }];
    expect(matchCampaign("111", known)).toEqual({ id: "111", name: "Summer Detail" });
    expect(matchCampaign("summer detail", known)).toEqual({ id: "111", name: "Summer Detail" });
    expect(matchCampaign("unknown", known)).toEqual({ id: null, name: null });
  });
});

describe("ad results with clicks and impressions", () => {
  it("adds clicks, CTR and cost per click to each campaign and the total", () => {
    const r = buildAdPerformance(
      [{ campaign_id: "1", campaign_name: "A", date: "2026-11-01", spend: 50, meta_leads: 0, clicks: 25, impressions: 1000 },
       { campaign_id: "1", campaign_name: "A", date: "2026-11-02", spend: 50, meta_leads: 0, clicks: 25, impressions: 1000 }],
      [{ id: "l1", campaign_id: "1", campaign_name: "A" }],
      [{ lead_id: "l1", scheduled_at: "2026-11-05T00:00:00Z", completion_status: "completed", completed_value: 300 }],
    );
    expect(r.campaigns[0]).toMatchObject({ spend: 100, clicks: 50, impressions: 2000, ctr: 2.5, costPerClick: 2, leads: 1, booked: 1, revenue: 300, roas: 3 });
    expect(r.total).toMatchObject({ clicks: 50, impressions: 2000, ctr: 2.5 });
  });
});
