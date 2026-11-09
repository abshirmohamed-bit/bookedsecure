import { describe, expect, it } from "vitest";
import {
  availableAuthors,
  buildLinkedInAuthorizeUrl,
  buildPostBody,
  daysUntil,
  escapeLittleText,
  linkedInPostUrl,
  linkedInScopes,
  postTextProblem,
  postableOrganizationIds,
} from "./linkedin";

describe("LinkedIn helpers", () => {
  it("asks for Page scopes only when Page posting is approved", () => {
    expect(linkedInScopes(false)).toEqual(["openid", "profile", "w_member_social"]);
    expect(linkedInScopes(true)).toContain("w_organization_social");
  });

  it("builds the sign-in address", () => {
    const url = new URL(buildLinkedInAuthorizeUrl({ clientId: "abc", redirectUri: "https://bookedsecure.com/cb", state: "s1", scopes: ["openid", "profile"] }));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.searchParams.get("state")).toBe("s1");
  });

  it("escapes LinkedIn's special characters but keeps hashtags", () => {
    expect(escapeLittleText("Deals (this week) @ 20% off_now #detailing")).toBe("Deals \\(this week\\) \\@ 20% off\\_now #detailing");
    expect(escapeLittleText("Call # 5")).toBe("Call \\# 5");
  });

  it("checks the length", () => {
    expect(postTextProblem("  ")).toMatch(/Write something/);
    expect(postTextProblem("x".repeat(3001))).toMatch(/3000/);
    expect(postTextProblem("Hello")).toBeNull();
  });

  it("builds a public post", () => {
    expect(buildPostBody("urn:li:person:abc", " Hi ")).toMatchObject({ author: "urn:li:person:abc", commentary: "Hi", visibility: "PUBLIC", lifecycleState: "PUBLISHED" });
  });

  it("links to a published post only for real post ids", () => {
    expect(linkedInPostUrl("urn:li:share:123")).toBe("https://www.linkedin.com/feed/update/urn:li:share:123/");
    expect(linkedInPostUrl("javascript:alert(1)")).toBeNull();
  });

  it("keeps only Pages the owner may post to", () => {
    expect(postableOrganizationIds([
      { organization: "urn:li:organization:1", role: "ADMINISTRATOR", state: "APPROVED" },
      { organization: "urn:li:organization:2", role: "ANALYST", state: "APPROVED" },
      { organization: "urn:li:organization:3", role: "CONTENT_ADMIN", state: "REQUESTED" },
      { organization: "urn:li:organization:1", role: "CONTENT_ADMIN" },
    ])).toEqual(["1"]);
  });

  it("lists the profile first, then Pages", () => {
    expect(availableAuthors({ member_urn: "urn:li:person:a", member_name: "Sam", organizations: [{ id: "9", name: "Glocast" }] }).map((a) => a.name)).toEqual(["Sam", "Glocast"]);
  });

  it("counts days to renew", () => {
    expect(daysUntil("2026-01-11T00:00:00Z", Date.parse("2026-01-01T00:00:00Z"))).toBe(10);
    expect(daysUntil(null)).toBeNull();
  });
});
