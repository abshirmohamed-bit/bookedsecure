import { describe, expect, it } from "vitest";
import {
  buildEmailHtml,
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
  it("flags the shared onboarding address as not deliverable to customers", () => {
    expect(isDeliverableFromAddress(SHARED_FROM_ADDRESS)).toBe(false);
    expect(isDeliverableFromAddress("hello@glocast.com.au")).toBe(true);
  });

  it("falls back to the shared address when the value is not an email", () => {
    expect(normaliseFromAddress("not an email")).toBe(SHARED_FROM_ADDRESS);
    expect(normaliseFromAddress(" Hello@Glocast.com.au ")).toBe("hello@glocast.com.au");
  });
});
