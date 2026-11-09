import { describe, expect, it } from "vitest";
import { renderEmailHtml, renderEmailText } from "./email-template";

const brand = { businessName: "Glocast Mobile Auto Detailing", websiteUrl: "glocast.com.au", serviceArea: "Western Sydney", abn: "12 345 678 901" };
const body = "Hi there,\n\nWe have openings this week.\nReply to book.\n\nThanks,\nGlocast";

describe("default email template", () => {
  it("wraps the message in a branded 600px card with header, footer and unsubscribe", () => {
    const html = renderEmailHtml(brand, { bodyText: body, unsubscribeUrl: "https://bookedsecure.com/u?x=1" });
    expect(html).toContain('max-width:600px');
    expect(html).toContain("Glocast Mobile Auto Detailing");
    expect(html).toMatch(/>GM</); // initials when there is no logo
    expect(html).toContain("Western Sydney &middot;");
    expect(html).toContain("ABN 12 345 678 901");
    expect(html).toContain('href="https://glocast.com.au/"');
    expect(html).toContain("Unsubscribe from these emails");
    expect(html.match(/<p style="margin:0 0 16px/g)).toHaveLength(3);
    expect(html).toContain("We have openings this week.<br>Reply to book.");
  });

  it("uses the first real line as the inbox preview, not the greeting", () => {
    const html = renderEmailHtml(brand, { bodyText: body });
    expect(html).toMatch(/opacity:0;[^>]*>We have openings this week\./);
  });

  it("escapes owner text and refuses unsafe links", () => {
    const html = renderEmailHtml(
      { businessName: "A <b>", websiteUrl: "javascript:alert(1)", logoUrl: "javascript:x" },
      { bodyText: '<script>alert("x")</script>', cta: { label: "Go", url: "javascript:bad" } },
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("A &lt;b&gt;");
  });

  it("adds a button and a logo when given", () => {
    const html = renderEmailHtml({ ...brand, logoUrl: "https://bookedsecure.com/api/public/tenant-logo/x" }, { bodyText: body, cta: { label: "Get a quote", url: "https://bookedsecure.com/quote/glocast" } });
    expect(html).toContain('<img src="https://bookedsecure.com/api/public/tenant-logo/x"');
    expect(html).toContain(">Get a quote</a>");
  });

  it("has a plain-text twin with the footer and unsubscribe link", () => {
    const text = renderEmailText(brand, { bodyText: body, unsubscribeUrl: "https://bookedsecure.com/u" });
    expect(text).toContain("We have openings this week.");
    expect(text).toContain("Glocast Mobile Auto Detailing · Western Sydney · https://glocast.com.au/ · ABN 12 345 678 901");
    expect(text).toContain("Unsubscribe: https://bookedsecure.com/u");
  });
});
