import { describe, expect, it } from "vitest";
import {
  buildEmailHtml,
  campaignSender,
  isDeliverableFromAddress,
  normaliseFromAddress,
  splitRecipients,
  SHARED_FROM_ADDRESS,
} from "@/lib/email-campaigns";

describe("splitRecipients", () => {
  const leads = [
    { id: "a", name: "Ann", email: "ann@example.com" },
    { id: "b", name: "Bob", email: null },
    { id: "c", name: "Cid", email: "cid@example.com" },
    { id: "d", name: "Dee", email: "ANN@example.com " },
    { id: "e", name: "Eli", email: "not-an-email" },
    { id: "f", name: "Fin", email: "fin@example.com", deleted_at: "2026-01-01" },
  ];

  it("skips leads without a usable email, unsubscribed, duplicates and deleted", () => {
    const split = splitRecipients(leads, new Set(["cid@example.com"]));
    expect(split.emailable).toEqual([{ leadId: "a", email: "ann@example.com" }]);
    expect(split.skippedNoEmail.sort()).toEqual(["b", "e"]);
    expect(split.skippedUnsubscribed).toEqual(["c"]);
    expect(split.skippedDuplicate).toEqual(["d"]);
  });

  it("keeps everyone when nobody is unsubscribed", () => {
    const split = splitRecipients(leads.slice(0, 3), new Set());
    expect(split.emailable).toHaveLength(2);
  });
});

describe("buildEmailHtml", () => {
  it("escapes owner text and includes the unsubscribe link", () => {
    const html = buildEmailHtml({
      businessName: "Glocast <Detailing>",
      bodyText: "Hi there\n\n<b>Winter offer</b> ends soon",
      unsubscribeUrl: "https://bookedsecure.com/api/public/email-unsubscribe?b=1&e=a@b.co",
    });
    expect(html).toContain("&lt;b&gt;Winter offer&lt;/b&gt;");
    expect(html).not.toContain("<b>Winter offer</b>");
    expect(html).toContain("Glocast &lt;Detailing&gt;");
    expect(html).toContain("Unsubscribe from these emails");
    expect(html).toContain("https://bookedsecure.com/api/public/email-unsubscribe?b=1&amp;e=a@b.co");
  });
});

describe("from address", () => {
  it("sends every campaign from the verified BookedSecure domain with replies to the owner", () => {
    // Everything now goes out from the verified BookedSecure domain.
    expect(isDeliverableFromAddress(SHARED_FROM_ADDRESS)).toBe(true);
    expect(isDeliverableFromAddress("hello@glocast.com.au")).toBe(true);
    expect(campaignSender("hello@glocast.com.au", "owner@x.com")).toEqual({ from: "campaigns@bookedsecure.com", replyTo: "hello@glocast.com.au" });
    expect(campaignSender(SHARED_FROM_ADDRESS, "owner@x.com")).toEqual({ from: "campaigns@bookedsecure.com", replyTo: "owner@x.com" });
    expect(campaignSender("team@bookedsecure.com", "owner@x.com")).toEqual({ from: "team@bookedsecure.com", replyTo: null });
  });

  it("falls back to the shared address when the value is not an email", () => {
    expect(normaliseFromAddress("not an email")).toBe(SHARED_FROM_ADDRESS);
    expect(normaliseFromAddress(" Hello@Glocast.com.au ")).toBe("hello@glocast.com.au");
  });
});
